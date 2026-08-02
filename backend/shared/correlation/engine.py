"""
Correlation Engine

Deterministic correlation engine that processes UnifiedEvents and
generates correlated Incidents using configurable rules.

Flow:
    1. Filter events by severity threshold
    2. Query DB for recent unlinked events (cross-cycle correlation)
    3. Group events by site + time window (Stage 1)
    4. For each group, run topology-aware cascade (Stage 2)
    5. Generate Incident for each root-cause group
    6. Link symptom events to root-cause incident
    7. Calculate confidence scores
    8. Track processed events with TTL + capacity cap (memory-safe)

Stage 2 restructures site+time groups into root-cause + symptom
groups using infrastructure topology (topology_nodes/edges from DB)
or device-type heuristics as fallback.

Restart resilience:
  - On first process_events() call, loads already-linked event IDs from
    the incidents table so past events are not re-processed.
  - Incident IDs are deterministic (SHA-256 of the root-cause key: site,
    root device, issue category), so new events for the same underlying
    failure merge into the same incident (upsert) and re-processing the
    same events is idempotent.
  - DEVICE_REACHABLE recovery events resolve open incidents whose root
    cause recovered, so incidents don't linger after the outage ends.
"""

import hashlib
import logging
import time
from collections import Counter, OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set

from ..models.event import EventSeverity, EventType, UnifiedEvent
from ..models.incident import Incident, IncidentSeverity, IncidentStatus
from .rules import (
    CascadeGroup,
    ConfidenceBreakdown,
    CorrelationConfig,
    SiteTimeWindowRule,
    TopologyCascadeRule,
    TopologyProvider,
    calculate_confidence_score,
    generate_incident_title,
    group_events_by_site_and_time,
)

logger = logging.getLogger(__name__)

# Maximum number of processed event IDs held in memory.
# At ~86,400 new events/day (60s cycles, ~60 events/cycle) this covers
# ~2.3 days of history.  Older entries are evicted first.
_MAX_PROCESSED_EVENTS = 200_000

# How long a processed event ID stays in memory before it can be
# re-processed (in case a downstream failure requires replay).
_PROCESSED_TTL_HOURS = 24

# How far back to fetch unlinked events for cross-cycle correlation.
# Should be >= 2x the configured time window so event batches that span
# multiple collection cycles still form complete incidents.
_CROSS_CYCLE_WINDOW_MULTIPLIER = 2


