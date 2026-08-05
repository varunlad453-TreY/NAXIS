"""
Tests for TopologySync VeloCloud topology creation.

Verifies _sync_velocloud_topology() correctly creates topology_nodes and
topology_edges from the inventory table data, including the WAN link edge
creation that depends on inventory.props.links.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.worker.collectors.topology_sync import TopologySync


def _mock_inventory_row(overrides: dict = None) -> dict:
    row = {
        "device_id": "vc-edge-logical-001",
        "hostname": "sfo-edge-01",
        "ip_address": "203.0.113.10",
        "model": "520-EDGE",
        "site_id": "site-101",
        "site_name": "SFO-DC",
        "connected": True,
        "reachability": "reachable",
        "firmware_version": "4.3.0-12345",
        "props": {
            "links": [
                {
                    "interface": "GE0/0",
                    "name": "Comcast Business",
                    "isp": "Comcast Business",
                    "public_ip": "203.0.113.10",
                    "state": "STABLE",
                    "score_tx": None,
                    "score_rx": None,
                    "latency_ms_tx": None,
                    "upstream_mbps": 500,
                    "downstream_mbps": 1000,
                },
                {
                    "interface": "GE0/1",
                    "name": "AT&T Fiber",
                    "isp": "AT&T Fiber",
                    "public_ip": "198.51.100.20",
                    "state": "STABLE",
                    "score_tx": None,
                    "score_rx": None,
                    "latency_ms_tx": None,
                    "upstream_mbps": 200,
                    "downstream_mbps": 500,
                },
            ],
            "velobrain_score": 0.0,
        },
    }
    if overrides:
        row.update(overrides)
    return row


class FakeIdentityResolver:
    """Deterministic identity resolver for tests; avoids DB round-trips."""

    async def resolve_site(self, vendor_site_id, site_name=None, vendor=None, parent_key=None):
        return vendor_site_id

    async def resolve_sites(self, specs):
        return {(vendor, site_id): site_id for site_id, name, vendor, parent in specs}

    async def resolve_device(self, vendor, vendor_device_id, **hints):
        return vendor_device_id

    async def resolve_devices(self, pairs):
        return {(vendor, vendor_id): vendor_id for vendor, vendor_id, hints in pairs}

    async def find_device(self, vendor, vendor_device_id):
        return vendor_device_id


def _make_topology_sync(mist_enabled=False, velo_enabled=True):
    with patch("backend.worker.collectors.topology_sync.get_settings") as gs:
        settings = MagicMock()
        settings.mist_enabled = mist_enabled
        settings.velocloud_enabled = velo_enabled
        gs.return_value = settings
        ts = TopologySync()
    ts._identity = FakeIdentityResolver()
    return ts


class TestVeloCloudTopologySync:

    # ── Empty / disabled paths ───────────────────────────────────────

    @pytest.mark.asyncio
    async def test_sync_velo_disabled(self):
        ts = _make_topology_sync(velo_enabled=False)
        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock()) as mock_fetch:
            await ts.sync()
        mock_fetch.assert_not_called()

    @pytest.mark.asyncio
    async def test_sync_velo_enabled_empty_inventory(self):
        ts = _make_topology_sync()
        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(return_value=[])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                await ts.sync()
        mock_exec.assert_not_called()

    # ── Single edge topology ─────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_single_edge_at_site(self):
        ts = _make_topology_sync()
        rows = [_mock_inventory_row()]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        node_queries = [c for c in exec_calls if "INSERT INTO topology_nodes" in c[0]]
        edge_queries = [c for c in exec_calls if "INSERT INTO topology_edges" in c[0]]
        assert len(node_queries) >= 3  # site + edge + at least 1 wan_gateway
        assert len(edge_queries) >= 1  # at least site_membership

    @pytest.mark.asyncio
    async def test_single_edge_creates_site_and_edge_nodes(self):
        ts = _make_topology_sync()
        rows = [_mock_inventory_row()]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        node_ids = []
        for c in exec_calls:
            if "INSERT INTO topology_nodes" in c[0]:
                node_ids.append(c[1])  # node_id is first positional param

        assert "velo-site-site-101" in node_ids
        assert "velo-edge-vc-edge-logical-001" in node_ids

    @pytest.mark.asyncio
    async def test_single_edge_creates_site_membership_edge(self):
        ts = _make_topology_sync()
        rows = [_mock_inventory_row()]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        site_membership = [
            c for c in exec_calls
            if "INSERT INTO topology_edges" in c[0]
            and "site_membership" in c[3]  # edge_type is 4th positional param
        ]
        assert len(site_membership) == 1

    # ── WAN link edges ───────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_edge_with_wan_links_creates_gateway_nodes(self):
        ts = _make_topology_sync()
        rows = [_mock_inventory_row()]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        gw_nodes = []
        for c in exec_calls:
            if "INSERT INTO topology_nodes" in c[0]:
                node_ids = c[1]
                if "wan-gw-" in node_ids:
                    gw_nodes.append(node_ids)

        assert len(gw_nodes) == 2
        assert "wan-gw-comcast-business" in gw_nodes
        assert "wan-gw-at&t-fiber" in gw_nodes

    @pytest.mark.asyncio
    async def test_edge_with_wan_links_creates_wan_link_edges(self):
        ts = _make_topology_sync()
        rows = [_mock_inventory_row()]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        wan_edges = []
        for c in exec_calls:
            if "INSERT INTO topology_edges" in c[0]:
                if "wan_link" in c[3]:
                    wan_edges.append(c)

        assert len(wan_edges) == 2

    @pytest.mark.asyncio
    async def test_wan_link_props_contain_interface_isp_and_public_ip(self):
        ts = _make_topology_sync()
        rows = [_mock_inventory_row()]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        for c in exec_calls:
            if "INSERT INTO topology_edges" in c[0] and "wan_link" in c[3]:
                props_json = c[4]
                props = json.loads(props_json)
                assert "interface" in props
                assert "isp" in props
                assert "public_ip" in props
                assert props["platform"] == "velocloud"
                assert props["discovered_by"] == "rest_api"

    @pytest.mark.asyncio
    async def test_props_empty_links_skips_wan_creation(self):
        ts = _make_topology_sync()
        row = _mock_inventory_row({"props": {"links": [], "velobrain_score": 0.0}})
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[[row], []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        gw_nodes = [c for c in exec_calls if "INSERT INTO topology_nodes" in c[0] and "wan-gw-" in c[1]]
        assert len(gw_nodes) == 0

    @pytest.mark.asyncio
    async def test_props_missing_does_not_crash(self):
        ts = _make_topology_sync()
        row = _mock_inventory_row({"props": {}})
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[[row], []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        # Should not crash — site and edge nodes still created
        node_count = len([c for c in exec_calls if "INSERT INTO topology_nodes" in c[0]])
        assert node_count >= 2

    @pytest.mark.asyncio
    async def test_props_as_string_does_not_crash(self):
        ts = _make_topology_sync()
        row = _mock_inventory_row({"props": "{}"})
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[[row], []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        node_count = len([c for c in exec_calls if "INSERT INTO topology_nodes" in c[0]])
        assert node_count >= 2

    # ── Multiple edges / sites ───────────────────────────────────────

    @pytest.mark.asyncio
    async def test_multiple_edges_across_sites(self):
        ts = _make_topology_sync()
        rows = [
            _mock_inventory_row({
                "device_id": "vc-edge-A",
                "hostname": "sfo-edge-01",
                "site_id": "site-101",
                "site_name": "SFO-DC",
            }),
            _mock_inventory_row({
                "device_id": "vc-edge-B",
                "hostname": "nyc-edge-01",
                "site_id": "site-201",
                "site_name": "NYC-DC",
            }),
        ]
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[rows, []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        node_ids = []
        for c in exec_calls:
            if "INSERT INTO topology_nodes" in c[0]:
                node_ids.append(c[1])

        assert "velo-site-site-101" in node_ids
        assert "velo-site-site-201" in node_ids
        assert "velo-edge-vc-edge-A" in node_ids
        assert "velo-edge-vc-edge-B" in node_ids

    @pytest.mark.asyncio
    async def test_edge_connected_state_creates_correct_props(self):
        ts = _make_topology_sync()
        row = _mock_inventory_row({
            "connected": True,
            "reachability": "reachable",
        })
        exec_calls = []

        with patch("backend.worker.collectors.topology_sync.db.fetch",
                   AsyncMock(side_effect=[[row], []])):
            with patch("backend.worker.collectors.topology_sync.db.execute",
                       AsyncMock()) as mock_exec:
                mock_exec.side_effect = lambda *a: exec_calls.append(a)
                await ts.sync()

        edge_node = None
        for c in exec_calls:
            if "INSERT INTO topology_nodes" in c[0] and "velo-edge-" in c[1]:
                props_json = c[9]
                edge_node = json.loads(props_json)
                break

        assert edge_node is not None
        assert edge_node["connected"] is True
        assert edge_node["reachability"] == "reachable"
        assert edge_node["platform"] == "velocloud"


class TestMistPhysicalLinks:
    """
    Tests for _sync_mist_physical_links writing to the explicit links table.
    """

    @pytest.mark.asyncio
    async def test_physical_link_writes_to_links_table(self):
        """
        _sync_mist_physical_links must write switch→AP relationships to the
        links table (parent=switch, child=AP), not topology_edges.
        """
        ts = _make_topology_sync(mist_enabled=True, velo_enabled=False)
        ap_rows = [
            {
                "device_id": "ap-001",
                "hostname": "sfo-ap-01",
                "ip_address": "10.0.1.10",
                "model": "AP43",
                "site_id": "site-101",
                "site_name": "SFO-DC",
                "connected": True,
                "num_clients": 12,
                "firmware_version": "0.14.1",
                "mac": "aa:bb:cc:dd:ee:01",
            }
        ]
        # Wired uplink event for this AP
        # Column aliases match the SQL query: metadata->>'mist_switch_mac' AS switch_mac
        uplink_rows = [
            {
                "device_id": "ap-001",
                "switch_mac": "00:11:22:33:44:55",
                "port_id": "ge-0/0/1",
                "site_id": "site-101",
            }
        ]

        exec_calls = []
        with patch(
            "backend.worker.collectors.topology_sync.db.fetch",
            AsyncMock(side_effect=[ap_rows, uplink_rows]),
        ):
            with patch(
                "backend.worker.collectors.topology_sync.db.fetchrow",
                AsyncMock(return_value=None),
            ):
                with patch(
                    "backend.worker.collectors.topology_sync.db.execute",
                    AsyncMock(),
                ) as mock_exec:
                    mock_exec.side_effect = lambda *a: exec_calls.append(a)
                    await ts.sync()

        # Find the link insert
        link_inserts = [
            c for c in exec_calls if "INSERT INTO links" in c[0]
        ]
        assert len(link_inserts) == 1

        # Verify parent=switch, child=AP
        parent_node_id, child_node_id, link_type = link_inserts[0][1:4]
        assert parent_node_id == "switch-00:11:22:33:44:55"
        assert child_node_id == "mist-ap-ap-001"
        assert link_type == "physical"

    @pytest.mark.asyncio
    async def test_no_uplink_events_skips_link_creation(self):
        ts = _make_topology_sync(mist_enabled=True, velo_enabled=False)
        ap_rows = [
            {
                "device_id": "ap-001",
                "hostname": "sfo-ap-01",
                "ip_address": "10.0.1.10",
                "model": "AP43",
                "site_id": "site-101",
                "site_name": "SFO-DC",
                "connected": True,
                "num_clients": 12,
                "firmware_version": "0.14.1",
                "mac": "aa:bb:cc:dd:ee:01",
            }
        ]
        # No uplink events
        with patch(
            "backend.worker.collectors.topology_sync.db.fetch",
            AsyncMock(side_effect=[ap_rows, []]),
        ):
            with patch(
                "backend.worker.collectors.topology_sync.db.execute",
                AsyncMock(),
            ) as mock_exec:
                await ts.sync()

        # No link inserts should happen
        link_calls = [c for c in mock_exec.call_args_list if "INSERT INTO links" in str(c)]
        assert len(link_calls) == 0
