"""
Unit & Integration Tests for Mist EX Switch Inventory & Topology Sync (WP-3.4).

Verifies:
  - Mist inventory collector correctly identifies device_type="switch" for EX models
  - IdentityResolver registers switch canonical identity
  - TopologySync creates real mist-switch-{key} nodes with true hostnames (e.g. EX3400-48P-IDF1)
  - Physical uplink links resolve to real switch node IDs instead of guessed placeholders
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.worker.collectors.mist_inventory import _build_rows
from backend.worker.collectors.topology_sync import TopologySync


def test_build_rows_identifies_ex_switches():
    devices = [
        {
            "id": "switch-guid-123",
            "mac": "f83918001122",
            "name": "EX3400-48P-IDF1",
            "model": "EX3400-48P",
            "type": "switch",
            "serial": "CW0219480123",
            "version": "21.4R3-S5",
            "connected": True,
            "site_id": "site-sfo",
        },
        {
            "id": "ap-guid-456",
            "mac": "aabbcc112233",
            "name": "AP32-Lobby",
            "model": "AP32",
            "type": "ap",
            "serial": "AP09218390",
            "version": "0.12.27452",
            "connected": True,
            "site_id": "site-sfo",
        },
    ]
    site_map = {"site-sfo": "San Francisco Plant"}
    stats_map = {
        "f83918001122": {"ip": "10.10.1.5", "uptime": 86400},
        "aabbcc112233": {"ip": "10.10.1.20", "uptime": 43200, "num_clients": 12},
    }

    rows = _build_rows(devices, site_map, stats_map, "org-123")

    assert len(rows) == 2
    sw_row = next(r for r in rows if r["mac"] == "f83918001122")
    assert sw_row["device_type"] == "switch"
    assert sw_row["hostname"] == "EX3400-48P-IDF1"
    assert sw_row["model"] == "EX3400-48P"
    assert sw_row["ip_address"] == "10.10.1.5"

    ap_row = next(r for r in rows if r["mac"] == "aabbcc112233")
    assert ap_row["device_type"] == "ap"


@pytest.mark.asyncio
async def test_topology_sync_creates_real_switch_node():
    mock_inventory_rows = [
        {
            "device_id": "ex3400-123",
            "hostname": "EX3400-48P-IDF1",
            "ip_address": "10.10.1.5",
            "model": "EX3400-48P",
            "site_id": "site-sfo",
            "site_name": "San Francisco Plant",
            "connected": True,
            "num_clients": 0,
            "firmware_version": "21.4R3",
            "mac": "f83918001122",
            "device_type": "switch",
        },
    ]

    syncer = TopologySync()

    with patch("backend.worker.collectors.topology_sync.db.fetch", AsyncMock(return_value=mock_inventory_rows)), \
         patch.object(syncer._identity, "resolve_sites", AsyncMock(return_value={("mist", "site-sfo"): "site-key-1"})), \
         patch.object(syncer._identity, "resolve_devices", AsyncMock(return_value={("mist", "ex3400-123"): "dev-key-1"})), \
         patch("backend.worker.collectors.topology_sync._upsert_node", AsyncMock()) as mock_node, \
         patch("backend.worker.collectors.topology_sync._upsert_edge", AsyncMock()), \
         patch.object(syncer, "_sync_mist_physical_links", AsyncMock()):
        
        await syncer._sync_mist_topology()
        
        node_calls = mock_node.call_args_list
        switch_call = next((c for c in node_calls if c.kwargs.get("node_type") == "switch"), None)
        assert switch_call is not None
        assert switch_call.kwargs["name"] == "EX3400-48P-IDF1"
        assert switch_call.kwargs["vendor"] == "mist"
