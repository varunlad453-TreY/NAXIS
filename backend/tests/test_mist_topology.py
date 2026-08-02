"""
Tests for MistApHistoryCollector reachability-transition event emission.

Verifies the collector no longer emits a CRITICAL event for every
disconnected AP on every poll — only on state transitions — and that
recovery (device_reachable) events are emitted when devices come back.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.shared.models.collector_outcome import CollectorOutcome
from backend.shared.models.event import EventSeverity, EventType
from backend.worker.collectors.mist_topology import MistApHistoryCollector


def _device(overrides=None):
    base = {
        "mac": "aa:bb:cc:dd:ee:ff",
        "serial": "SER123",
        "name": "ap-pimpri-01",
        "model": "AP32",
        "uptime": 1000,
        "version": "0.12.27452",
        "connected": True,
    }
    base.update(overrides or {})
    return base


def _snapshot(overrides=None):
    base = {
        "device_id": "aa:bb:cc:dd:ee:ff",
        "serial": "SER123",
        "mac": "aa:bb:cc:dd:ee:ff",
        "hostname": "ap-pimpri-01",
        "model": "AP32",
        "site_id": "site-1",
        "site_name": "Pimpri Plant",
        "firmware": "0.12.27452",
        "reachability": "reachable",
        "uptime_s": 1000,
    }
    base.update(overrides or {})
    return base


def _collector():
    return MistApHistoryCollector(AsyncMock(), "https://mist.example", "org-1")


async def _run_collect(collector, transitions, site_devices=None, site_map=None):
    """Run collect() with record_snapshots patched to return `transitions`."""
    with patch(
        "backend.worker.collectors.mist_topology.record_snapshots",
        new=AsyncMock(return_value=transitions),
    ):
        return await collector.collect(
            ["site-1"],
            site_devices or {"site-1": [_device()]},
            site_map,
        )


# ---------------------------------------------------------------------------
# _to_snapshot
# ---------------------------------------------------------------------------

class TestToSnapshot:
    def test_builds_row_with_reachability_from_connected(self):
        collector = _collector()
        snap = collector._to_snapshot("site-1", _device({"connected": False}))
        assert snap["reachability"] == "unreachable"
        assert snap["mac"] == "aa:bb:cc:dd:ee:ff"
        assert snap["serial"] == "SER123"
        assert snap["uptime_seconds"] == 1000

    def test_site_name_from_map(self):
        collector = _collector()
        snap = collector._to_snapshot(
            "site-1", _device(), {"site-1": "Pimpri Plant"}
        )
        assert snap["site_name"] == "Pimpri Plant"

    def test_site_name_fallback_placeholder(self):
        collector = _collector()
        snap = collector._to_snapshot("site-1", _device(), {})
        assert snap["site_name"] == "site-" + "site-1"[:8]

    def test_missing_mac_returns_none(self):
        collector = _collector()
        assert collector._to_snapshot("site-1", _device({"mac": ""})) is None

    def test_serial_falls_back_to_mac(self):
        collector = _collector()
        snap = collector._to_snapshot("site-1", _device({"serial": None}))
        assert snap["serial"] == "aa:bb:cc:dd:ee:ff"


# ---------------------------------------------------------------------------
# _event_from_transition
# ---------------------------------------------------------------------------

class TestEventFromTransition:
    def test_reachable_to_unreachable_emits_critical_outage(self):
        collector = _collector()
        event = collector._event_from_transition({
            "snapshot": _snapshot({"reachability": "unreachable"}),
            "prev_reachability": "reachable",
            "cur_reachability": "unreachable",
        })
        assert event is not None
        assert event.severity == EventSeverity.CRITICAL
        assert event.event_type == EventType.DEVICE_UNREACHABLE
        assert event.device.device_name == "ap-pimpri-01"
        assert event.device.site_name == "Pimpri Plant"
        assert event.metadata["reachability_transition"] == "reachable -> unreachable"

    def test_unreachable_to_reachable_emits_info_recovery(self):
        collector = _collector()
        event = collector._event_from_transition({
            "snapshot": _snapshot({"reachability": "reachable"}),
            "prev_reachability": "unreachable",
            "cur_reachability": "reachable",
        })
        assert event is not None
        assert event.severity == EventSeverity.INFO
        assert event.event_type == EventType.DEVICE_REACHABLE

    def test_steady_unreachable_emits_nothing(self):
        collector = _collector()
        event = collector._event_from_transition({
            "snapshot": _snapshot({"reachability": "unreachable"}),
            "prev_reachability": "unreachable",
            "cur_reachability": "unreachable",
        })
        assert event is None

    def test_steady_reachable_emits_nothing(self):
        collector = _collector()
        event = collector._event_from_transition({
            "snapshot": _snapshot({"reachability": "reachable"}),
            "prev_reachability": "reachable",
            "cur_reachability": "reachable",
        })
        assert event is None

    def test_first_sighting_down_emits_critical(self):
        collector = _collector()
        event = collector._event_from_transition({
            "snapshot": _snapshot({"reachability": "unreachable"}),
            "prev_reachability": None,
            "cur_reachability": "unreachable",
        })
        assert event is not None
        assert event.severity == EventSeverity.CRITICAL
        assert event.event_type == EventType.DEVICE_UNREACHABLE

    def test_first_sighting_up_emits_nothing(self):
        collector = _collector()
        event = collector._event_from_transition({
            "snapshot": _snapshot({"reachability": "reachable"}),
            "prev_reachability": None,
            "cur_reachability": "reachable",
        })
        assert event is None


# ---------------------------------------------------------------------------
# collect()
# ---------------------------------------------------------------------------

class TestCollect:
    @pytest.mark.asyncio
    async def test_single_outage_transition_emits_one_event(self):
        collector = _collector()
        outcome = await _run_collect(
            collector,
            [{
                "snapshot": _snapshot({"reachability": "unreachable"}),
                "prev_reachability": "reachable",
                "cur_reachability": "unreachable",
            }],
        )
        assert outcome.status == "success"
        assert len(outcome.events) == 1
        assert outcome.events[0].severity == EventSeverity.CRITICAL
        assert outcome.metadata["transitions"] == 1
        assert outcome.metadata["devices_seen"] == 1

    @pytest.mark.asyncio
    async def test_unchanged_down_device_emits_zero_events(self):
        """The flood fix: a device down across polls produces nothing."""
        collector = _collector()
        outcome = await _run_collect(collector, [])
        assert outcome.status == "success"
        assert outcome.events == []
        assert outcome.metadata["transitions"] == 0

    @pytest.mark.asyncio
    async def test_down_then_up_emits_outage_then_recovery(self):
        collector = _collector()
        outcome = await _run_collect(
            collector,
            [
                {
                    "snapshot": _snapshot({"reachability": "unreachable"}),
                    "prev_reachability": "reachable",
                    "cur_reachability": "unreachable",
                },
                {
                    "snapshot": _snapshot({"reachability": "reachable"}),
                    "prev_reachability": "unreachable",
                    "cur_reachability": "reachable",
                },
            ],
        )
        assert [e.event_type for e in outcome.events] == [
            EventType.DEVICE_UNREACHABLE,
            EventType.DEVICE_REACHABLE,
        ]

    @pytest.mark.asyncio
    async def test_site_map_flows_into_event_site_name(self):
        collector = _collector()
        outcome = await _run_collect(
            collector,
            [{
                "snapshot": _snapshot({"reachability": "unreachable"}),
                "prev_reachability": "reachable",
                "cur_reachability": "unreachable",
            }],
            site_map={"site-1": "Pimpri Plant"},
        )
        assert outcome.events[0].device.site_name == "Pimpri Plant"

    @pytest.mark.asyncio
    async def test_ledger_failure_marks_outcome_error(self):
        collector = _collector()
        with patch(
            "backend.worker.collectors.mist_topology.record_snapshots",
            new=AsyncMock(side_effect=RuntimeError("ledger down")),
        ):
            outcome = await collector.collect(["site-1"], {"site-1": [_device()]})
        assert outcome.status == "error"
        assert outcome.events == []
        assert "ledger down" in outcome.error_text

    @pytest.mark.asyncio
    async def test_missing_mac_devices_skipped(self):
        collector = _collector()
        with patch(
            "backend.worker.collectors.mist_topology.record_snapshots",
            new=AsyncMock(return_value=[]),
        ) as rs:
            outcome = await collector.collect(
                ["site-1"], {"site-1": [_device({"mac": ""}), _device()]}
            )
        assert outcome.status == "success"
        assert rs.await_args.args[0][0]["mac"] == "aa:bb:cc:dd:ee:ff"
        assert outcome.metadata["devices_seen"] == 1
