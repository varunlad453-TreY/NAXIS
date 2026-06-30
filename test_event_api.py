#!/usr/bin/env python3
"""
Test Event API

Tests for the new GET /events endpoint.
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services.event_service import event_service  # noqa: E402
from backend.shared.models.event import (  # noqa: E402
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)

client = TestClient(app)


async def _seed_events():
    """Insert a few test events into the event service."""
    events = [
        UnifiedEvent(
            event_id="evt-test-001",
            timestamp=datetime.utcnow(),
            source=EventSource.DNAC,
            severity=EventSeverity.CRITICAL,
            category=EventCategory.CONNECTIVITY,
            event_type=EventType.LINK_DOWN,
            title="Link down on core switch",
            description="GigabitEthernet0/0/1 is down",
            device=DeviceInfo(
                device_id="dev-core-01",
                device_name="core-switch-01",
                device_type="switch",
                site_id="site-sfo-01",
                site_name="SFO-01",
            ),
        ),
        UnifiedEvent(
            event_id="evt-test-002",
            timestamp=datetime.utcnow(),
            source=EventSource.MIST,
            severity=EventSeverity.MAJOR,
            category=EventCategory.PERFORMANCE,
            event_type=EventType.HIGH_CPU,
            title="High CPU on AP",
            description="CPU usage above 90% for 5 minutes",
            device=DeviceInfo(
                device_id="dev-ap-01",
                device_name="ap-01",
                device_type="ap",
                site_id="site-sfo-01",
                site_name="SFO-01",
            ),
        ),
    ]
    await event_service.add_events(events)


def test_list_events():
    """Test listing events via the API."""
    asyncio.run(_seed_events())

    response = client.get("/events")
    assert response.status_code == 200

    data = response.json()
    assert "events" in data
    assert "total" in data
    assert data["total"] >= 2

    event = data["events"][0]
    assert "event_id" in event
    assert "source" in event
    assert "severity" in event
    assert "device_id" in event


def test_filter_events_by_source():
    """Test filtering events by source."""
    asyncio.run(_seed_events())

    response = client.get("/events?source=dnac")
    assert response.status_code == 200

    data = response.json()
    for event in data["events"]:
        assert event["source"] == "dnac"


def test_filter_events_by_site():
    """Test filtering events by site."""
    asyncio.run(_seed_events())

    response = client.get("/events?site_id=site-sfo-01")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] >= 2
