"""
Integration tests for DatabaseTopologyProvider.

Tests the critical identifier translation between topology node_ids
(e.g. "mist-ap-abc123") and event device_ids (e.g. "abc123") that enables
the cascade engine to correctly match parent-child relationships.

See the bug this prevents:
  DatabaseTopologyProvider.get_parent_child_map() returns children as
  topology node_ids ("mist-ap-abc123") but TopologyCascadeRule expects
  event device_ids ("abc123"). Without the reverse-index translation in
  get_parent_child_map(), cascade silently falls back to device-type
  heuristics every time — no topology edges are ever matched.
"""

from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, patch

import pytest

from backend.shared.database.topology import DatabaseTopologyProvider


def _node_row(node_id: str, canonical_key: Optional[str] = None) -> Dict[str, str]:
    return {"node_id": node_id, "canonical_key": canonical_key or node_id}


def _link_row(parent_node_id: str, child_node_id: str) -> Dict[str, str]:
    return {"parent_node_id": parent_node_id, "child_node_id": child_node_id}


# ── Mock wiring ────────────────────────────────────────────────────────────────

def _make_provider() -> DatabaseTopologyProvider:
    return DatabaseTopologyProvider()


async def _run_batch_resolve(device_ids, node_ids_in_db):
    """
    Simulate batch_resolve_node_ids by patching db.fetch so the
    ANY($1) query returns rows for the node_ids that exist.

    Identity-aware lookup is short-circuited so these tests exercise the
    canonical-key and legacy-prefix resolution paths.
    """
    rows = [_node_row(nid) for nid in node_ids_in_db]
    with patch(
        "backend.shared.database.topology._resolve_node_id_via_identity",
        new=AsyncMock(return_value={}),
    ):
        with patch("backend.shared.database.topology.db.fetch", AsyncMock(return_value=rows)):
            with patch("backend.shared.database.topology.db.pool", AsyncMock()):
                provider = _make_provider()
                return await provider.batch_resolve_node_ids(set(device_ids))


async def _run_parent_child_map(device_ids, node_ids_in_db, link_rows):
    """
    Simulate get_parent_child_map with two patched db.fetch calls:
    1. batch_resolve_node_ids → node rows
    2. link query → link rows
    """
    node_rows = [_node_row(nid) for nid in node_ids_in_db]
    # batch_resolve_node_ids now makes two internal fetches (canonical + legacy),
    # then get_parent_child_map fetches links — three returns total.
    fetch_returns = [node_rows, node_rows, link_rows]
    with patch(
        "backend.shared.database.topology._resolve_node_id_via_identity",
        new=AsyncMock(return_value={}),
    ):
        with patch("backend.shared.database.topology.db.fetch", AsyncMock(side_effect=fetch_returns)):
            with patch("backend.shared.database.topology.db.pool", AsyncMock()):
                provider = _make_provider()
                return await provider.get_parent_child_map(set(device_ids))


async def _run_get_all_descendants(device_id, node_ids_in_db, children_map, max_depth=5):
    """
    Simulate get_all_descendants patching db.fetchrow (for resolve_node_id)
    and db.fetch (for get_children recursively).
    """
    provider = _make_provider()
    node_set = set(node_ids_in_db)

    # resolve_node_id → check if device_id maps to a node_id
    resolved_node_id = None
    for nid in node_ids_in_db:
        # Known prefixes in the test
        for prefix in ["mist-ap-", "switch-", "velo-edge-", "mist-site-"]:
            if nid.startswith(prefix) and nid[len(prefix):] == device_id:
                resolved_node_id = nid
                break
        if resolved_node_id:
            break

    if not resolved_node_id:
        with patch(
            "backend.shared.database.topology._resolve_node_id_via_identity",
            new=AsyncMock(return_value={}),
        ):
            with patch("backend.shared.database.topology.db.fetchrow", AsyncMock(return_value=None)):
                with patch("backend.shared.database.topology.db.pool", AsyncMock()):
                    return await provider.get_all_descendants(device_id, max_depth)

    # Build side_effect for get_devices_under_node CTE query
    def _collect_descendants(start_node, max_depth=5):
        """Recursively collect all descendant node_ids from children_map."""
        result = []
        seen = set()
        def walk(node, depth):
            if depth <= 0 or node in seen:
                return
            seen.add(node)
            for child in children_map.get(node, []):
                cid = child["node_id"]
                result.append(cid)
                walk(cid, depth - 1)
        walk(start_node, max_depth)
        return result

    def fetch_side_effect(sql, *args):
        if "SELECT node_id FROM topology_nodes" in sql:
            return [{"node_id": resolved_node_id}]
        if "WITH RECURSIVE downstream" in sql:
            # CTE against links table: parent_node_id = $1, max_depth = $2
            parent_id = args[0] if args else None
            max_depth = args[1] if len(args) > 1 else 5
            descendants = _collect_descendants(parent_id, max_depth)
            return [{"node_id": nid} for nid in descendants]
        if "SELECT n.node_id" in sql:
            # Fallback for legacy get_children queries
            parent_id = args[0] if args else None
            return children_map.get(parent_id, [])
        return []

    def fetchrow_side_effect(sql, *args):
        candidate = args[0] if args else None
        if candidate is None:
            return None
        # Canonical-key lookup returns the node if the device_id itself is a node
        if "WHERE canonical_key = $1" in sql:
            return _node_row(candidate) if candidate in node_set else None
        # Legacy node_id lookup
        if "WHERE node_id = $1" in sql:
            return _node_row(candidate) if candidate in node_set else None
        return None

    with patch(
        "backend.shared.database.topology._resolve_node_id_via_identity",
        new=AsyncMock(return_value={}),
    ):
        with patch("backend.shared.database.topology.db.fetch", AsyncMock(side_effect=fetch_side_effect)):
            with patch("backend.shared.database.topology.db.fetchrow", AsyncMock(side_effect=fetchrow_side_effect)):
                with patch("backend.shared.database.topology.db.pool", AsyncMock()):
                    return await provider.get_all_descendants(device_id, max_depth)


