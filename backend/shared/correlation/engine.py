"""
Correlation Engine

Deterministic correlation engine that processes UnifiedEvents and
generates correlated Incidents using configurable rules.

Flow:
    1. Filter events by severity threshold
    2. Group events by site + time window (Stage 1)
    3. For each group, run topology-aware cascade (Stage 2)
    4. Generate Incident for each root-cause group
    5. Link symptom events to root-cause incident
    6. Calculate confidence scores

Stage 2 restructures site+time groups into root-cause + symptom
groups using infrastructure topology (topology_nodes/edges from DB)
or device-type heuristics as fallback.
"""

import logging
from typing import Dict, List, Optional, Set

from ..models.event import EventSeverity, UnifiedEvent
from ..models.incident import Incident, IncidentSeverity, IncidentStatus
from .rules import (
    CascadeGroup,
    CorrelationConfig,
    SiteTimeWindowRule,
    TopologyCascadeRule,
    TopologyProvider,
    calculate_confidence_score,
    generate_incident_title,
    group_events_by_site_and_time,
)

logger = logging.getLogger(__name__)


class CorrelationEngine:
    """
    Deterministic correlation engine for the Naxis platform.

    Processes UnifiedEvents and generates correlated Incidents using
    site-based time-window grouping (Stage 1) and infrastructure-aware
    topology cascading (Stage 2).

    Flow:
        1. Filter events by severity threshold
        2. Group events by site + time window
        3. Apply topology cascade to each group (if enabled)
        4. Generate Incident for each root-cause group
        5. Link symptom events with suppressed severity
        6. Calculate confidence scores
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
        self._processed_events: Set[str] = set()

    async def process_events(self, events: List[UnifiedEvent]) -> List[Incident]:
        """
        Process a batch of events and return correlated incidents.

        Args:
            events: List of UnifiedEvent objects to correlate

        Returns:
            List of correlated Incident objects
        """
        if not events:
            logger.info("No events to process")
            return []

        logger.info("Processing %d events for correlation", len(events))

        # Filter out already-processed events
        new_events = [e for e in events if e.event_id not in self._processed_events]
        if not new_events:
            logger.info("All events already processed")
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
                cascade_groups = await self._topology_cascade.evaluate(group_events)
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
                    e
                    for e in group_events
                    if e.event_id not in assigned_ids
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
        self._processed_events.update(processed_events_in_cycle)

        logger.info(
            "Generated %d correlated incidents from %d events "
            "(Stage 2 cascade: %s)",
            len(incidents),
            len(processed_events_in_cycle),
            "enabled" if self._topology_cascade else "disabled",
        )
        return incidents

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

        all_event_ids = cascade.all_event_ids()

        incident = Incident(
            title=title,
            severity=severity,
            status=IncidentStatus.OPEN,
            affected_sites=affected_sites,
            affected_devices=affected_devices,
            affected_clients=affected_clients,
            related_event_ids=all_event_ids,
        )

        confidence = calculate_confidence_score(cascade.root_events + cascade.symptom_events)
        incident.confidence_score = confidence

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

        Args:
            events: List of correlated UnifiedEvent objects

        Returns:
            Incident object
        """
        if not events:
            raise ValueError("Cannot create incident from empty event list")

        title = generate_incident_title(events)
        severity = self._determine_severity(events)

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
            title=title,
            severity=severity,
            status=IncidentStatus.OPEN,
            affected_sites=affected_sites,
            affected_devices=affected_devices,
            affected_clients=affected_clients,
            related_event_ids=[e.event_id for e in events],
        )

        confidence = calculate_confidence_score(events)
        incident.confidence_score = confidence

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

    def group_by_site(self, events: List[UnifiedEvent]) -> Dict[str, List[UnifiedEvent]]:
        """Group events by site_id for inspection."""
        groups: Dict[str, List[UnifiedEvent]] = {}
        for event in events:
            if event.device and event.device.site_id:
                site_id = event.device.site_id
                if site_id not in groups:
                    groups[site_id] = []
                groups[site_id].append(event)
        return groups

    def reset(self) -> None:
        """Reset the processed events tracker."""
        self._processed_events.clear()
        logger.info("Correlation engine reset")

    def get_processed_count(self) -> int:
        """Return count of processed event IDs."""
        return len(self._processed_events)

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
