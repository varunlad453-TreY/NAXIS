"""
Correlation Engine

Deterministic correlation engine that processes UnifiedEvents and
generates correlated Incidents using configurable rules.
"""

import logging
from datetime import datetime
from typing import Dict, List, Set

from ..models.event import EventSeverity, UnifiedEvent
from ..models.incident import Incident, IncidentSeverity, IncidentStatus
from .rules import (
    CorrelationConfig,
    SiteTimeWindowRule,
    calculate_confidence_score,
    generate_incident_title,
    group_events_by_site_and_time,
)

logger = logging.getLogger(__name__)


class CorrelationEngine:
    """
    Deterministic correlation engine for the Naxis platform.

    Processes UnifiedEvents and generates correlated Incidents using
    simple site-based time-window grouping.

    Flow:
        1. Filter events by severity threshold
        2. Group events by site + time window
        3. Apply correlation rules to each group
        4. Generate Incident for each correlated group
        5. Calculate confidence scores
    """

    def __init__(self, config: CorrelationConfig = None):
        """Initialize correlation engine with optional config."""
        self.config = config or CorrelationConfig()
        self.rule = SiteTimeWindowRule()
        self._processed_events: Set[str] = set()  # Track processed event IDs

    def process_events(self, events: List[UnifiedEvent]) -> List[Incident]:
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

        logger.info(f"Processing {len(events)} events for correlation")

        # Filter out already-processed events
        new_events = [e for e in events if e.event_id not in self._processed_events]
        if not new_events:
            logger.info("All events already processed")
            return []

        logger.debug(f"Found {len(new_events)} new events to process")

        # Group events by site and time window
        groups = group_events_by_site_and_time(new_events, self.config)
        logger.info(f"Grouped events into {len(groups)} potential incident groups")

        # Generate incidents from groups
        incidents = []
        for group_key, group_events in groups.items():
            if self.rule.should_correlate(group_events, self.config):
                incident = self.create_incident(group_events)
                incidents.append(incident)

                # Mark events as processed
                for event in group_events:
                    self._processed_events.add(event.event_id)

                logger.info(
                    f"Created incident {incident.incident_id} from {len(group_events)} events (group: {group_key})"
                )
            else:
                logger.debug(
                    f"Group {group_key} with {len(group_events)} events did not meet correlation threshold"
                )

        logger.info(f"Generated {len(incidents)} correlated incidents")
        return incidents

    def create_incident(self, events: List[UnifiedEvent]) -> Incident:
        """
        Create an Incident from a group of correlated events.

        Args:
            events: List of correlated UnifiedEvent objects

        Returns:
            Incident object
        """
        if not events:
            raise ValueError("Cannot create incident from empty event list")

        # Generate title
        title = generate_incident_title(events)

        # Determine severity (highest severity among events)
        severity = self._determine_severity(events)

        # Extract blast radius
        affected_sites = list(
            {e.device.site_id for e in events if e.device and e.device.site_id}
        )
        affected_devices = list(
            {e.device.device_id for e in events if e.device and e.device.device_id}
        )
        affected_clients = list(
            {e.client.client_id for e in events if e.client and e.client.client_id}
        )

        # Create incident
        incident = Incident(
            title=title,
            severity=severity,
            status=IncidentStatus.OPEN,
            affected_sites=affected_sites,
            affected_devices=affected_devices,
            affected_clients=affected_clients,
            related_event_ids=[e.event_id for e in events],
        )

        # Calculate and set confidence score
        confidence = calculate_confidence_score(events)
        incident.confidence_score = confidence

        logger.debug(
            f"Created incident: {incident.incident_id} | "
            f"severity={severity.value} | "
            f"events={len(events)} | "
            f"devices={len(affected_devices)} | "
            f"confidence={confidence:.2f}"
        )

        return incident

    def correlate_site_events(
        self, events: List[UnifiedEvent], site_id: str
    ) -> List[Incident]:
        """
        Correlate events for a specific site.

        This is a convenience method for site-specific correlation.

        Args:
            events: All events to consider
            site_id: Site ID to filter by

        Returns:
            List of incidents for this site
        """
        site_events = [
            e for e in events if e.device and e.device.site_id == site_id
        ]
        return self.process_events(site_events)

    def group_by_site(self, events: List[UnifiedEvent]) -> Dict[str, List[UnifiedEvent]]:
        """
        Group events by site_id for inspection.

        Returns:
            Dict mapping site_id to list of events
        """
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
        """
        Determine incident severity from event severities.

        Takes the highest severity among all events.
        """
        if not events:
            return IncidentSeverity.INFO

        # Map EventSeverity to IncidentSeverity
        severity_map = {
            EventSeverity.CRITICAL: IncidentSeverity.CRITICAL,
            EventSeverity.MAJOR: IncidentSeverity.MAJOR,
            EventSeverity.MINOR: IncidentSeverity.MINOR,
            EventSeverity.WARNING: IncidentSeverity.WARNING,
            EventSeverity.INFO: IncidentSeverity.INFO,
            EventSeverity.DEBUG: IncidentSeverity.INFO,  # Map DEBUG to INFO for incidents
        }

        # Get highest severity
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


# Convenience function for quick correlation
def correlate_events(
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
    return engine.process_events(events)
