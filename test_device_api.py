#!/usr/bin/env python3
"""
Test Device API

Tests for the new GET /devices endpoint.
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services.device_service import device_service  # noqa: E402
from backend.shared.models.event import (  # noqa: E402
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    UnifiedEvent,
)

client = TestClient(app)


async def _seed_devices():
    """Seed device service with devices extracted from events."""
    events = [
        UnifiedEvent(
            event_id="evt-dev-001",
            timestamp=datetime.utcnow(),
            source=EventSource.DNAC,
            severity=EventSeverity.CRITICAL,
            category=EventCategory.CONNECTIVITY,
            event_type=EventType.LINK_DOWN,
            title="Link down",
            description="Link down on core switch",
            device=DeviceInfo(
                device_id="dev-core-01",
                device_name="core-switch-01",
                device_type="switch",
                site_id="site-sfo-01",
                site_name="SFO-01",
            ),
        ),
        UnifiedEvent(
            event_id="evt-dev-002",
            timestamp=datetime.utcnow(),
            source=EventSource.MIST,
            severity=EventSeverity.MAJOR,
            category=EventCategory.PERFORMANCE,
            event_type=EventType.HIGH_CPU,
            title="High CPU",
            description="High CPU on AP",
            device=DeviceInfo(
                device_id="dev-ap-01",
                device_name="ap-01",
                device_type="ap",
                site_id="site-nyc-01",
                site_name="NYC-01",
            ),
        ),
    ]
    await device_service.upsert_from_events(events)


def test_list_devices():
    """Test listing devices via the API."""
    asyncio.run(_seed_devices())

    response = client.get("/devices")
    assert response.status_code == 200

    data = response.json()
    assert "devices" in data
    assert "total" in data
    assert data["total"] >= 2

    device = data["devices"][0]
    assert "device_id" in device
    assert "platform" in device
    assert "site_id" in device


def test_filter_devices_by_platform():
    """Test filtering devices by platform."""
    asyncio.run(_seed_devices())

    response = client.get("/devices?platform=dnac")
    assert response.status_code == 200

    data = response.json()
    for device in data["devices"]:
        assert device["platform"] == "dnac"