# ==============================================================================
# batch_resolve_node_ids — device_id → node_id translation
# ==============================================================================

class TestBatchResolveNodeIds:
    pytestmark = pytest.mark.asyncio

    async def test_no_device_ids_returns_empty(self):
        result = await _run_batch_resolve([], [])
        assert result == {}

    async def test_empty_database_returns_all_none(self):
        result = await _run_batch_resolve(["ap-101", "sw-01"], [])
        assert result == {"ap-101": None, "sw-01": None}

    async def test_exact_device_id_match(self):
        result = await _run_batch_resolve(["abc123"], ["abc123"])
        assert result == {"abc123": "abc123"}

    async def test_mist_ap_prefix_pattern(self):
        result = await _run_batch_resolve(["abc123"], ["mist-ap-abc123"])
        assert result == {"abc123": "mist-ap-abc123"}

    async def test_velo_edge_prefix_pattern(self):
        result = await _run_batch_resolve(["vc-edge-001"], ["velo-edge-vc-edge-001"])
        assert result == {"vc-edge-001": "velo-edge-vc-edge-001"}

    async def test_switch_mac_address(self):
        result = await _run_batch_resolve(["00:11:22:aa:bb:cc"], ["switch-00:11:22:aa:bb:cc"])
        assert result == {"00:11:22:aa:bb:cc": "switch-00:11:22:aa:bb:cc"}

    async def test_mixed_prefixes(self):
        device_ids = ["ap-101", "sw-01", "edge-42", "unknown"]
        node_ids = ["mist-ap-ap-101", "switch-01", "velo-edge-edge-42"]
        result = await _run_batch_resolve(device_ids, node_ids)
        assert result["ap-101"] == "mist-ap-ap-101"
        assert result["sw-01"] is None
        assert result["edge-42"] == "velo-edge-edge-42"
        assert result["unknown"] is None

    async def test_multiple_candidates_first_wins(self):
        result = await _run_batch_resolve(["abc123"], ["mist-ap-abc123", "switch-abc123"])
        assert result == {"abc123": "mist-ap-abc123"}

    async def test_uuid_format_mist_ap(self):
        uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        result = await _run_batch_resolve([uuid], ["mist-ap-" + uuid])
        assert result == {uuid: "mist-ap-" + uuid}

    async def test_uuid_format_mist_site(self):
        uuid = "00000000-0000-0000-0000-000000000001"
        result = await _run_batch_resolve([uuid], ["mist-site-" + uuid])
        assert result == {uuid: "mist-site-" + uuid}

    async def test_mac_as_ap_device_id(self):
        mac = "aa:bb:cc:dd:ee:ff"
        result = await _run_batch_resolve([mac], ["mist-ap-" + mac])
        assert result == {mac: "mist-ap-" + mac}

    async def test_mac_as_switch_device_id(self):
        mac = "00:11:22:aa:bb:cc"
        result = await _run_batch_resolve([mac], ["switch-" + mac])
        assert result == {mac: "switch-" + mac}

    async def test_mac_cleaned_alternative(self):
        mac = "aa:bb:cc:dd:ee:ff"
        cleaned = "aabbccddeeff"
        result = await _run_batch_resolve([mac], ["mist-ap-" + cleaned])
        assert result == {mac: "mist-ap-" + cleaned}


