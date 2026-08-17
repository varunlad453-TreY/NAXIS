"""
Tests for the mist_ap_history diff-on-write ledger and its
reachability-transition computation.

Covers _to_snapshot, _snapshot_key, _has_meaningful_change, and
record_snapshots (including first sighting, unchanged polls, reachability
flips, firmware-only changes, and serial-less devices).
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.worker.collectors.mist_ap_history import (
    _has_meaningful_change,
    _snapshot_key,
    _to_snapshot,
    record_snapshots,
)


def _row(overrides=None):
    base = {
        "device_id": "mac-aa-bb",
        "serial": "SER123",
        "mac": "aa:bb:cc:dd:ee:ff",
        "hostname": "ap-01",
        "model": "AP32",
        "site_id": "site-1",
        "site_name": "Pimpri Plant",
        "firmware_version": "0.12.27452",
        "reachability": "reachable",
        "uptime_seconds": 1000,
    }
    base.update(overrides or {})
    return base


def _ledger_row(overrides=None):
    row = {
        "serial": "SER123",
        "mist_ap_id": "mac-aa-bb",
        "mac": "aa:bb:cc:dd:ee:ff",
        "hostname": "ap-01",
        "model": "AP32",
        "site_id": "site-1",
        "site_name": "Pimpri Plant",
        "firmware": "0.12.27452",
        "reachability": "reachable",
        "uptime_s": 1000,
    }
    row.update(overrides or {})
    return row


class _Row:
    """Dict-style asyncpg row mock."""

    def __init__(self, d):
        self._d = d

    def __getitem__(self, k):
        return self._d[k]

    def keys(self):
        return self._d.keys()

    def get(self, k, default=None):
        return self._d.get(k, default)


# ---------------------------------------------------------------------------
# _to_snapshot
# ---------------------------------------------------------------------------

class TestToSnapshot:
    def test_maps_all_fields(self):
        snap = _to_snapshot(_row())
        assert snap["mist_ap_id"] == "mac-aa-bb"
        assert snap["serial"] == "SER123"
        assert snap["mac"] == "aa:bb:cc:dd:ee:ff"
        assert snap["hostname"] == "ap-01"
        assert snap["model"] == "AP32"
        assert snap["site_id"] == "site-1"
        assert snap["site_name"] == "Pimpri Plant"
        assert snap["firmware"] == "0.12.27452"
        assert snap["reachability"] == "reachable"
        assert snap["uptime_s"] == 1000

    def test_defaults_for_missing_optional_fields(self):
        snap = _to_snapshot({"device_id": "d1"})
        assert snap["serial"] == ""
        assert snap["mac"] == ""
        assert snap["site_name"] == ""
        assert snap["reachability"] == "unknown"
        assert snap["uptime_s"] == 0


class TestSnapshotKey:
    def test_prefers_serial(self):
        snap = {"serial": "SER123", "mac": "aa:bb"}
        assert _snapshot_key(snap) == "SER123"

    def test_falls_back_to_mac(self):
        snap = {"serial": "", "mac": "aa:bb"}
        assert _snapshot_key(snap) == "aa:bb"

    def test_empty_when_both_missing(self):
        assert _snapshot_key({"serial": "", "mac": ""}) == ""


# ---------------------------------------------------------------------------
# _has_meaningful_change
# ---------------------------------------------------------------------------

class TestHasMeaningfulChange:
    def test_no_change_false(self):
        prev = _ledger_row()
        cur = _ledger_row()
        assert not _has_meaningful_change(prev, cur)

    def test_firmware_change_true(self):
        prev = _ledger_row()
        cur = _ledger_row({"firmware": "0.13.0"})
        assert _has_meaningful_change(prev, cur)

    def test_reachability_change_true(self):
        prev = _ledger_row()
        cur = _ledger_row({"reachability": "unreachable"})
        assert _has_meaningful_change(prev, cur)

    def test_site_change_true(self):
        prev = _ledger_row()
        cur = _ledger_row({"site_id": "site-2"})
        assert _has_meaningful_change(prev, cur)

    def test_uptime_increase_false(self):
        prev = _ledger_row()
        cur = _ledger_row({"uptime_s": 2000})
        assert not _has_meaningful_change(prev, cur)

    def test_uptime_decrease_true(self):
        prev = _ledger_row()
        cur = _ledger_row({"uptime_s": 500})
        assert _has_meaningful_change(prev, cur)


# ---------------------------------------------------------------------------
# record_snapshots
# ---------------------------------------------------------------------------

class TestRecordSnapshots:
    @pytest.mark.asyncio
    async def test_empty_input_returns_empty_and_no_db_calls(self):
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=AsyncMock()) as fetch, \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=AsyncMock()) as em:
            result = await record_snapshots([])
            assert result == []
            fetch.assert_not_called()
            em.assert_not_called()

    @pytest.mark.asyncio
    async def test_first_sighting_writes_and_reports_transition(self):
        fetch = AsyncMock(return_value=[])
        em = AsyncMock()
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots([_row({"reachability": "unreachable"})])

        assert len(result) == 1
        assert result[0]["prev_reachability"] is None
        assert result[0]["cur_reachability"] == "unreachable"
        assert result[0]["snapshot"]["mac"] == "aa:bb:cc:dd:ee:ff"
        em.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_unchanged_poll_writes_nothing_and_no_transition(self):
        fetch = AsyncMock(return_value=[_Row(_ledger_row())])
        em = AsyncMock()
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots([_row()])

        assert result == []
        em.assert_not_called()

    @pytest.mark.asyncio
    async def test_reachable_to_unreachable_reports_transition(self):
        fetch = AsyncMock(return_value=[_Row(_ledger_row({"reachability": "reachable"}))])
        em = AsyncMock()
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots([_row({"reachability": "unreachable"})])

        assert len(result) == 1
        assert result[0]["prev_reachability"] == "reachable"
        assert result[0]["cur_reachability"] == "unreachable"
        em.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_unreachable_to_reachable_reports_recovery(self):
        fetch = AsyncMock(return_value=[_Row(_ledger_row({"reachability": "unreachable"}))])
        em = AsyncMock()
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots([_row({"reachability": "reachable"})])

        assert len(result) == 1
        assert result[0]["prev_reachability"] == "unreachable"
        assert result[0]["cur_reachability"] == "reachable"

    @pytest.mark.asyncio
    async def test_firmware_change_writes_but_no_reachability_transition(self):
        fetch = AsyncMock(return_value=[_Row(_ledger_row())])
        em = AsyncMock()
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots([_row({"firmware_version": "0.13.0"})])

        assert result == []
        em.assert_awaited_once()  # ledger still records the change

    @pytest.mark.asyncio
    async def test_serial_less_device_keys_by_mac(self):
        fetch = AsyncMock(return_value=[_Row(_ledger_row({"serial": "aa:bb:cc:dd:ee:ff"}))])
        em = AsyncMock()
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots(
                [_row({"serial": "", "mac": "aa:bb:cc:dd:ee:ff", "reachability": "unreachable"})]
            )

        assert len(result) == 1
        assert result[0]["cur_reachability"] == "unreachable"
        args = fetch.await_args.args[1]
        assert "aa:bb:cc:dd:ee:ff" in args

    @pytest.mark.asyncio
    async def test_mixed_poll_only_transitions_for_changed_devices(self):
        fetch = AsyncMock(return_value=[
            _Row(_ledger_row({"serial": "SER1", "reachability": "reachable"})),
            _Row(_ledger_row({"serial": "SER2", "reachability": "unreachable"})),
            _Row(_ledger_row({"serial": "SER3", "reachability": "unreachable"})),
        ])
        em = AsyncMock()
        rows = [
            _row({"serial": "SER1", "mac": "m1", "reachability": "reachable"}),   # unchanged
            _row({"serial": "SER2", "mac": "m2", "reachability": "reachable"}),   # recovery
            _row({"serial": "SER3", "mac": "m3", "reachability": "unreachable"}), # unchanged down
        ]
        with patch("backend.worker.collectors.mist_ap_history.db.fetch", new=fetch), \
             patch("backend.worker.collectors.mist_ap_history.db.executemany", new=em):
            result = await record_snapshots(rows)

        assert len(result) == 1
        assert result[0]["snapshot"]["serial"] == "SER2"
        assert result[0]["prev_reachability"] == "unreachable"
        assert result[0]["cur_reachability"] == "reachable"
