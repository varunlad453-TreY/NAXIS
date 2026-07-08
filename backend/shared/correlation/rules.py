"""
Correlation Rules

Deterministic rules for grouping UnifiedEvents into Incidents.
MVP implementation uses simple site+time-window grouping, extended
with Stage 2 infrastructure-aware topology cascading.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Protocol, Set

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

    # Stage 2: Infrastructure-aware topology cascade
    topology_cascade_enabled: bool = True

    # When topology edges aren't available, fall back to device-type heuristics
    topology_fallback_to_device_type: bool = True

    # Infrastructure device types (potential root causes)
    infrastructure_device_types: Set[str] = field(
        default_factory=lambda: {
            "switch", "router", "wan_edge", "gateway",
            "controller", "firewall", "core_switch",
            "distribution_switch", "access_switch",
        }
    )

    # Leaf device types (potential symptoms)
    leaf_device_types: Set[str] = field(
        default_factory=lambda: {
            "ap", "access_point", "client", "endpoint",
            "sensor", "camera", "iot",
        }
    )

    # Severity to assign to symptom incidents
    symptom_severity: str = "info"


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


# ==============================================================================
# Stage 2: Infrastructure-Aware Topology Cascade
# ==============================================================================


class TopologyProvider(Protocol):
    """
    Protocol for topology queries used by TopologyCascadeRule.

    In production this is backed by PostgreSQL (topology_nodes / topology_edges).
    In tests a mock provider is injected directly.
    """

    async def get_parent_child_map(
        self, device_ids: Set[str]
    ) -> Dict[str, List[str]]:
        """
        Given a set of device_ids (from events), return a dict mapping
        each device_id to its direct children in the topology.

        Example:
            {"core-switch-01": ["ap-101", "ap-102", "ap-103"]}
        """
        ...

    async def get_all_descendants(
        self, device_id: str, max_depth: int = 5
    ) -> List[str]:
        """
        Return all descendant device_ids reachable from device_id
        via topology edges (cascade blast radius).
        """
        ...


@dataclass
class CascadeGroup:
    """
    A topology-aware group of events restructured by TopologyCascadeRule.

    One cascade group represents a single root-cause incident:
      - root_events: events on the infrastructure device that failed
      - symptom_events: events on leaf devices that failed as a consequence
      - root_device_id: the infrastructure device causing the cascade
    """

    root_events: List[UnifiedEvent]
    symptom_events: List[UnifiedEvent]
    root_device_id: str

    @property
    def total_events(self) -> int:
        return len(self.root_events) + len(self.symptom_events)

    def all_event_ids(self) -> List[str]:
        return [e.event_id for e in self.root_events] + [
            e.event_id for e in self.symptom_events
        ]

    def all_device_ids(self) -> Set[str]:
        devices: Set[str] = set()
        for e in self.root_events:
            if e.device and e.device.device_id:
                devices.add(e.device.device_id)
        for e in self.symptom_events:
            if e.device and e.device.device_id:
                devices.add(e.device.device_id)
        return devices


class TopologyCascadeRule:
    """
    Infrastructure-aware topology cascade rule (Stage 2).

    Takes events already grouped by site+time (Stage 1) and reorganises
    them into root-cause + symptom groups based on infrastructure topology.

    Two modes:
      1. Topology-aware (production): uses TopologyProvider to query the
         topology graph from PostgreSQL.
      2. Device-type heuristic (fallback): when topology is unavailable,
         uses device_type to infer parent-child relationships.

    Flow:
      For each site+time group:
        1. Separate events by device_type into "infrastructure" and "leaf"
        2. If a TopologyProvider is available, query for parent-child edges
        3. For each infrastructure device with children in the group,
           create a CascadeGroup (root = infrastructure, symptoms = leaves)
        4. Leaf devices without an identified parent in the group stay
           in their original incident
    """

    def __init__(
        self,
        provider: Optional[TopologyProvider] = None,
        config: Optional[CorrelationConfig] = None,
    ):
        self._provider = provider
        self._config = config or CorrelationConfig()

    async def evaluate(
        self, group_events: List[UnifiedEvent]
    ) -> List[CascadeGroup]:
        """
        Evaluate a single site+time group and return topology-aware cascade groups.

        Args:
            group_events: Events already grouped by site+time (Stage 1)

        Returns:
            List of CascadeGroups. If no topology relationships are found,
            returns an empty list, and the caller should keep the original group.
        """
        if not group_events:
            return []

        # Separate infrastructure vs leaf events
        infra_events, leaf_events = self._separate_by_device_type(group_events)

        if not infra_events:
            return []

        # Try topology-aware mode first
        if self._provider:
            cascade_groups = await self._evaluate_with_topology(
                infra_events, leaf_events, group_events
            )
            if cascade_groups:
                return cascade_groups

        # Fallback: device-type heuristic
        if self._config.topology_fallback_to_device_type:
            return self._evaluate_by_device_type(infra_events, leaf_events)

        return []

    async def _evaluate_with_topology(
        self,
        infra_events: List[UnifiedEvent],
        leaf_events: List[UnifiedEvent],
        all_group_events: List[UnifiedEvent],
    ) -> List[CascadeGroup]:
        """Use the topology provider to find parent-child relationships."""
        if not self._provider:
            return []

        all_device_ids: Set[str] = set()
        for e in all_group_events:
            if e.device and e.device.device_id:
                all_device_ids.add(e.device.device_id)

        if not all_device_ids:
            return []

        parent_child_map = await self._provider.get_parent_child_map(
            all_device_ids
        )

        if not parent_child_map:
            return []

        # Group infra events by device_id so all events on the same device
        # become root_events together
        from collections import defaultdict

        infra_by_device: Dict[str, List[UnifiedEvent]] = defaultdict(list)
        for e in infra_events:
            dev_id = e.device.device_id if e.device else None
            if dev_id:
                infra_by_device[dev_id].append(e)

        cascade_groups: List[CascadeGroup] = []
        used_event_ids: Set[str] = set()

        for infra_dev_id, dev_events in infra_by_device.items():
            child_device_ids = parent_child_map.get(infra_dev_id, [])
            if not child_device_ids:
                continue

            # Build symptom events from leaf events whose device_id
            # is a child of this infrastructure device
            symptom_events = []
            for leaf_event in leaf_events:
                leaf_dev_id = (
                    leaf_event.device.device_id if leaf_event.device else None
                )
                if leaf_dev_id in child_device_ids:
                    if leaf_event.event_id not in used_event_ids:
                        symptom_events.append(leaf_event)
                        used_event_ids.add(leaf_event.event_id)

            # Also check infra events that might be children
            for other_infra in infra_events:
                other_dev_id = (
                    other_infra.device.device_id if other_infra.device else None
                )
                if other_dev_id in child_device_ids:
                    if other_infra.event_id not in used_event_ids:
                        symptom_events.append(other_infra)
                        used_event_ids.add(other_infra.event_id)

            if symptom_events:
                cascade_groups.append(
                    CascadeGroup(
                        root_events=dev_events,
                        symptom_events=symptom_events,
                        root_device_id=infra_dev_id,
                    )
                )
                # Mark ALL events on this device as used
                for e in dev_events:
                    used_event_ids.add(e.event_id)

        return cascade_groups

    def _evaluate_by_device_type(
        self,
        infra_events: List[UnifiedEvent],
        leaf_events: List[UnifiedEvent],
    ) -> List[CascadeGroup]:
        """
        Fallback: infer parent-child from device_type when topology
        edges are not available.

        Without topology data, conservatively merge ALL infrastructure events
        at the same site as root_events and ALL leaf events at that site as
        symptom_events. This avoids losing events and prevents creating
        spurious separate incidents for co-located infrastructure failures.
        """
        if not infra_events:
            return []

        from collections import defaultdict

        # Group infra events by site and leaf events by site
        infra_by_site: Dict[str, List[UnifiedEvent]] = defaultdict(list)
        for e in infra_events:
            s = e.device.site_id if e.device and e.device.site_id else ""
            infra_by_site[s].append(e)

        leaf_by_site: Dict[str, List[UnifiedEvent]] = defaultdict(list)
        for e in leaf_events:
            s = e.device.site_id if e.device and e.device.site_id else ""
            leaf_by_site[s].append(e)

        cascade_groups: List[CascadeGroup] = []
        used_leaf_ids: Set[str] = set()

        for site_id, site_infra in infra_by_site.items():
            site_leaves = [
                e
                for e in leaf_by_site.get(site_id, [])
                if e.event_id not in used_leaf_ids
            ]

            # Collect all unique root device IDs for this site
            root_device_ids = list(
                {
                    e.device.device_id
                    for e in site_infra
                    if e.device and e.device.device_id
                }
            )
            if not root_device_ids:
                continue

            # If there are leaf symptoms at the same site, create a cascade group.
            # If there are no leaves but we have infra events, also create a group
            # so the infra events aren't lost.
            if site_leaves or not leaf_by_site.get(site_id):
                cascade_groups.append(
                    CascadeGroup(
                        root_events=site_infra,
                        symptom_events=site_leaves,
                        root_device_id=root_device_ids[0],
                    )
                )
                for e in site_leaves:
                    used_leaf_ids.add(e.event_id)

        return cascade_groups

    def _separate_by_device_type(
        self, events: List[UnifiedEvent]
    ) -> tuple[List[UnifiedEvent], List[UnifiedEvent]]:
        """
        Separate events into infrastructure (potential root cause) and
        leaf (potential symptom) categories based on device_type.
        """
        infra: List[UnifiedEvent] = []
        leaf: List[UnifiedEvent] = []

        for event in events:
            device_type = (
                event.device.device_type.lower() if event.device and event.device.device_type else ""
            )
            if device_type in self._config.infrastructure_device_types:
                infra.append(event)
            elif device_type in self._config.leaf_device_types:
                leaf.append(event)
            else:
                # Unknown type — put in leaf as safe default
                leaf.append(event)

        return infra, leaf