# ==============================================================================
# get_parent_child_map — topology node_id → event device_id translation
# ==============================================================================
#
# This is the critical fix: children must be returned as event device_ids,
# not topology node_ids.

class TestGetParentChildMap:
    pytestmark = pytest.mark.asyncio

    async def test_no_device_ids_returns_empty(self):
        result = await _run_parent_child_map(set(), [], [])
        assert result == {}

    async def test_no_edges_returns_empty(self):
        result = await _run_parent_child_map(["ap-101"], ["mist-ap-ap-101"], [])
        assert result == {}

    async def test_parent_child_translation(self):
        """
        Core test: topology stores node_ids like "switch-01" and
        "mist-ap-abc123". Events use device_ids "01" and "abc123".
        get_parent_child_map must translate children back to event
        device_ids.
        """
        device_ids = {"01", "abc123"}
        node_ids = ["switch-01", "mist-ap-abc123"]
        links = [_link_row("switch-01", "mist-ap-abc123")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        # switch-01 is parent of mist-ap-abc123
        # device_id "01" → node_id "switch-01"
        # child "mist-ap-abc123" → device_id "abc123"
        assert result == {"01": ["abc123"]}

    async def test_child_not_in_device_ids_map_fallback_to_node_id(self):
        """
        If a child node_id has no corresponding device_id in the resolved
        set, node_id_to_device_id() strips the known prefix so the cascade
        rule can still match events that use the stripped form.
        """
        device_ids = {"sw-01"}
        node_ids = ["switch-sw-01"]
        links = [_link_row("switch-sw-01", "mist-ap-unknown")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        # node_id_to_device_id("mist-ap-unknown") strips the prefix → "unknown"
        assert result == {"sw-01": ["unknown"]}

    async def test_multiple_parents_and_children(self):
        device_ids = {"sw-01", "ap-a", "ap-b", "sw-02"}
        node_ids = [
            "switch-sw-01",
            "mist-ap-ap-a",
            "mist-ap-ap-b",
            "switch-sw-02",
        ]
        links = [
            _link_row("switch-sw-01", "mist-ap-ap-a"),
            _link_row("switch-sw-01", "mist-ap-ap-b"),
            _link_row("switch-sw-02", "mist-ap-ap-a"),
        ]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        assert set(result.get("sw-01", [])) == {"ap-a", "ap-b"}
        assert result.get("sw-02") == ["ap-a"]

    async def test_dst_is_child_reverse_edge(self):
        """
        Edge direction: src_id is child, dst_id is parent.
        If a device_id resolves to a child node_id that appears as dst_id,
        it should not appear as a parent entry.
        """
        device_ids = {"ap-a", "sw-01"}
        node_ids = ["mist-ap-ap-a", "switch-sw-01"]
        # Edge where ap-a is dst (parent) — should not be treated as parent's child
        links = [_link_row("mist-ap-ap-a", "switch-sw-01")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        # ap-a resolves to mist-ap-ap-a, which is the parent in the link
        # So ap-a is a parent, and switch-sw-01 is its child
        assert "ap-a" in result
        assert result["ap-a"] == ["sw-01"]

    async def test_velocloud_edge_to_ap(self):
        """
        Cross-vendor: velo-edge-xyz is parent of mist-ap-abc123.
        device_ids are "vc-edge-xyz" and "ap-abc123".
        """
        device_ids = {"vc-edge-xyz", "ap-abc123"}
        node_ids = ["velo-edge-vc-edge-xyz", "mist-ap-ap-abc123"]
        links = [_link_row("velo-edge-vc-edge-xyz", "mist-ap-ap-abc123")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        assert result == {"vc-edge-xyz": ["ap-abc123"]}

    async def test_site_membership_edge_ignored_when_site_not_in_set(self):
        device_ids = {"ap-101"}
        node_ids = ["mist-ap-ap-101"]
        # site node not in device_ids, so edge should be ignored
        links = [_link_row("mist-site-sfo-01", "mist-ap-ap-101")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        assert result == {}

    async def test_site_membership_edge_when_site_in_set(self):
        device_ids = {"ap-101", "sfo-01"}
        node_ids = ["mist-ap-ap-101", "mist-site-sfo-01"]
        links = [_link_row("mist-site-sfo-01", "mist-ap-ap-101")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        assert result == {"sfo-01": ["ap-101"]}

    async def test_uuid_device_ids_resolve_and_translate(self):
        uuid_ap = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        uuid_sw = "b2c3d4e5-f6a7-8901-bcde-f12345678901"
        device_ids = {uuid_sw, uuid_ap}
        node_ids = ["switch-" + uuid_sw, "mist-ap-" + uuid_ap]
        links = [_link_row("switch-" + uuid_sw, "mist-ap-" + uuid_ap)]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        assert result == {uuid_sw: [uuid_ap]}

    async def test_mac_device_ids_resolve_and_translate(self):
        mac_ap = "aa:bb:cc:dd:ee:ff"
        mac_sw = "00:11:22:33:44:55"
        device_ids = {mac_sw, mac_ap}
        node_ids = ["switch-" + mac_sw, "mist-ap-" + mac_ap]
        links = [_link_row("switch-" + mac_sw, "mist-ap-" + mac_ap)]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        assert result == {mac_sw: [mac_ap]}

    async def test_child_not_in_input_set_resolved_via_node_id_to_device_id(self):
        """
        The key fix: when a child node_id is not in the original input set,
        get_parent_child_map must use node_id_to_device_id() to translate it
        back to the event device_id (e.g., 'mist-ap-abc123' → 'abc123').
        Without this, the cascade rule can never match leaf events.
        """
        device_ids = {"sw-01"}
        node_ids = ["switch-sw-01"]
        # child is NOT in device_ids — this is the common case in production
        links = [_link_row("switch-sw-01", "mist-ap-abc123")]

        result = await _run_parent_child_map(device_ids, node_ids, links)
        # node_id_to_device_id("mist-ap-abc123") strips prefix → "abc123"
        assert result == {"sw-01": ["abc123"]}

    async def test_database_error_returns_empty(self):
        """On db.fetch failure, should return empty dict, not crash."""
        with patch("backend.shared.database.topology.db.fetch",
                   AsyncMock(side_effect=Exception("DB down"))):
            with patch("backend.shared.database.topology.db.pool", AsyncMock()):
                provider = _make_provider()
                result = await provider.get_parent_child_map({"ap-101"})
                assert result == {}


# ==============================================================================
# get_all_descendants — multi-hop traversal
# ==============================================================================

class TestGetAllDescendants:
    pytestmark = pytest.mark.asyncio

    async def test_unknown_device_returns_empty(self):
        children_map = {}
        result = await _run_get_all_descendants("ghost", [], children_map)
        assert result == []

    async def test_direct_child(self):
        node_ids = ["switch-sw-01", "mist-ap-ap-a"]
        children_map = {
            "switch-sw-01": [
                {"node_id": "mist-ap-ap-a", "node_type": "ap", "name": "ap-a", "vendor": "mist"}
            ],
        }
        result = await _run_get_all_descendants("sw-01", node_ids, children_map)
        assert result == ["ap-a"]

    async def test_multi_hop(self):
        """switch → downstream-switch → ap"""
        node_ids = ["switch-core", "switch-dist", "mist-ap-leaf"]
        children_map = {
            "switch-core": [
                {"node_id": "switch-dist", "node_type": "switch", "name": "dist", "vendor": "arista"}
            ],
            "switch-dist": [
                {"node_id": "mist-ap-leaf", "node_type": "ap", "name": "leaf", "vendor": "mist"}
            ],
        }
        result = await _run_get_all_descendants("core", node_ids, children_map)
        assert "leaf" in result
        assert "dist" in result

    async def test_max_depth_limits_recursion(self):
        node_ids = ["switch-a", "switch-b", "switch-c", "mist-ap-d"]
        children_map = {
            "switch-a": [
                {"node_id": "switch-b", "node_type": "switch", "name": "b", "vendor": "x"}
            ],
            "switch-b": [
                {"node_id": "switch-c", "node_type": "switch", "name": "c", "vendor": "x"}
            ],
            "switch-c": [
                {"node_id": "mist-ap-d", "node_type": "ap", "name": "d", "vendor": "mist"}
            ],
        }
        result = await _run_get_all_descendants("a", node_ids, children_map, max_depth=2)
        # depth 2 should include switch-b and switch-c but not mist-ap-d
        assert "b" in result
        assert "c" in result
        assert "d" not in result

    async def test_cross_vendor_chain(self):
        """velo-edge → switch → mist-ap"""
        node_ids = ["velo-edge-ve-1", "switch-dist-01", "mist-ap-leaf-99"]
        children_map = {
            "velo-edge-ve-1": [
                {"node_id": "switch-dist-01", "node_type": "switch", "name": "dist", "vendor": "arista"}
            ],
            "switch-dist-01": [
                {"node_id": "mist-ap-leaf-99", "node_type": "ap", "name": "leaf", "vendor": "mist"}
            ],
        }
        result = await _run_get_all_descendants("ve-1", node_ids, children_map)
        assert "dist-01" in result
        assert "leaf-99" in result