class CorrelationEngine:
    """
    Deterministic correlation engine for the Naxis platform.

    Processes UnifiedEvents and generates correlated Incidents using
    site-based time-window grouping (Stage 1) and infrastructure-aware
    topology cascading (Stage 2).

    Features:
      - Cross-cycle correlation: queries DB for recent unlinked events
        so events arriving in different collection cycles still form
        a single incident.
      - Memory-safe processed-event tracking with TTL + capacity cap.
      - Restart resilience: loads existing incident event IDs from DB
        and uses deterministic incident IDs.
    """

    def __init__(
        self,
        config: CorrelationConfig = None,
        topology_provider: TopologyProvider = None,
    ):
        """Initialize correlation engine with optional config and topology provider."""
        self.config = config or CorrelationConfig()
        self.rule = SiteTimeWindowRule()
        self._topology_cascade = (
            TopologyCascadeRule(
                provider=topology_provider, config=self.config
            )
            if self.config.topology_cascade_enabled
            else None
        )

        # Processed event tracker: OrderedDict[event_id, processed_at_utc]
        # OrderedDict gives us O(1) insert/lookup and ordered eviction
        self._processed_events: OrderedDict[str, datetime] = OrderedDict()
        self._processed_loaded = False

        # Telemetry counters
        self._cycle_count: int = 0
        self._total_events_processed: int = 0
        self._total_incidents_created: int = 0
        self._total_cascade_incidents: int = 0
        self._total_residual_incidents: int = 0
        self._last_duration_ms: float = 0.0
        self._last_cycle_events: int = 0
        self._last_cycle_incidents: int = 0

    # ------------------------------------------------------------------
    # Processed-event tracker (memory-safe with TTL + cap)
    # ------------------------------------------------------------------

    def _is_event_processed(self, event_id: str) -> bool:
        """True if event_id has been processed and is not yet evicted."""
        return event_id in self._processed_events

    def _mark_processed(self, event_id: str) -> None:
        """
        Record an event as processed.  If the tracker is at capacity,
        the oldest entry (by insertion order) is evicted first.
        """
        self._processed_events[event_id] = datetime.now(timezone.utc)
        self._processed_events.move_to_end(event_id)

        # Evict oldest entries when over capacity
        while len(self._processed_events) > _MAX_PROCESSED_EVENTS:
            self._processed_events.popitem(last=False)

    def _evict_expired(self) -> int:
        """
        Remove event IDs that have been in the tracker longer than TTL.
        Returns the number evicted.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=_PROCESSED_TTL_HOURS)
        expired: List[str] = [
            eid
            for eid, ts in self._processed_events.items()
            if ts < cutoff
        ]
        for eid in expired:
            del self._processed_events[eid]
        if expired:
            logger.debug("Evicted %d expired event IDs from processed tracker", len(expired))
        return len(expired)

    async def _load_processed_from_db(self) -> None:
        """
        On first call, load event IDs that are already linked to incidents
        from the DB.  This prevents re-processing events that were
        correlated in a previous worker lifetime (restart resilience).
        """
        if self._processed_loaded:
            return
        self._processed_loaded = True

        try:
            from ..database.client import db as _db

            rows = await _db.fetch(
                "SELECT DISTINCT unnest(related_event_ids) AS eid FROM incidents"
            )
            now = datetime.now(timezone.utc)
            count = 0
            for row in rows:
                eid = row["eid"]
                if eid:
                    self._processed_events[eid] = now
                    count += 1
            logger.info(
                "Loaded %d processed event IDs from incidents table", count
            )
        except Exception:
            logger.info(
                "No existing incidents found or DB not ready — "
                "starting fresh processed tracker"
            )

    # ------------------------------------------------------------------
    # Cross-cycle correlation helper
    # ------------------------------------------------------------------

    async def _fetch_unlinked_events(
        self, window_seconds: int, limit: int = 5000
    ) -> List[UnifiedEvent]:
        """
        Fetch events from the DB that are NOT yet linked to any incident
        and fall within the correlation time window.  These are appended
        to the current batch so event groups that span multiple collection
        cycles still form complete incidents.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(
            seconds=window_seconds * _CROSS_CYCLE_WINDOW_MULTIPLIER
        )
        try:
            from ..database.client import db as _db
            from ..database.events import _row_to_event

            rows = await _db.fetch(
                """
                SELECT * FROM events
                WHERE incident_id IS NULL
                  AND timestamp >= $1
                ORDER BY timestamp ASC
                LIMIT $2
                """,
                cutoff,
                limit,
            )
        except Exception:
            logger.warning("Failed to fetch unlinked events for cross-cycle correlation", exc_info=True)
            return []

        events: List[UnifiedEvent] = []
        for row in rows:
            try:
                event = _row_to_event(row)
                if event.event_id and not self._is_event_processed(event.event_id):
                    events.append(event)
            except Exception:
                logger.warning("Failed to convert event row %s", row.get("event_id", "?"), exc_info=True)
                continue

        if events:
            logger.info(
                "Fetched %d unlinked events from DB for cross-cycle correlation "
                "(window=%ds)",
                len(events),
                window_seconds * _CROSS_CYCLE_WINDOW_MULTIPLIER,
            )
        return events

    # ------------------------------------------------------------------
    # Deterministic incident ID
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_incident_id(
        events: List[UnifiedEvent], root_device_id: str = None
    ) -> str:
        """
        Deterministic incident ID derived from the root cause:
        (site_id, root device, primary issue category).

        Events that describe the same underlying failure — even with
        different event IDs (different cycles, different collectors) —
        produce the same incident_id, so upsert_incident's ON CONFLICT
        DO UPDATE merges them into one live incident instead of creating
        duplicates.

        ponytail: recurrence of the same root cause reopens the same
        incident row (prior outage history lives in the events table);
        switch to time-bucketed keys if per-outage history matters.
        """
        site_id = next(
            (e.device.site_id for e in events if e.device and e.device.site_id),
            "",
        )
        if not root_device_id:
            root_device_id = CorrelationEngine._primary_device_id(events)
        categories = Counter(
            e.category.value for e in events if e.category
        )
        category = categories.most_common(1)[0][0] if categories else "unknown"
        material = f"{site_id}|{root_device_id or 'unknown'}|{category}"
        return f"inc-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:16]}"

    @staticmethod
    def _primary_device_id(events: List[UnifiedEvent]) -> str:
        """Device of the highest-severity event (first one on ties)."""
        severity_rank = {
            EventSeverity.CRITICAL: 5,
            EventSeverity.MAJOR: 4,
            EventSeverity.MINOR: 3,
            EventSeverity.WARNING: 2,
            EventSeverity.INFO: 1,
            EventSeverity.DEBUG: 0,
        }
        best: Optional[UnifiedEvent] = None
        for event in events:
            if not (event.device and event.device.device_id):
                continue
            if best is None or severity_rank[event.severity] > severity_rank[best.severity]:
                best = event
        return best.device.device_id if best else ""

    # ------------------------------------------------------------------
    # Main correlation pipeline
    # ------------------------------------------------------------------

    async def process_events(self, events: List[UnifiedEvent]) -> List[Incident]:
        """
        Process a batch of events and return correlated incidents.

        Pipeline:
          1. Load processed IDs from DB (first call only — restart resilience)
          2. Evict expired entries from the processed tracker (memory safety)
          3. Fetch recent unlinked events from DB (cross-cycle correlation)
          4. Combine & deduplicate: current batch + DB history
          5. Stage 1: group by site + time window
          6. Stage 2: topology cascade on each group (if enabled)
          7. Create Incidents with deterministic IDs
          8. Mark all processed events

        Args:
            events: List of UnifiedEvent objects to correlate

        Returns:
            List of correlated Incident objects
        """
        if not events:
            logger.info("No events to process")
            return []

        self._cycle_count += 1
        _cycle_start = time.monotonic()

        # --- Restart resilience: load previously processed IDs from DB ---
        await self._load_processed_from_db()

        # --- Memory safety: evict expired entries ---
        self._evict_expired()

        logger.info(
            "Processing %d events for correlation (cycle %d)",
            len(events),
            self._cycle_count,
        )

        # Filter out already-processed events
        new_events = [
            e for e in events if not self._is_event_processed(e.event_id)
        ]

        # --- Cross-cycle correlation: fetch unlinked events from DB ---
        try:
            db_events = await self._fetch_unlinked_events(
                self.config.time_window_seconds
            )
            for db_event in db_events:
                if db_event.event_id not in {e.event_id for e in new_events}:
                    new_events.append(db_event)
        except Exception:
            logger.warning("Cross-cycle DB fetch failed — continuing with current batch")

        if not new_events:
            logger.info("All events already processed")
            self._update_cycle_telemetry(0, 0, _cycle_start)
            return []

        logger.debug("Found %d new events to process", len(new_events))

        # Stage 1: Group events by site and time window
        groups = group_events_by_site_and_time(new_events, self.config)
        logger.info(
            "Stage 1: grouped events into %d potential incident groups",
            len(groups),
        )

        # Stage 2: Run topology cascade on each group (if enabled)
        incidents = []
        processed_events_in_cycle: Set[str] = set()

        for group_key, group_events in groups.items():
            if not self.rule.should_correlate(group_events, self.config):
                logger.debug(
                    "Group %s with %d events did not meet correlation threshold",
                    group_key,
                    len(group_events),
                )
                continue

            if self._topology_cascade:
                cascade_groups = await self._topology_cascade.evaluate(
                    group_events
                )
            else:
                cascade_groups = []

            if cascade_groups:
                # Stage 2: Create root-cause + symptom incidents
                assigned_ids: Set[str] = set()
                for cascade in cascade_groups:
                    incident = self._create_from_cascade(cascade)
                    incidents.append(incident)
                    for eid in cascade.all_event_ids():
                        assigned_ids.add(eid)
                        processed_events_in_cycle.add(eid)

                    logger.info(
                        "Created topology-aware incident %s: root=%s, "
                        "%d root events, %d symptom events",
                        incident.incident_id,
                        cascade.root_device_id,
                        len(cascade.root_events),
                        len(cascade.symptom_events),
                    )

                # Create residual incidents for events in the group that
                # were not assigned to any cascade group
                unassigned = [
                    e for e in group_events if e.event_id not in assigned_ids
                ]
                if unassigned:
                    residual = self.create_incident(unassigned)
                    incidents.append(residual)
                    for e in unassigned:
                        processed_events_in_cycle.add(e.event_id)
                    logger.info(
                        "Created residual incident %s for %d unassigned events",
                        residual.incident_id,
                        len(unassigned),
                    )
            else:
                # Stage 1 fallback: create flat incident from the group
                incident = self.create_incident(group_events)
                incidents.append(incident)
                for event in group_events:
                    processed_events_in_cycle.add(event.event_id)

                logger.info(
                    "Created flat incident %s from %d events (group: %s)",
                    incident.incident_id,
                    len(group_events),
                    group_key,
                )

        # Mark all processed events
        for eid in processed_events_in_cycle:
            self._mark_processed(eid)

        # --- Recovery: resolve open incidents whose root cause recovered ---
        # Runs after incident creation so a recovery event that arrives in
        # the same cycle as its outage still resolves it.
        recovery_events = [
            e for e in new_events
            if e.event_type == EventType.DEVICE_REACHABLE
        ]
        if recovery_events:
            await self._resolve_recovered_devices(recovery_events)

        # Update telemetry
        cascade_count = sum(
            1
            for i in incidents
            if "failure cascading" in i.title.lower()
        )
        residual_count = len(incidents) - cascade_count
        self._total_events_processed += len(processed_events_in_cycle)
        self._total_incidents_created += len(incidents)
        self._total_cascade_incidents += cascade_count
        self._total_residual_incidents += residual_count

        self._update_cycle_telemetry(
            len(processed_events_in_cycle),
            len(incidents),
            _cycle_start,
        )

        logger.info(
            "Generated %d correlated incidents from %d events "
            "(Stage 2 cascade: %s, cascade=%d, residual=%d, "
            "tracker_size=%d, duration=%.0fms)",
            len(incidents),
            len(processed_events_in_cycle),
            "enabled" if self._topology_cascade else "disabled",
            cascade_count,
            residual_count,
            len(self._processed_events),
            self._last_duration_ms,
        )
        return incidents

    async def _resolve_recovered_devices(
        self, recovery_events: List[UnifiedEvent]
    ) -> None:
        """
        Resolve OPEN incidents whose root device(s) reported recovery.

        Symptom recovery does NOT resolve — the root cause must be fixed
        first.  DB failure is swallowed so degraded cycles don't crash
        the pipeline; recovery events are not marked processed, so a
        failed attempt is retried on the next cycle.
        """
        device_ids = sorted(
            {
                e.device.device_id
                for e in recovery_events
                if e.device and e.device.device_id
            }
        )
        if not device_ids:
            return
        try:
            from ..database.incidents import resolve_open_incidents_for_devices

            resolved = await resolve_open_incidents_for_devices(device_ids)
            if resolved:
                logger.info(
                    "Recovery: resolved %d open incident(s) for %s",
                    resolved,
                    ", ".join(device_ids),
                )
        except Exception:
            logger.warning(
                "Recovery resolution failed for %s — will retry next cycle",
                ", ".join(device_ids),
                exc_info=True,
            )

    def _create_from_cascade(self, cascade: CascadeGroup) -> Incident:
        """
        Create an Incident from a CascadeGroup.

        The root events define the incident severity and title.
        Symptom events are added with reduced severity (INFO) so they
        appear in the blast radius but don't drive alerting.
        """
        if not cascade.root_events:
            raise ValueError("Cannot create incident from empty cascade root")

        severity = self._determine_severity(cascade.root_events)
        all_events = cascade.root_events + cascade.symptom_events
        all_event_ids = cascade.all_event_ids()

        affected_sites = list(
            {
                e.device.site_id
                for e in cascade.root_events + cascade.symptom_events
                if e.device and e.device.site_id
            }
        )
        affected_devices = list(
            {
                e.device.device_id
                for e in cascade.root_events + cascade.symptom_events
                if e.device and e.device.device_id
            }
        )
        affected_clients = list(
            {
                e.client.client_id
                for e in cascade.root_events + cascade.symptom_events
                if e.client and e.client.client_id
            }
        )

        # Build a title that identifies the root cause
        root_device_names = {
            e.device.device_name or e.device.device_id
            for e in cascade.root_events
            if e.device
        }
        root_device_str = ", ".join(sorted(root_device_names)) or cascade.root_device_id

        symptom_count = len(cascade.symptom_events)
        if symptom_count > 0:
            title = (
                f"{root_device_str} — failure cascading to "
                f"{symptom_count} dependent {'device' if symptom_count == 1 else 'devices'}"
            )
        else:
            title = generate_incident_title(cascade.root_events)

        symptom_device_ids = list(
            {
                e.device.device_id
                for e in cascade.symptom_events
                if e.device and e.device.device_id
            }
        )

        incident = Incident(
            incident_id=self._compute_incident_id(all_events, cascade.root_device_id),
            title=title,
            severity=severity,
            status=IncidentStatus.OPEN,
            affected_sites=affected_sites,
            affected_devices=affected_devices,
            affected_clients=affected_clients,
            root_device_ids=[cascade.root_device_id],
            symptom_device_ids=symptom_device_ids,
            related_event_ids=all_event_ids,
        )

        confidence = calculate_confidence_score(
            cascade.root_events + cascade.symptom_events
        )
        incident.confidence_score = confidence.total
        incident.confidence_breakdown = confidence.to_dict()

        logger.debug(
            "Created cascade incident: %s | root=%s | severity=%s | "
            "root_events=%d | symptoms=%d | confidence=%.2f",
            incident.incident_id,
            cascade.root_device_id,
            severity.value,
            len(cascade.root_events),
            symptom_count,
            confidence,
        )

        return incident

    def create_incident(self, events: List[UnifiedEvent]) -> Incident:
        """
        Create an Incident from a group of correlated events (Stage 1).

        Uses a deterministic incident_id derived from the sorted
        event IDs, so re-processing the same events produces the
        same incident (ON CONFLICT DO UPDATE deduplicates).

        Args:
            events: List of correlated UnifiedEvent objects

        Returns:
            Incident object
        """
        if not events:
            raise ValueError("Cannot create incident from empty event list")

        title = generate_incident_title(events)
        severity = self._determine_severity(events)
        primary_device = self._primary_device_id(events)

        affected_sites = list(
            {e.device.site_id for e in events if e.device and e.device.site_id}
        )
        affected_devices = list(
            {e.device.device_id for e in events if e.device and e.device.device_id}
        )
        affected_clients = list(
            {e.client.client_id for e in events if e.client and e.client.client_id}
        )

        incident = Incident(
            incident_id=self._compute_incident_id(events, primary_device),
            title=title,
            severity=severity,
            status=IncidentStatus.OPEN,
            affected_sites=affected_sites,
            affected_devices=affected_devices,
            affected_clients=affected_clients,
            root_device_ids=[primary_device] if primary_device else [],
            related_event_ids=[e.event_id for e in events],
        )

        confidence = calculate_confidence_score(events)
        incident.confidence_score = confidence.total
        incident.confidence_breakdown = confidence.to_dict()

        logger.debug(
            "Created incident: %s | severity=%s | "
            "events=%d | devices=%d | confidence=%.2f",
            incident.incident_id,
            severity.value,
            len(events),
            len(affected_devices),
            confidence,
        )

        return incident

    async def correlate_site_events(
        self, events: List[UnifiedEvent], site_id: str
    ) -> List[Incident]:
        """
        Correlate events for a specific site.

        Args:
            events: All events to consider
            site_id: Site ID to filter by

        Returns:
            List of incidents for this site
        """
        site_events = [
            e for e in events if e.device and e.device.site_id == site_id
        ]
        return await self.process_events(site_events)

    def group_by_site(
        self, events: List[UnifiedEvent]
    ) -> Dict[str, List[UnifiedEvent]]:
        """Group events by site_id for inspection."""
        groups: Dict[str, List[UnifiedEvent]] = {}
        for event in events:
            if event.device and event.device.site_id:
                site_id = event.device.site_id
                if site_id not in groups:
                    groups[site_id] = []
                groups[site_id].append(event)
        return groups

    def _update_cycle_telemetry(
        self, events_this_cycle: int, incidents_this_cycle: int, cycle_start: float
    ) -> None:
        """Record per-cycle telemetry after every process_events call.

        Called from both the normal processing path and the early-return
        path (all events already processed) so telemetry is always
        up to date.
        """
        self._last_duration_ms = (time.monotonic() - cycle_start) * 1000.0
        self._last_cycle_events = events_this_cycle
        self._last_cycle_incidents = incidents_this_cycle

    def reset(self) -> None:
        """Reset the processed events tracker and telemetry."""
        self._processed_events.clear()
        self._processed_loaded = False
        self._cycle_count = 0
        self._total_events_processed = 0
        self._total_incidents_created = 0
        self._total_cascade_incidents = 0
        self._total_residual_incidents = 0
        self._last_duration_ms = 0.0
        self._last_cycle_events = 0
        self._last_cycle_incidents = 0
        logger.info("Correlation engine reset")

    def get_processed_count(self) -> int:
        """Return count of event IDs currently in the processed tracker."""
        return len(self._processed_events)

    def get_stats(self) -> Dict[str, object]:
        """Return engine telemetry counters for monitoring."""
        return {
            "cycle_count": self._cycle_count,
            "total_events_processed": self._total_events_processed,
            "total_incidents_created": self._total_incidents_created,
            "cascade_incidents": self._total_cascade_incidents,
            "residual_incidents": self._total_residual_incidents,
            "processed_set_size": len(self._processed_events),
            "last_duration_ms": self._last_duration_ms,
            "last_cycle_events": self._last_cycle_events,
            "last_cycle_incidents": self._last_cycle_incidents,
            "cascade_enabled": self._topology_cascade is not None,
        }

    @staticmethod
    def _determine_severity(events: List[UnifiedEvent]) -> IncidentSeverity:
        """Determine incident severity as the highest severity among all events."""
        if not events:
            return IncidentSeverity.INFO

        severity_map = {
            EventSeverity.CRITICAL: IncidentSeverity.CRITICAL,
            EventSeverity.MAJOR: IncidentSeverity.MAJOR,
            EventSeverity.MINOR: IncidentSeverity.MINOR,
            EventSeverity.WARNING: IncidentSeverity.WARNING,
            EventSeverity.INFO: IncidentSeverity.INFO,
            EventSeverity.DEBUG: IncidentSeverity.INFO,
        }

        severity_order = [
            EventSeverity.CRITICAL,
            EventSeverity.MAJOR,
            EventSeverity.MINOR,
            EventSeverity.WARNING,
            EventSeverity.INFO,
            EventSeverity.DEBUG,
        ]

        for severity in severity_order:
            if any(e.severity == severity for e in events):
                return severity_map[severity]

        return IncidentSeverity.INFO


async def correlate_events(
    events: List[UnifiedEvent], config: CorrelationConfig = None
) -> List[Incident]:
    """
    Convenience function to correlate events without creating an engine instance.

    Args:
        events: List of UnifiedEvent objects
        config: Optional correlation configuration

    Returns:
        List of correlated Incident objects
    """
    engine = CorrelationEngine(config=config)
    return await engine.process_events(events)
