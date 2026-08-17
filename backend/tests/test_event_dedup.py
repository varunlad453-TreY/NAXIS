"""
Tests for polled-state emitter dedup (diff-on-write).

mist-ap-rf and mist-wired-uplink previously emitted a fresh event for
every radio / link on every poll (~600K events/48h). They now compare
the current poll against the last persisted event per stable
source_event_id and skip steady states.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.shared.models.collector_outcome import CollectorOutcome
from backend.shared.models.event import EventSeverity, EventType
from backend.worker.collectors.mist_topology import (
    MistApRfCollector,
    MistWiredUplinkCollector,
)
from backend.shared.database.events import latest_event_states


def _device(radio_bands=None, overrides=None):
    base = {
        "mac": "aa:bb:cc:dd:ee:ff",
        "name": "ap-pimpri-01",
        "model": "AP32",
        "radio_stat": radio_bands or {},
    }
    base.update(overrides or {})
    return base


def _rf_collector():
    return MistApRfCollector(AsyncMock(), "https://mist.example", "org-1")


def _uplink_ap(connected=True):
    return {
        "mac": "aa:bb:cc:dd:ee:ff",
        "name": "ap-pimpri-01",
        "connected": connected,
        "lldp_stats": {
            "ge-0/0/0": {
                "system_name": "sw-01",
                "chassis_id": "11:22:33:44:55:66",
                "port_id": "ge-0/0/1",
                "port_desc": "uplink1",
            }
        },
    }


def _uplink_collector():
    return MistWiredUplinkCollector(AsyncMock(), "https://mist.example", "org-1")


# ---------------------------------------------------------------------------
# latest_event_states
# ---------------------------------------------------------------------------


class TestLatestEventStates:
    @pytest.mark.asyncio
    async def test_fetch_shapes_states_by_source_event_id(self):
        with patch("backend.shared.database.events.db.fetch", new=AsyncMock(return_value=[
            {"source_event_id": "mist-rf-a-1", "event_type": "other",
             "metadata": '{"mist_rf_level": "elevated"}'},
            {"source_event_id": "mist-rf-b-2", "event_type": "high_bandwidth",
             "metadata": '{"mist_rf_level": "high"}'},
        ])) as fetch:
            states = await latest_event_states(["mist-rf-a-1", "mist-rf-b-2"])
        assert states["mist-rf-a-1"]["metadata"]["mist_rf_level"] == "elevated"
        assert states["mist-rf-b-2"]["event_type"] == "high_bandwidth"
        assert "ANY($1::text[])" in fetch.await_args.args[0]

    @pytest.mark.asyncio
    async def test_empty_input_skips_query(self):
        with patch("backend.shared.database.events.db.fetch", new=AsyncMock()) as fetch:
            assert await latest_event_states([]) == {}
            assert await latest_event_states(["", None]) == {}
        fetch.assert_not_called()


# ---------------------------------------------------------------------------
# MistApRfCollector — steady states are skipped
# ---------------------------------------------------------------------------


class TestRfLevels:
    def test_level_buckets(self):
        assert MistApRfCollector._rf_level(90) == "high"
        assert MistApRfCollector._rf_level(81) == "high"
        assert MistApRfCollector._rf_level(80) == "elevated"
        assert MistApRfCollector._rf_level(61) == "elevated"
        assert MistApRfCollector._rf_level(60) == "clear"
        assert MistApRfCollector._rf_level(10) == "clear"
        assert MistApRfCollector._rf_level(None) == "clear"


class TestRfCollect:
    def _bands(self, utilization):
        return {"band_24": {"channel": 1, "tx_power": 17, "num_clients": 5,
                            "utilization": utilization, "bssid": "11:22:33:44:55:66"}}

    @pytest.mark.asyncio
    async def test_steady_state_produces_no_events(self):
        collector = _rf_collector()
        states = {"mist-rf-aa:bb:cc:dd:ee:ff-band_24":
                  {"event_type": "other", "metadata": {"mist_rf_level": "elevated"}}}
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value=states)):
            outcome = await collector.collect(["site-1"], {"site-1": [_device(self._bands(65))]})
        assert outcome.status == "success"
        assert outcome.events == []

    @pytest.mark.asyncio
    async def test_level_change_emits_event(self):
        collector = _rf_collector()
        states = {"mist-rf-aa:bb:cc:dd:ee:ff-band_24":
                  {"event_type": "other", "metadata": {"mist_rf_level": "elevated"}}}
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value=states)):
            outcome = await collector.collect(["site-1"], {"site-1": [_device(self._bands(90))]})
        assert len(outcome.events) == 1
        event = outcome.events[0]
        assert event.event_type == EventType.HIGH_BANDWIDTH
        assert event.severity == EventSeverity.WARNING
        assert event.source_event_id == "mist-rf-aa:bb:cc:dd:ee:ff-band_24"
        assert event.metadata["mist_rf_level"] == "high"
        assert event.raw_event is None

    @pytest.mark.asyncio
    async def test_first_poll_emits_baseline(self):
        collector = _rf_collector()
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value={})):
            outcome = await collector.collect(["site-1"], {"site-1": [_device(self._bands(30))]})
        assert len(outcome.events) == 1
        assert outcome.events[0].metadata["mist_rf_level"] == "clear"

    @pytest.mark.asyncio
    async def test_back_to_clear_emits_recovery_event(self):
        collector = _rf_collector()
        states = {"mist-rf-aa:bb:cc:dd:ee:ff-band_24":
                  {"event_type": "high_bandwidth", "metadata": {"mist_rf_level": "high"}}}
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value=states)):
            outcome = await collector.collect(["site-1"], {"site-1": [_device(self._bands(20))]})
        assert len(outcome.events) == 1
        assert outcome.events[0].metadata["mist_rf_level"] == "clear"


# ---------------------------------------------------------------------------
# MistWiredUplinkCollector — flips only
# ---------------------------------------------------------------------------


class TestUplinkCollect:
    @pytest.mark.asyncio
    async def test_steady_up_produces_no_events(self):
        collector = _uplink_collector()
        key = "mist-uplink-aa:bb:cc:dd:ee:ff-ge-0/0/0"
        states = {key: {"event_type": "link_up", "metadata": {}}}
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value=states)):
            outcome = await collector.collect(["site-1"], {"site-1": [_uplink_ap(True)]})
        assert outcome.status == "success"
        assert outcome.events == []

    @pytest.mark.asyncio
    async def test_down_flip_emits_link_down(self):
        collector = _uplink_collector()
        key = "mist-uplink-aa:bb:cc:dd:ee:ff-ge-0/0/0"
        states = {key: {"event_type": "link_up", "metadata": {}}}
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value=states)):
            outcome = await collector.collect(["site-1"], {"site-1": [_uplink_ap(False)]})
        assert len(outcome.events) == 1
        assert outcome.events[0].event_type == EventType.LINK_DOWN
        assert outcome.events[0].source_event_id == key

    @pytest.mark.asyncio
    async def test_recovery_emits_link_up_after_down(self):
        collector = _uplink_collector()
        key = "mist-uplink-aa:bb:cc:dd:ee:ff-ge-0/0/0"
        states = {key: {"event_type": "link_down", "metadata": {}}}
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value=states)):
            outcome = await collector.collect(["site-1"], {"site-1": [_uplink_ap(True)]})
        assert len(outcome.events) == 1
        assert outcome.events[0].event_type == EventType.LINK_UP

    @pytest.mark.asyncio
    async def test_first_poll_emits_current_state(self):
        collector = _uplink_collector()
        with patch("backend.worker.collectors.mist_topology.latest_event_states",
                   new=AsyncMock(return_value={})):
            outcome = await collector.collect(["site-1"], {"site-1": [_uplink_ap(True)]})
        assert len(outcome.events) == 1
        assert outcome.events[0].event_type == EventType.LINK_UP
