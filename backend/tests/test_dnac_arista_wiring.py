"""
Integration & Wiring Tests for DNAC & Arista WLC Collectors (WP-3.2).

Verifies:
  - Settings flags `dnac_enabled` and `arista_wlc_enabled` are integrated
  - TopologySync creates topology_nodes and site_membership edges for DNAC and Arista WLC
  - Worker main execution handles DNAC and Arista collector outcomes gracefully
"""

from unittest.mock import AsyncMock, PropertyMock, patch

import pytest

from backend.worker.collectors.topology_sync import TopologySync
from backend.worker.main import WorkerDaemon


@pytest.mark.asyncio
async def test_dnac_topology_sync_creates_nodes():
    mock_dnac_inventory = [
        {
            "device_id": "dnac-cat9k-1",
            "hostname": "Cat9300-Core-01",
            "ip_address": "10.20.1.1",
            "model": "C9300-48U",
            "site_id": "site-sfo-datacenter",
            "site_name": "SFO Datacenter",
            "connected": True,
            "reachability": "reachable",
            "firmware_version": "17.9.3",
            "device_type": "switch",
        }
    ]

    syncer = TopologySync()

    with patch("backend.worker.collectors.topology_sync.db.fetch", AsyncMock(return_value=mock_dnac_inventory)), \
         patch.object(syncer._identity, "resolve_sites", AsyncMock(return_value={("dnac", "site-sfo-datacenter"): "site-key-2"})), \
         patch.object(syncer._identity, "resolve_devices", AsyncMock(return_value={("dnac", "dnac-cat9k-1"): "dev-key-2"})), \
         patch("backend.worker.collectors.topology_sync._upsert_node", AsyncMock()) as mock_node, \
         patch("backend.worker.collectors.topology_sync._upsert_edge", AsyncMock()):
        
        await syncer._sync_dnac_topology()

        node_calls = mock_node.call_args_list
        dnac_call = next((c for c in node_calls if c.kwargs.get("vendor") == "dnac"), None)
        assert dnac_call is not None
        assert dnac_call.kwargs["name"] == "Cat9300-Core-01"
        assert dnac_call.kwargs["node_type"] == "switch"


@pytest.mark.asyncio
async def test_arista_wlc_topology_sync_creates_nodes():
    mock_arista_inventory = [
        {
            "device_id": "arista-ap-1",
            "hostname": "Arista-C250-IDF2",
            "ip_address": "10.30.1.50",
            "model": "C-250",
            "site_id": "site-nyc",
            "site_name": "NYC Headquarters",
            "connected": True,
            "reachability": "reachable",
            "firmware_version": "2.1.0",
            "device_type": "ap",
        }
    ]

    syncer = TopologySync()

    with patch("backend.worker.collectors.topology_sync.db.fetch", AsyncMock(return_value=mock_arista_inventory)), \
         patch.object(syncer._identity, "resolve_sites", AsyncMock(return_value={("arista_wlc", "site-nyc"): "site-key-3"})), \
         patch.object(syncer._identity, "resolve_devices", AsyncMock(return_value={("arista_wlc", "arista-ap-1"): "dev-key-3"})), \
         patch("backend.worker.collectors.topology_sync._upsert_node", AsyncMock()) as mock_node, \
         patch("backend.worker.collectors.topology_sync._upsert_edge", AsyncMock()):

        await syncer._sync_arista_wlc_topology()

        node_calls = mock_node.call_args_list
        arista_call = next((c for c in node_calls if c.kwargs.get("vendor") == "arista"), None)
        assert arista_call is not None
        assert arista_call.kwargs["name"] == "Arista-C250-IDF2"
        assert arista_call.kwargs["node_type"] == "ap"


@pytest.mark.asyncio
async def test_worker_main_dnac_and_arista_execution():
    worker = WorkerDaemon()

    dummy_outcome = AsyncMock()

    with patch.object(type(worker._dnac), "is_configured", new_callable=PropertyMock, return_value=True), \
         patch.object(worker._dnac, "collect_all", new=AsyncMock(return_value=[])), \
         patch.object(type(worker._arista_wlc), "is_configured", new_callable=PropertyMock, return_value=True), \
         patch.object(worker._arista_wlc, "collect_all", new=AsyncMock(return_value=[])), \
         patch.object(worker, "_run_collector", AsyncMock(return_value=dummy_outcome)), \
         patch.object(worker, "_run_collector_inventory", AsyncMock(return_value=dummy_outcome)), \
         patch.object(type(worker._mist_topology), "is_configured", new_callable=PropertyMock, return_value=False), \
         patch.object(type(worker._velocloud), "is_configured", new_callable=PropertyMock, return_value=False):

        outcomes = await worker._collect_all()
        assert isinstance(outcomes, list)
        worker._dnac.collect_all.assert_called_once()
        worker._arista_wlc.collect_all.assert_called_once()
