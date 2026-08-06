"""
Tests for WP-2.5: Device & Link State History (diff-on-write).
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
import pytest

from backend.shared.models.event import (
    DeviceInfo,
    EventCategory,
    EventSeverity,
    EventSource,
    EventType,
    InterfaceInfo,
    UnifiedEvent,
)
from backend.shared.models.state_history import (
    DeviceStateTransition,
    LinkStateTransition,
)
import backend.shared.database.state_history as sh_mod
import backend.shared.database.events as events_mod


@pytest.fixture(autouse=True)
def _reset_cache():
    sh_mod.clear_state_history_cache()
    yield
    sh_mod.clear_state_history_cache()


def _make_mock_event(event_type=EventType.DEVICE_UNREACHABLE, device_id="dev-001", site_id="site-01"):
    return UnifiedEvent(
        event_id="evt-sh-100",
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
        received_at=datetime.now(timezone.utc).replace(tzinfo=None),
        source=EventSource.MIST,
        severity=EventSeverity.CRITICAL,
        category=EventCategory.SYSTEM,
        event_type=event_type,
        title="State event",
        description="State event description",
        device=DeviceInfo(device_id=device_id, site_id=site_id),
        interface=InterfaceInfo(interface_name="ge-0/0/1"),
    )


# ---------------------------------------------------------------------------
# 1. Device State History tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_record_device_state_transition_first_time():
    """First transition for a device must record state history."""
    fetch = AsyncMock(return_value=[{
        "history_id": 1,
        "device_key": "dev-100",
        "site_key": "site-01",
        "previous_state": None,
        "new_state": "offline",
        "duration_seconds": None,
        "transition_reason": "device_unreachable",
        "event_id": "evt-001",
        "recorded_at": datetime(2026, 8, 6, 12, 0, 0),
    }])
    with patch.object(sh_mod.db, "fetch", fetch):
        res = await sh_mod.record_device_state_transition(
            device_key="dev-100",
            new_state="offline",
            transition_reason="device_unreachable",
            event_id="evt-001",
            site_key="site-01",
        )

    assert res is not None
    assert res.device_key == "dev-100"
    assert res.new_state == "offline"
    assert res.previous_state is None


@pytest.mark.asyncio
async def test_diff_on_write_skips_identical_device_state():
    """Identical state update for same device must be silently ignored (0 bloat)."""
    t1 = datetime(2026, 8, 6, 12, 0, 0, tzinfo=timezone.utc)
    sh_mod._latest_device_states["dev-100"] = ("offline", t1)

    fetch = AsyncMock(return_value=[])
    with patch.object(sh_mod.db, "fetch", fetch):
        res = await sh_mod.record_device_state_transition(
            device_key="dev-100",
            new_state="offline",
            transition_reason="device_unreachable",
        )

    assert res is None
    fetch.assert_not_called()


@pytest.mark.asyncio
async def test_state_change_calculates_duration():
    """State change online -> offline must calculate previous duration_seconds."""
    t1 = datetime.now(timezone.utc) - timedelta(seconds=300)
    sh_mod._latest_device_states["dev-100"] = ("online", t1)

    fetch = AsyncMock(return_value=[{
        "history_id": 2,
        "device_key": "dev-100",
        "site_key": "site-01",
        "previous_state": "online",
        "new_state": "offline",
        "duration_seconds": 300.0,
        "transition_reason": "device_unreachable",
        "event_id": "evt-002",
        "recorded_at": datetime.now(timezone.utc),
    }])
    with patch.object(sh_mod.db, "fetch", fetch):
        res = await sh_mod.record_device_state_transition(
            device_key="dev-100",
            new_state="offline",
            transition_reason="device_unreachable",
            event_id="evt-002",
        )

    assert res is not None
    assert res.previous_state == "online"
    assert res.new_state == "offline"
    assert res.duration_seconds is not None
    assert 295 < res.duration_seconds < 305


# ---------------------------------------------------------------------------
# 2. Link State History tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_link_state_transition_diff_on_write():
    """Link state changes must use diff-on-write semantics."""
    fetch = AsyncMock(return_value=[{
        "history_id": 10,
        "link_key": "switch-01->ap-01",
        "parent_node_id": "switch-01",
        "child_node_id": "ap-01",
        "previous_state": None,
        "new_state": "down",
        "duration_seconds": None,
        "transition_reason": "link_down",
        "event_id": "evt-link-1",
        "recorded_at": datetime(2026, 8, 6, 12, 0, 0),
    }])
    with patch.object(sh_mod.db, "fetch", fetch):
        res1 = await sh_mod.record_link_state_transition(
            parent_node_id="switch-01",
            child_node_id="ap-01",
            new_state="down",
            transition_reason="link_down",
        )

    assert res1 is not None
    assert res1.new_state == "down"

    # Second update with same state "down" should be skipped
    fetch.reset_mock()
    with patch.object(sh_mod.db, "fetch", fetch):
        res2 = await sh_mod.record_link_state_transition(
            parent_node_id="switch-01",
            child_node_id="ap-01",
            new_state="down",
        )
    assert res2 is None
    fetch.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Query repository functions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_device_state_history_query():
    fetch = AsyncMock(return_value=[{
        "history_id": 1,
        "device_key": "dev-100",
        "site_key": "site-01",
        "previous_state": "online",
        "new_state": "offline",
        "duration_seconds": 600.0,
        "transition_reason": "device_unreachable",
        "event_id": "evt-001",
        "recorded_at": datetime(2026, 8, 6, 12, 0, 0),
    }])
    with patch.object(sh_mod.db, "fetch", fetch):
        hist = await sh_mod.get_device_state_history("dev-100")

    assert len(hist) == 1
    assert hist[0].device_key == "dev-100"
    assert hist[0].new_state == "offline"


@pytest.mark.asyncio
async def test_get_link_state_history_query():
    fetch = AsyncMock(return_value=[{
        "history_id": 10,
        "link_key": "switch-01->ap-01",
        "parent_node_id": "switch-01",
        "child_node_id": "ap-01",
        "previous_state": "up",
        "new_state": "down",
        "duration_seconds": 120.0,
        "transition_reason": "link_down",
        "event_id": "evt-10",
        "recorded_at": datetime(2026, 8, 6, 12, 0, 0),
    }])
    with patch.object(sh_mod.db, "fetch", fetch):
        hist = await sh_mod.get_link_state_history("switch-01->ap-01")

    assert len(hist) == 1
    assert hist[0].link_key == "switch-01->ap-01"
    assert hist[0].new_state == "down"


# ---------------------------------------------------------------------------
# 4. Pipeline Event Hook integration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_insert_event_triggers_state_history():
    """insert_event must automatically call state history recorder for transition events."""
    event = _make_mock_event(event_type=EventType.DEVICE_UNREACHABLE)
    execute = AsyncMock(return_value="INSERT 0 1")

    record_mock = AsyncMock(return_value=None)
    with patch.object(events_mod.db, "execute", execute), \
         patch("backend.shared.database.state_history.record_device_state_transition", record_mock):
        await events_mod.insert_event(event)

    record_mock.assert_called_once()
    call_kwargs = record_mock.call_args.kwargs
    assert call_kwargs["device_key"] == "dev-001"
    assert call_kwargs["new_state"] == "offline"
