"""
Correlation Rules

Deterministic rules for grouping UnifiedEvents into Incidents.
MVP implementation uses simple site+time-window grouping.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Protocol

from ..models.event import EventSeverity, UnifiedEvent


@dataclass
class CorrelationConfig:
    """Configuration for the correlation engine."""

    # Time window for grouping events (seconds)
    time_window_seconds: int = 300  # 5 minutes default

    # Minimum severity to trigger correlation
    min_severity: EventSeverity = EventSeverity.MAJOR

    # Minimum event count to create an incident
    min_event_count: int = 2

    # Whether to correlate single high-severity events
    correlate_single_critical: bool = True


class CorrelationRule(Protocol):
    """Protocol for correlation rules."""

    def should_correlate(
        self, events: List[UnifiedEvent], config: CorrelationConfig
    ) -> bool:
        """Return True if the events should be correlated into an incident."""
        ...

    def group_key(self, event: UnifiedEvent) -> str:
        """Return the grouping key for this event."""
        ...


class SiteTimeWindowRule:
    """
    Site-based time-window correlation rule.

    Groups events by:
      1. site_id (spatial proximity)
      2. timestamp (temporal proximity within configured window)
      3. severity (only MAJOR/CRITICAL events)

    This is the primary MVP correlation rule.
    """

    def should_correlate(
        self, events: List[UnifiedEvent], config: CorrelationConfig
    ) -> bool:
        """
        Determine if events should be correlated.

        Rules:
          - At least min_event_count events with severity >= min_severity
          - OR a single CRITICAL event (if config allows)
        """
        if not events:
            return False

        # Count high-severity events
        high_severity_count = sum(
            1
            for e in events
            if self._is_high_severity(e.severity, config.min_severity)
        )

        # Single critical event correlation
        if config.correlate_single_critical:
            critical_count = sum(1 for e in events if e.severity == EventSeverity.CRITICAL)
            if critical_count > 0:
                return True

        # Multi-event correlation
        return high_severity_count >= config.min_event_count

    def group_key(self, event: UnifiedEvent) -> str:
        """
        Generate grouping key for site-based correlation.

        Key format: "site:{site_id}"
        Events without site_id are grouped by device_id as fallback.
        """
        if event.device and event.device.site_id:
            return f"site:{event.device.site_id}"
        elif event.device and event.device.device_id:
            return f"device:{event.device.device_id}"
        else:
            return f"event:{event.event_id}"  # Ungroupable events

    def are_in_time_window(
        self, event1: UnifiedEvent, event2: UnifiedEvent, window_seconds: int
    ) -> bool:
        """Check if two events are within the time window."""
        delta = abs((event1.timestamp - event2.timestamp).total_seconds())
        return delta <= window_seconds

    @staticmethod
    def _is_high_severity(severity: EventSeverity, min_severity: EventSeverity) -> bool:
        """Check if severity meets the minimum threshold."""
        severity_order = {
            EventSeverity.CRITICAL: 5,
            EventSeverity.MAJOR: 4,
            EventSeverity.MINOR: 3,
            EventSeverity.WARNING: 2,
            EventSeverity.INFO: 1,
            EventSeverity.DEBUG: 0,
        }
        return severity_order.get(severity, 0) >= severity_order.get(min_severity, 0)


def group_events_by_site_and_time(
    events: List[UnifiedEvent], config: CorrelationConfig
) -> Dict[str, List[UnifiedEvent]]:
    """
    Group events by site and time window.

    Returns a dict: {group_key: [events]} where events in each group
    are within the time window and share the same site.
    """
    rule = SiteTimeWindowRule()
    groups: Dict[str, List[UnifiedEvent]] = {}

    # Sort events by timestamp for efficient windowing
    sorted_events = sorted(events, key=lambda e: e.timestamp)

    for event in sorted_events:
        # Skip low-severity events
        if not rule._is_high_severity(event.severity, config.min_severity):
            continue

        group_key = rule.group_key(event)
        placed = False

        # Try to add to existing group within time window
        if group_key in groups:
            existing_group = groups[group_key]
            # Check if this event is within window of any event in the group
            for existing_event in existing_group:
                if rule.are_in_time_window(
                    event, existing_event, config.time_window_seconds
                ):
                    existing_group.append(event)
                    placed = True
                    break

        # Create new group if not placed
        if not placed:
            # If group key exists but outside window, create new sub-group
            # by appending a timestamp suffix
            if group_key in groups:
                # Find next available sub-group
                idx = 1
                while f"{group_key}:{idx}" in groups:
                    idx += 1
                group_key = f"{group_key}:{idx}"
            groups[group_key] = [event]

    return groups


def calculate_confidence_score(events: List[UnifiedEvent]) -> float:
    """
    Calculate confidence score for a correlated incident.

    Factors:
      - Event count (more events = higher confidence)
      - Severity distribution (more CRITICAL = higher confidence)
      - Device diversity (more devices = higher confidence)

    Returns: float in [0.0, 1.0]
    """
    if not events:
        return 0.0

    # Base score from event count (logarithmic scale)
    import math

    event_score = min(1.0, math.log(len(events) + 1) / math.log(10))

    # Severity score
    severity_weights = {
        EventSeverity.CRITICAL: 1.0,
        EventSeverity.MAJOR: 0.7,
        EventSeverity.MINOR: 0.4,
        EventSeverity.WARNING: 0.2,
        EventSeverity.INFO: 0.1,
        EventSeverity.DEBUG: 0.0,
    }
    avg_severity = sum(severity_weights.get(e.severity, 0.0) for e in events) / len(
        events
    )

    # Device diversity score
    unique_devices = len(
        {e.device.device_id for e in events if e.device and e.device.device_id}
    )
    device_score = min(1.0, unique_devices / 5.0)  # Normalize by 5 devices

    # Weighted combination
    confidence = (event_score * 0.4) + (avg_severity * 0.4) + (device_score * 0.2)

    return min(1.0, max(0.0, confidence))


def generate_incident_title(events: List[UnifiedEvent]) -> str:
    """
    Generate a human-readable incident title from events.

    Format: "{Site/Device} - {Primary Issue Type} affecting {N} devices"
    """
    if not events:
        return "Unknown incident"

    # Get site/location
    sites = {e.device.site_name for e in events if e.device and e.device.site_name}
    site_ids = {e.device.site_id for e in events if e.device and e.device.site_id}

    if sites:
        location = f"Site {list(sites)[0]}"
    elif site_ids:
        location = f"Site {list(site_ids)[0]}"
    else:
        location = "Multiple locations"

    # Get primary issue type (most common category)
    from collections import Counter

    categories = [e.category.value for e in events]
    primary_category = Counter(categories).most_common(1)[0][0]

    # Count affected devices
    device_count = len(
        {e.device.device_id for e in events if e.device and e.device.device_id}
    )

    if device_count > 1:
        return f"{location} - {primary_category} issues affecting {device_count} devices"
    else:
        return f"{location} - {primary_category} issue"
