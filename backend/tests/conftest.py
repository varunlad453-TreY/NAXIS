"""
Test fixtures for the correlation engine and worker pipeline.
"""

from datetime import datetime, timedelta
from typing import List
from uuid import uuid4

import pytest

from backend.shared.correlation import CorrelationConfig
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
    """Default correlation configuration for tests."""
    return CorrelationConfig()


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
