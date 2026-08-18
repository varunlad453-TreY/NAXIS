"""
Test fixtures for the correlation engine and worker pipeline.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
from uuid import uuid4

import pytest

from backend.shared.correlation import (
    CascadeGroup,
    CorrelationConfig,
    TopologyCascadeRule,
    TopologyProvider,
)
from backend.shared.models.event import (
    ClientInfo,
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)


def make_event(
    event_id: str = None,
    source: EventSource = EventSource.MIST,
    severity: EventSeverity = EventSeverity.MAJOR,
    category: EventCategory = EventCategory.CONNECTIVITY,
    event_type: EventType = EventType.LINK_DOWN,
    title: str = "Test event",
    description: str = "Test description",
    device_id: str = "dev-001",
    device_name: str = "ap-001",
    device_type: str = "ap",
    site_id: str = "site-sfo-01",
    site_name: str = "SFO-01",
    client_id: str = None,
    timestamp: datetime = None,
) -> UnifiedEvent:
    """Factory helper for creating test events."""
    if event_id is None:
        event_id = f"evt-{uuid4().hex[:12]}"
    if timestamp is None:
        timestamp = datetime.utcnow()

    device = DeviceInfo(
        device_id=device_id,
        device_name=device_name,
        device_type=device_type,
        site_id=site_id,
        site_name=site_name,
    )

    client = None
    if client_id:
        client = ClientInfo(client_id=client_id)

    return UnifiedEvent(
        event_id=event_id,
        timestamp=timestamp,
        source=source,
        severity=severity,
        category=category,
        event_type=event_type,
        title=title,
        description=description,
        device=device,
        client=client,
    )


@pytest.fixture
def default_config() -> CorrelationConfig:
    """Default correlation configuration for tests.
    
    Note: topology_cascade_enabled is False by default in tests so
    existing Stage 1 tests are not affected. Tests that exercise
    Stage 2 should use topology_aware_config or set cascade explicitly.
    """
    return CorrelationConfig(topology_cascade_enabled=False)


@pytest.fixture
def tight_window_config() -> CorrelationConfig:
    """Tight time window for testing window boundaries."""
    return CorrelationConfig(time_window_seconds=10, min_event_count=2)


@pytest.fixture
def single_critical_config() -> CorrelationConfig:
    """Config that allows single critical events."""
    return CorrelationConfig(correlate_single_critical=True)


@pytest.fixture
def high_threshold_config() -> CorrelationConfig:
    """Config requiring many events."""
    return CorrelationConfig(min_event_count=5, min_severity=EventSeverity.CRITICAL)


@pytest.fixture
def site_sfo_events(default_config) -> List[UnifiedEvent]:
    """Fixture: 3 events at site-sfo-01 within 3 minutes."""
    now = datetime.utcnow()
    return [
        make_event(
            event_id="sfo-evt-1",
            severity=EventSeverity.CRITICAL,
            event_type=EventType.LINK_DOWN,
            title="WAN link down",
            device_id="edge-sfo-01",
            device_name="edge-sfo-01",
            device_type="wan_edge",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now,
        ),
        make_event(
            event_id="sfo-evt-2",
            severity=EventSeverity.MAJOR,
            event_type=EventType.HIGH_LATENCY,
            title="High latency on uplink",
            device_id="edge-sfo-01",
            device_name="edge-sfo-01",
            device_type="wan_edge",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=60),
        ),
        make_event(
            event_id="sfo-evt-3",
            severity=EventSeverity.MAJOR,
            event_type=EventType.CLIENT_DISCONNECTED,
            title="Client disconnects elevated",
            device_id="ap-sfo-01",
            device_name="ap-sfo-01",
            device_type="ap",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=120),
        ),
    ]


@pytest.fixture
def multi_site_events(default_config) -> List[UnifiedEvent]:
    """Fixture: events across 3 different sites."""
    now = datetime.utcnow()
    return [
        make_event(
            event_id="multi-evt-1",
            severity=EventSeverity.CRITICAL,
            title="SFO WAN down",
            device_id="edge-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now,
        ),
        make_event(
            event_id="multi-evt-2",
            severity=EventSeverity.CRITICAL,
            title="NYC WAN down",
            device_id="edge-nyc-01",
            site_id="site-nyc-01",
            site_name="NYC-01",
            timestamp=now + timedelta(seconds=30),
        ),
        make_event(
            event_id="multi-evt-3",
            severity=EventSeverity.MAJOR,
            title="LAX latency spike",
            device_id="edge-lax-01",
            site_id="site-lax-01",
            site_name="LAX-01",
            timestamp=now + timedelta(seconds=60),
        ),
    ]


@pytest.fixture
def cross_vendor_events(default_config) -> List[UnifiedEvent]:
    """Fixture: Mist + VeloCloud events at the same site."""
    now = datetime.utcnow()
    return [
        make_event(
            event_id="cv-evt-1",
            source=EventSource.MIST,
            severity=EventSeverity.CRITICAL,
            event_type=EventType.LINK_DOWN,
            title="Mist AP unreachable",
            device_id="ap-sfo-01",
            device_type="ap",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now,
        ),
        make_event(
            event_id="cv-evt-2",
            source=EventSource.VELOCLOUD,
            severity=EventSeverity.CRITICAL,
            event_type=EventType.TUNNEL_DOWN,
            title="VeloCloud tunnel down",
            device_id="edge-sfo-01",
            device_type="wan_edge",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=30),
        ),
        make_event(
            event_id="cv-evt-3",
            source=EventSource.DNAC,
            severity=EventSeverity.MAJOR,
            event_type=EventType.INTERFACE_DOWN,
            title="DNAC switch interface down",
            device_id="sw-sfo-01",
            device_type="switch",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=60),
        ),
    ]


@pytest.fixture
def info_only_events(default_config) -> List[UnifiedEvent]:
    """Fixture: only INFO severity events (should not correlate)."""
    now = datetime.utcnow()
    return [
        make_event(
            event_id="info-evt-1",
            severity=EventSeverity.INFO,
            event_type=EventType.LINK_UP,
            title="Link restored",
            device_id="edge-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now,
        ),
        make_event(
            event_id="info-evt-2",
            severity=EventSeverity.INFO,
            event_type=EventType.LINK_UP,
            title="AP back online",
            device_id="ap-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=60),
        ),
    ]


@pytest.fixture
def out_of_window_events(default_config) -> List[UnifiedEvent]:
    """Fixture: same site but events far apart (outside time window)."""
    now = datetime.utcnow()
    return [
        make_event(
            event_id="window-evt-1",
            severity=EventSeverity.CRITICAL,
            title="Morning issue",
            device_id="edge-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now,
        ),
        make_event(
            event_id="window-evt-2",
            severity=EventSeverity.CRITICAL,
            title="Afternoon issue",
            device_id="edge-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(hours=2),
        ),
    ]


@pytest.fixture
def topology_aware_config() -> CorrelationConfig:
    """Configuration with topology cascade enabled."""
    return CorrelationConfig(
        topology_cascade_enabled=True,
    )


@pytest.fixture
def cascade_events_same_site() -> List[UnifiedEvent]:
    """
    Fixture: simulate a cascading failure.
    One infrastructure device (core switch) fails, 3 APs downstream go down.

    Expected: topology cascade should identify core-switch-01 as root cause
    and the 3 APs as symptoms.
    """
    now = datetime.utcnow()
    return [
        make_event(
            event_id="cascade-root-1",
            severity=EventSeverity.CRITICAL,
            event_type=EventType.LINK_DOWN,
            title="Core switch uplink down",
            device_id="core-switch-01",
            device_name="naxis-core-01",
            device_type="switch",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now,
        ),
        make_event(
            event_id="cascade-leaf-1",
            severity=EventSeverity.MAJOR,
            event_type=EventType.DEVICE_UNREACHABLE,
            title="AP-101 unreachable",
            device_id="ap-sfo-101",
            device_name="ap-101",
            device_type="ap",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=10),
        ),
        make_event(
            event_id="cascade-leaf-2",
            severity=EventSeverity.MAJOR,
            event_type=EventType.DEVICE_UNREACHABLE,
            title="AP-102 unreachable",
            device_id="ap-sfo-102",
            device_name="ap-102",
            device_type="ap",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=15),
        ),
        make_event(
            event_id="cascade-leaf-3",
            severity=EventSeverity.MAJOR,
            event_type=EventType.DEVICE_UNREACHABLE,
            title="AP-103 unreachable",
            device_id="ap-sfo-103",
            device_name="ap-103",
            device_type="ap",
            site_id="site-sfo-01",
            site_name="SFO-01",
            timestamp=now + timedelta(seconds=20),
        ),
    ]


@pytest.fixture
def cascade_events_multi_infra() -> List[UnifiedEvent]:
    """
    Fixture: two infrastructure devices at the same site with
    cascading effects — tests that each infra device gets its own incident.
    """
    now = datetime.utcnow()
    return [
        make_event(
            event_id="multi-root-1",
            severity=EventSeverity.CRITICAL,
            title="Core switch A down",
            device_id="core-switch-A",
            device_name="naxis-core-A",
            device_type="switch",
            site_id="site-nyc-01",
            site_name="NYC-01",
            timestamp=now,
        ),
        make_event(
            event_id="multi-leaf-a1",
            severity=EventSeverity.MAJOR,
            title="AP under switch A unreachable",
            device_id="ap-nyc-A1",
            device_name="ap-nyc-A1",
            device_type="ap",
            site_id="site-nyc-01",
            site_name="NYC-01",
            timestamp=now + timedelta(seconds=5),
        ),
        make_event(
            event_id="multi-leaf-a2",
            severity=EventSeverity.MAJOR,
            title="AP under switch A unreachable",
            device_id="ap-nyc-A2",
            device_name="ap-nyc-A2",
            device_type="ap",
            site_id="site-nyc-01",
            site_name="NYC-01",
            timestamp=now + timedelta(seconds=10),
        ),
        make_event(
            event_id="multi-root-2",
            severity=EventSeverity.CRITICAL,
            title="WAN edge B down",
            device_id="edge-nyc-B",
            device_name="edge-nyc-B",
            device_type="wan_edge",
            site_id="site-nyc-01",
            site_name="NYC-01",
            timestamp=now + timedelta(seconds=30),
        ),
        make_event(
            event_id="multi-leaf-b1",
            severity=EventSeverity.MAJOR,
            title="Site behind WAN edge unreachable",
            device_id="ap-nyc-B1",
            device_name="ap-nyc-B1",
            device_type="ap",
            site_id="site-nyc-01",
            site_name="NYC-01",
            timestamp=now + timedelta(seconds=35),
        ),
    ]


@pytest.fixture
def cascade_events_no_infra() -> List[UnifiedEvent]:
    """
    Fixture: only leaf devices with events — no infrastructure device.
    Topology cascade should not trigger and falls back to Stage 1.
    """
    now = datetime.utcnow()
    return [
        make_event(
            event_id="leaf-only-1",
            severity=EventSeverity.CRITICAL,
            title="AP-1 unreachable",
            device_id="ap-site-01",
            device_name="ap-1",
            device_type="ap",
            site_id="site-lax-01",
            site_name="LAX-01",
            timestamp=now,
        ),
        make_event(
            event_id="leaf-only-2",
            severity=EventSeverity.MAJOR,
            title="AP-2 unreachable",
            device_id="ap-site-02",
            device_name="ap-2",
            device_type="ap",
            site_id="site-lax-01",
            site_name="LAX-01",
            timestamp=now + timedelta(seconds=60),
        ),
    ]


# ==============================================================================
# Mock Topology Provider for Stage 2 tests
# ==============================================================================


class MockTopologyProvider:
    """
    A TopologyProvider seeded with known parent-child relationships
    for testing the TopologyCascadeRule without a database.

    Example:
        provider = MockTopologyProvider({
            "core-switch-01": ["ap-sfo-101", "ap-sfo-102", "ap-sfo-103"],
            "core-switch-A": ["ap-nyc-A1", "ap-nyc-A2"],
            "edge-nyc-B": ["ap-nyc-B1"],
        })
    """

    def __init__(self, parent_child_map: Dict[str, List[str]] = None):
        self._map: Dict[str, List[str]] = dict(parent_child_map or {})

    async def get_parent_child_map(
        self, device_ids: Set[str]
    ) -> Dict[str, List[str]]:
        """Return parent→children entries where both parent and at least
        one child are in the given device_ids."""
        result: Dict[str, List[str]] = {}
        for parent, children in self._map.items():
            matched_children = [c for c in children if c in device_ids]
            if parent in device_ids and matched_children:
                result[parent] = matched_children
        return result

    async def get_all_descendants(
        self, device_id: str, max_depth: int = 5
    ) -> List[str]:
        return list(self._map.get(device_id, []))

    async def get_parent_map(self, device_ids: Set[str]) -> Dict[str, str]:
        """Inverse of the parent→children map.

        Unlike get_parent_child_map this does NOT require the parent itself to
        appear in device_ids — the whole point is to name a parent that never
        emitted an event.
        """
        result: Dict[str, str] = {}
        for parent, children in self._map.items():
            for child in children:
                if child in device_ids:
                    result[child] = parent
        return result


@pytest.fixture
def mock_topology_provider() -> MockTopologyProvider:
    """Mock topology with known infrastructure→leaf relationships."""
    return MockTopologyProvider({
        "core-switch-01": ["ap-sfo-101", "ap-sfo-102", "ap-sfo-103"],
        "core-switch-A": ["ap-nyc-A1", "ap-nyc-A2"],
        "edge-nyc-B": ["ap-nyc-B1"],
    })



@ pytest.fixture
def events_with_clients(default_config) -> List[UnifiedEvent]:
    """Fixture: events with client information for blast radius testing."""
    now = datetime.utcnow()
    return [
        make_event(
            event_id="client-evt-1",
            severity=EventSeverity.CRITICAL,
            title="AP down",
            device_id="ap-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            client_id="client-001",
            timestamp=now,
        ),
        make_event(
            event_id="client-evt-2",
            severity=EventSeverity.MAJOR,
            title="Client disconnect surge",
            device_id="ap-sfo-01",
            site_id="site-sfo-01",
            site_name="SFO-01",
            client_id="client-002",
            timestamp=now + timedelta(seconds=30),
        ),
        make_event(
            event_id="client-evt-3",
            severity=EventSeverity.MAJOR,
            title="Client reconnection fail",
            device_id="ap-sfo-02",
            site_id="site-sfo-01",
            site_name="SFO-01",
            client_id="client-003",
            timestamp=now + timedelta(seconds=60),
        ),
    ]
