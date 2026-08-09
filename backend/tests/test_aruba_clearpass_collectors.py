"""
Unit & Integration Tests for Aruba Central & ClearPass Collectors (WP-3.5).

Verifies:
  - Aruba Central inventory row building and identity registration
  - ClearPass RADIUS authentication log normalization
  - TopologySync Aruba node and edge generation
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.worker.collectors.aruba_central import ArubaCentralCollector, _build_aruba_rows
from backend.worker.collectors.clearpass import ClearPassCollector, _normalize_clearpass_events
from backend.worker.collectors.topology_sync import TopologySync


def test_build_aruba_rows_identifies_switches_and_aps():
    devices = [
        {
            "serial": "ARUBA-SW-01",
            "name": "Aruba-CX-6300-Core",
            "macaddr": "00:11:22:33:44:55",
            "model": "Aruba CX 6300",
            "type": "switch",
            "site": "San Jose Plant",
            "status": "up",
            "ip_address": "10.50.1.10",
        },
        {
            "serial": "ARUBA-AP-01",
            "name": "Aruba-AP-515-Lobby",
            "macaddr": "66:77:88:99:aa:bb",
            "model": "AP-515",
            "type": "ap",
            "site": "San Jose Plant",
            "status": "up",
            "ip_address": "10.50.1.55",
        },
    ]

    rows = _build_aruba_rows(devices)
    assert len(rows) == 2

    sw = next(r for r in rows if r["serial"] == "ARUBA-SW-01")
    assert sw["device_type"] == "switch"
    assert sw["hostname"] == "Aruba-CX-6300-Core"
    assert sw["ip_address"] == "10.50.1.10"

    ap = next(r for r in rows if r["serial"] == "ARUBA-AP-01")
    assert ap["device_type"] == "ap"
    assert ap["hostname"] == "Aruba-AP-515-Lobby"


def test_normalize_clearpass_events():
    raw_logs = [
        {
            "id": "1001",
            "calling_station_id": "001122334455",
            "user_name": "user@enterprise.com",
            "auth_status": "ACCEPT",
            "nas_ip_address": "10.10.1.1",
            "nas_name": "Core-Switch-01",
        },
        {
            "id": "1002",
            "calling_station_id": "66778899aabb",
            "user_name": "baduser@enterprise.com",
            "auth_status": "REJECT",
            "nas_ip_address": "10.10.1.1",
            "nas_name": "Core-Switch-01",
        },
    ]

    events = _normalize_clearpass_events(raw_logs)
    assert len(events) == 2

    pass_evt = events[0]
    assert pass_evt.source.value == "clearpass"
    assert pass_evt.severity.value == "info"
    assert pass_evt.client.username == "user@enterprise.com"

    fail_evt = events[1]
    assert fail_evt.source.value == "clearpass"
    assert fail_evt.severity.value == "major"
    assert fail_evt.client.username == "baduser@enterprise.com"


@pytest.mark.asyncio
async def test_aruba_central_collector_unconfigured():
    with patch("backend.worker.collectors.aruba_central.get_settings") as mock_settings:
        mock_settings.return_value.aruba_central_enabled = False
        collector = ArubaCentralCollector()
        outcome = await collector.collect()
        assert outcome.status == "skipped"


@pytest.mark.asyncio
async def test_clearpass_collector_unconfigured():
    with patch("backend.worker.collectors.clearpass.get_settings") as mock_settings:
        mock_settings.return_value.clearpass_enabled = False
        collector = ClearPassCollector()
        outcome = await collector.collect()
        assert outcome.status == "skipped"


@pytest.mark.asyncio
async def test_topology_sync_creates_aruba_nodes():
    mock_aruba_inventory = [
        {
            "device_id": "ARUBA-SW-01",
            "hostname": "Aruba-CX-6300-Core",
            "ip_address": "10.50.1.10",
            "model": "CX-6300",
            "site_id": "aruba-site-sjo",
            "site_name": "San Jose Plant",
            "connected": True,
            "reachability": "reachable",
            "firmware_version": "10.12.0001",
            "device_type": "switch",
        }
    ]

    syncer = TopologySync()

    with patch("backend.worker.collectors.topology_sync.db.fetch", AsyncMock(return_value=mock_aruba_inventory)), \
         patch.object(syncer._identity, "resolve_sites", AsyncMock(return_value={("aruba", "aruba-site-sjo"): "site-key-aruba"})), \
         patch.object(syncer._identity, "resolve_devices", AsyncMock(return_value={("aruba", "ARUBA-SW-01"): "dev-key-aruba"})), \
         patch("backend.worker.collectors.topology_sync._upsert_node", AsyncMock()) as mock_node, \
         patch("backend.worker.collectors.topology_sync._upsert_edge", AsyncMock()):

        await syncer._sync_aruba_topology()

        node_calls = mock_node.call_args_list
        aruba_call = next((c for c in node_calls if c.kwargs.get("vendor") == "aruba" and c.kwargs.get("node_type") == "switch"), None)
        assert aruba_call is not None
        assert aruba_call.kwargs["name"] == "Aruba-CX-6300-Core"
        assert aruba_call.kwargs["node_type"] == "switch"
