"""
Tests for WP-2.8 (Suppression, Auto-Close, Recursive CTE Traversal)
and WP-2.9 (Direct Topology Writes without Event Mining).
"""

from unittest.mock import AsyncMock, patch
import pytest

from backend.shared.database.topology import DatabaseTopologyProvider, get_devices_under_node


@pytest.mark.asyncio
async def test_get_devices_under_node_uses_loop_protected_recursive_cte():
    """Verify recursive CTE query executes with path tracking loop protection."""
    mock_db = AsyncMock()
    mock_db.fetch = AsyncMock(return_value=[
        {"node_id": "switch-02"},
        {"node_id": "mist-ap-01"},
    ])

    with patch("backend.shared.database.topology.db", mock_db):
        res = await get_devices_under_node("switch-01", max_depth=10)

    assert res == ["switch-02", "mist-ap-01"]
    query = mock_db.fetch.await_args[0][0]
    assert "WITH RECURSIVE downstream AS" in query
    assert "ARRAY[parent_node_id] AS path" in query
    assert "NOT (l.child_node_id = ANY(d.path))" in query


@pytest.mark.asyncio
async def test_get_all_descendants_bulk():
    """Verify get_all_descendants_bulk runs a single batch SQL query for multiple device IDs."""
    provider = DatabaseTopologyProvider()

    mock_db = AsyncMock()
    mock_db.fetch = AsyncMock(side_effect=[
        # batch_resolve_node_ids -> devices/nodes match
        [{"canonical_key": "sw-1", "node_id": "switch-sw-1"}, {"canonical_key": "sw-2", "node_id": "switch-sw-2"}],
        # Recursive CTE bulk descendants query
        [{"root_id": "switch-sw-1", "node_id": "mist-ap-ap1"}, {"root_id": "switch-sw-1", "node_id": "mist-ap-ap2"}]
    ])

    with patch("backend.shared.database.topology.db", mock_db):
        descendants = await provider.get_all_descendants_bulk({"sw-1", "sw-2"}, max_depth=10)

    assert "sw-1" in descendants
    assert descendants["sw-1"] == ["ap1", "ap2"]


@pytest.mark.asyncio
async def test_topology_sync_builds_links_without_events_table():
    """WP-2.9: Verify topology_sync reads physical links directly from inventory when events table is empty."""
    from backend.worker.collectors.topology_sync import TopologySync

    ts = TopologySync()
    mock_db = AsyncMock()
    
    # Simulate empty events table but populated inventory table
    async def mock_fetch(query, *args):
        if "FROM inventory" in query:
            return [{
                "device_id": "ap-mac-01",
                "switch_mac": "001122334455",
                "port_id": "ge-0/0/1",
                "site_id": "site-101",
                "attributes": {"mist_switch_mac": "001122334455", "mist_port_id": "ge-0/0/1"},
                "raw_data": {},
            }]
        return []

    mock_db.fetch = AsyncMock(side_effect=mock_fetch)
    mock_db.fetchrow = AsyncMock(return_value={"node_id": "mist-ap-ap-mac-01"})
    mock_db.execute = AsyncMock()

    with patch("backend.worker.collectors.topology_sync.db", mock_db):
        await ts._sync_mist_physical_links({"ap-mac-01": "mist-ap-ap-mac-01"})

    # Verify link upsert executed
    exec_calls = [c.args[0] for c in mock_db.execute.await_args_list if c.args]
    assert any("INSERT INTO links" in q or "INSERT INTO topology_nodes" in q for q in exec_calls)
