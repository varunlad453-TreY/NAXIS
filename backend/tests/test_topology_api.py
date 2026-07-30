"""
Tests for the Topology API routes.

Uses mocked database client to avoid needing a real PostgreSQL connection.
FastAPI TestClient is synchronous, so test methods are plain `def`.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _mock_node_row(
    node_id: str = "core-switch-01",
    node_type: str = "switch",
    name: str = "naxis-core-01",
    ip_address: str = "10.0.0.1",
    vendor: str = "cisco",
    model: str = "C9300",
    site_id: str = "site-sfo-01",
    props: str = '{}',
    updated_at: datetime = None,
):
    class MockRow:
        def __getitem__(self, key):
            return {
                "node_id": node_id,
                "node_type": node_type,
                "name": name,
                "ip_address": ip_address,
                "vendor": vendor,
                "model": model,
                "site_id": site_id,
                "props": props,
                "updated_at": updated_at or datetime.utcnow(),
            }[key]

    return MockRow()


def _mock_edge_row(
    src_id: str = "ap-sfo-101",
    dst_id: str = "core-switch-01",
    edge_type: str = "wired",
    props: str = '{}',
    updated_at: datetime = None,
):
    class MockRow:
        def __getitem__(self, key):
            return {
                "src_id": src_id,
                "dst_id": dst_id,
                "edge_type": edge_type,
                "props": props,
                "updated_at": updated_at or datetime.utcnow(),
            }[key]

    return MockRow()


def _default_fetch_sequence(node_rows, edge_rows, filtered=False):
    """Build the fetch side_effect sequence with health enrichment mocks.

    When *filtered* is True (site_id or node_type provided), the endpoint
    makes two edge queries (src_ids + dst_ids) instead of one full scan.
    """
    seq = [
        node_rows,          # _NODES_QUERY (or filtered query)
        [],                 # _enrich_site_names (empty site name lookup)
        [],                 # _HEALTH_EVENTS_QUERY (empty events)
        [],                 # _HEALTH_INVENTORY_QUERY (empty inventory)
        [],                 # _HEALTH_NODE_PROPS_QUERY (empty props)
    ]
    if filtered:
        seq.append(edge_rows)  # _EDGES_FROM_SRC_IDS
        seq.append(edge_rows)  # _EDGES_TO_DST_IDS
    else:
        seq.append(edge_rows)  # _EDGES_QUERY
    return seq


# ==============================================================================
# GET /topology
# ==============================================================================


class TestGetTopology:
    def test_empty_when_no_db_pool(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"] == []
            assert data["edges"] == []
            assert data["total_nodes"] == 0

    def test_returns_nodes_and_edges(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()
            mock_db.fetchrow = AsyncMock()

            node_rows = [
                _mock_node_row("core-switch-01", "switch", "naxis-core-01"),
                _mock_node_row("ap-sfo-101", "ap", "ap-101", site_id="site-sfo-01"),
                _mock_node_row("ap-sfo-102", "ap", "ap-102", site_id="site-sfo-01"),
            ]
            edge_rows = [
                _mock_edge_row("ap-sfo-101", "core-switch-01"),
                _mock_edge_row("ap-sfo-102", "core-switch-01"),
            ]
            mock_db.fetch.side_effect = _default_fetch_sequence(node_rows, edge_rows)

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 3
            assert data["total_edges"] == 2
            node_ids = {n["node_id"] for n in data["nodes"]}
            assert "core-switch-01" in node_ids
            assert "ap-sfo-101" in node_ids

    def test_filters_by_site_id(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()

            sfo_node = _mock_node_row(site_id="site-sfo-01")

            mock_db.fetch = AsyncMock(side_effect=_default_fetch_sequence(
                [sfo_node], [], filtered=True
            ))

            response = client.get("/topology?site_id=site-sfo-01")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 1
            assert data["nodes"][0]["site_id"] == "site-sfo-01"

    def test_filters_by_node_type(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()

            switch_node = _mock_node_row("sw-01", "switch", "sw-01")

            mock_db.fetch = AsyncMock(side_effect=_default_fetch_sequence(
                [switch_node], [], filtered=True
            ))

            response = client.get("/topology?node_type=switch")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 1
            assert data["nodes"][0]["node_type"] == "switch"

    def test_health_status_default_unknown(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()
            mock_db.fetchrow = AsyncMock()

            node = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            mock_db.fetch.side_effect = _default_fetch_sequence([node], [])

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "unknown"
            assert data["nodes"][0]["health_label"] == "Unknown"


class TestTopologyHealth:
    """Test health enrichment logic."""

    def test_healthy_from_inventory(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            mock_db.fetch.side_effect = [
                [node],       # _NODES_QUERY
                [],           # _enrich_site_names
                [],           # _HEALTH_EVENTS_QUERY (no recent events)
                [             # _HEALTH_INVENTORY_QUERY
                    {"device_id": "core-switch-01", "reachability": "reachable"},
                ],
                [],           # _HEALTH_NODE_PROPS_QUERY
                [],           # _EDGES_QUERY
            ]

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "healthy"

    def test_critical_from_unreachable_inventory(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node = _mock_node_row("ap-sfo-01", "ap", "ap-101")
            mock_db.fetch.side_effect = [
                [node],
                [],
                [],
                [{"device_id": "ap-sfo-01", "reachability": "unreachable"}],
                [],
                [],
            ]

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "critical"

    def test_critical_from_recent_critical_event(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            mock_db.fetch.side_effect = [
                [node],
                [],
                [{"device_id": "core-switch-01", "severity": "critical", "latest_at": datetime.utcnow()}],
                [],
                [],
                [],
            ]

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "critical"

    def test_warning_from_major_event(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            mock_db.fetch.side_effect = [
                [node],
                [],
                [{"device_id": "core-switch-01", "severity": "major", "latest_at": datetime.utcnow()}],
                [],
                [],
                [],
            ]

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "warning"

    def test_critical_from_props_unreachable(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node = _mock_node_row("velo-edge-001", "wan_edge", "edge-001", props='{"reachability": "unreachable"}')
            mock_db.fetch.side_effect = [
                [node],
                [],
                [],
                [],
                [{"node_id": "velo-edge-001", "reachability": "unreachable", "connected": None}],
                [],
            ]

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "critical"

    def test_prefix_stripping_for_mist_ap(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node = _mock_node_row("mist-ap-abc123", "ap", "ap-101")
            mock_db.fetch.side_effect = [
                [node],
                [],
                [],
                [{"device_id": "abc123", "reachability": "unreachable"}],
                [],
                [],
            ]

            response = client.get("/topology")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"][0]["health_status"] == "critical"

    def test_health_on_single_node(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()
            mock_db.fetchrow = AsyncMock()

            switch_row = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            mock_db.fetchrow.return_value = switch_row
            mock_db.fetch.side_effect = [
                [_mock_node_row("edge-router-01", "router", "edge-router-01")],
                [_mock_node_row("ap-sfo-101", "ap", "ap-101")],
                [],
                [],
                [],
                [],
                [],
            ]

            response = client.get("/topology/nodes/core-switch-01")
            assert response.status_code == 200
            data = response.json()
            assert data["node"]["health_status"] in ("unknown", "healthy", "warning", "critical")


# ==============================================================================
# GET /topology/summary
# ==============================================================================


class TestGetTopologySummary:
    def test_summary_empty_when_no_db(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology/summary")
            assert response.status_code == 200
            data = response.json()
            assert data["node_count"] == 0
            assert data["edge_count"] == 0

    def test_summary_returns_counts(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetchrow = AsyncMock()
            mock_db.fetch = AsyncMock()

            class SummaryRow:
                def __getitem__(self, key):
                    return {
                        "total_nodes": 42,
                        "total_edges": 17,
                        "last_updated": datetime(2026, 7, 7, 12, 0, 0),
                    }[key]

            mock_db.fetchrow.return_value = SummaryRow()
            mock_db.fetch.side_effect = [
                [
                    {"node_type": "switch", "cnt": 10},
                    {"node_type": "ap", "cnt": 25},
                    {"node_type": "router", "cnt": 7},
                ],
                [
                    {"vendor": "cisco", "cnt": 20},
                    {"vendor": "juniper", "cnt": 15},
                    {"vendor": "unknown", "cnt": 7},
                ],
            ]

            response = client.get("/topology/summary")
            assert response.status_code == 200
            data = response.json()
            assert data["node_count"] == 42
            assert data["edge_count"] == 17
            assert data["by_type"]["switch"] == 10
            assert data["by_type"]["ap"] == 25
            assert data["by_vendor"]["cisco"] == 20


# ==============================================================================
# GET /topology/nodes/{node_id}
# ==============================================================================


class TestGetTopologyNode:
    def test_node_not_found(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetchrow = AsyncMock(return_value=None)

            response = client.get("/topology/nodes/non-existent")
            assert response.status_code == 404

    def test_returns_node_with_neighbours(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetchrow = AsyncMock()
            mock_db.fetch = AsyncMock()

            switch_row = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            mock_db.fetchrow.return_value = switch_row

            parent_rows = [
                _mock_node_row("edge-router-01", "router", "edge-router-01"),
            ]
            child_rows = [
                _mock_node_row("ap-sfo-101", "ap", "ap-101"),
                _mock_node_row("ap-sfo-102", "ap", "ap-102"),
            ]
            mock_db.fetch.side_effect = [
                parent_rows,  # get_parents
                child_rows,   # get_children
                [],           # _enrich_site_names for combined list
                [],           # _HEALTH_EVENTS_QUERY
                [],           # _HEALTH_INVENTORY_QUERY
                [],           # _HEALTH_NODE_PROPS_QUERY
            ]

            response = client.get("/topology/nodes/core-switch-01")
            assert response.status_code == 200
            data = response.json()
            assert data["node"]["node_id"] == "core-switch-01"
            assert len(data["parents"]) == 1
            assert data["parents"][0]["node_id"] == "edge-router-01"
            assert len(data["children"]) == 2
            assert data["children"][0]["node_id"] == "ap-sfo-101"

    def test_node_endpoint_503_when_no_db(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology/nodes/core-switch-01")
            assert response.status_code == 503


# ==============================================================================
# GET /topology/blast-radius/{incident_id}
# ==============================================================================


class TestBlastRadius:
    def test_503_when_no_db(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology/blast-radius/inc-001")
            assert response.status_code == 503

    def test_404_when_incident_not_found(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            with patch("api.services.incident_service.incident_service") as mock_svc:
                mock_svc.get_incident = AsyncMock(return_value=None)
                response = client.get("/topology/blast-radius/non-existent")
                assert response.status_code == 404

    def test_returns_empty_when_no_affected_devices(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_incident = AsyncMock()
            mock_incident.affected_devices = []
            with patch("api.services.incident_service.incident_service") as mock_svc:
                mock_svc.get_incident = AsyncMock(return_value=mock_incident)
                response = client.get("/topology/blast-radius/inc-001")
                assert response.status_code == 200
                data = response.json()
                assert data["total_nodes"] == 0
                assert data["total_edges"] == 0

    def test_returns_subgraph_with_root_cause(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()
            mock_db.fetchrow = AsyncMock()

            mock_incident = AsyncMock()
            mock_incident.affected_devices = ["core-switch-01", "ap-sfo-101", "ap-sfo-102"]
            mock_incident.incident_id = "inc-001"
            mock_incident.title = "Test incident"
            mock_incident.severity.value = "critical"
            mock_incident.status.value = "open"
            mock_incident.confidence_score = 0.95
            mock_incident.created_at = datetime.utcnow()
            mock_incident.updated_at = datetime.utcnow()

            switch_node = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            ap1_node = _mock_node_row("ap-sfo-101", "ap", "ap-101")
            ap2_node = _mock_node_row("ap-sfo-102", "ap", "ap-102")

            # Batch-resolve returns each device_id mapped to an identical node_id.
            with patch(
                "api.routes.topology._topology_provider.batch_resolve_node_ids",
                new=AsyncMock(side_effect=lambda dids: {did: did for did in dids}),
            ):

                # Note: parent_nodes query is SKIPPED because all edges reference
                # nodes already in the resolved set (parent_node_ids is empty).
                mock_db.fetch.side_effect = [
                    [switch_node, ap1_node, ap2_node],   # 1: _NODES_BY_IDS_QUERY
                    [],                                    # 2: _EDGES_FROM_SRC_IDS
                    [                                      # 3: _EDGES_TO_DST_IDS
                        _mock_edge_row("ap-sfo-101", "core-switch-01"),
                        _mock_edge_row("ap-sfo-102", "core-switch-01"),
                    ],
                    # <-- parent query SKIPPED (no parent_node_ids)
                    [],                                    # 5: _EDGES_FROM_SRC_IDS (all node IDs)
                    [                                      # 6: _EDGES_TO_DST_IDS (all node IDs)
                        _mock_edge_row("ap-sfo-101", "core-switch-01"),
                        _mock_edge_row("ap-sfo-102", "core-switch-01"),
                    ],
                    [],                                    # 7: _SITE_NAME_QUERY
                    [],                                    # 8: _HEALTH_EVENTS_QUERY
                    [],                                    # 9: _HEALTH_INVENTORY_QUERY
                    [],                                    # 10: _HEALTH_NODE_PROPS_QUERY
                ]

                with patch("api.services.incident_service.incident_service") as mock_svc:
                    mock_svc.get_incident = AsyncMock(return_value=mock_incident)
                    response = client.get("/topology/blast-radius/inc-001")
                    assert response.status_code == 200
                    data = response.json()
                    assert data["total_nodes"] == 3
                    assert data["total_edges"] == 2
                    assert "core-switch-01" in data["root_cause_node_ids"]
                    assert "ap-sfo-101" in data["symptom_node_ids"]
                    assert "ap-sfo-102" in data["symptom_node_ids"]


# ==============================================================================
# GET /topology/backbone
# ==============================================================================


class TestGetTopologyBackbone:
    def test_empty_when_no_db_pool(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology/backbone")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"] == []
            assert data["edges"] == []
            assert data["total_nodes"] == 0

    def test_returns_sites_and_inter_site_edges(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            site_rows = [
                _mock_node_row("mist-site-sfo", "site", "San Francisco", site_id="site-sfo"),
                _mock_node_row("mist-site-nyc", "site", "New York", site_id="site-nyc"),
            ]
            count_rows = [
                {"site_id": "site-sfo", "device_count": 42},
                {"site_id": "site-nyc", "device_count": 17},
            ]
            edge_rows = [
                _mock_edge_row("mist-site-sfo", "mist-site-nyc", edge_type="logical_link"),
            ]
            child_rows = [
                _mock_node_row("ap-sfo-01", "ap", "ap-01", site_id="site-sfo"),
                _mock_node_row("sw-sfo-01", "switch", "sw-01", site_id="site-sfo"),
                _mock_node_row("ap-nyc-01", "ap", "ap-nyc-01", site_id="site-nyc"),
            ]
            mock_db.fetch.side_effect = [
                site_rows,        # 1: _SITE_NODES_QUERY
                count_rows,       # 2: _SITE_DEVICE_COUNTS_QUERY
                child_rows,       # 3: _CHILD_NODES_BY_SITE
                [],               # 4: _HEALTH_EVENTS_QUERY (child enrich)
                [],               # 5: _HEALTH_INVENTORY_QUERY (child enrich)
                [],               # 6: _HEALTH_NODE_PROPS_QUERY (child enrich)
                [],               # 7: _SITE_NAME_QUERY (enrich_site_names)
                [],               # 8: _HEALTH_EVENTS_QUERY (backbone enrich)
                [],               # 9: _HEALTH_INVENTORY_QUERY (backbone enrich)
                [],               # 10: _HEALTH_NODE_PROPS_QUERY (backbone enrich)
                edge_rows,        # 11: _INTER_SITE_EDGES_QUERY
            ]

            response = client.get("/topology/backbone")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 2
            assert data["total_edges"] == 1
            node_ids = {n["node_id"] for n in data["nodes"]}
            assert "mist-site-sfo" in node_ids
            assert "mist-site-nyc" in node_ids
            node_map = {n["node_id"]: n for n in data["nodes"]}
            assert node_map["mist-site-sfo"]["device_count"] == 42
            assert node_map["mist-site-nyc"]["device_count"] == 17
            assert node_map["mist-site-sfo"]["critical_count"] == 0
            assert node_map["mist-site-sfo"]["warning_count"] == 0
            assert node_map["mist-site-nyc"]["critical_count"] == 0
            assert node_map["mist-site-nyc"]["warning_count"] == 0

    def test_excludes_internal_edges(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            site_rows = [
                _mock_node_row("mist-site-sfo", "site", "San Francisco", site_id="site-sfo"),
            ]
            mock_db.fetch.side_effect = [
                site_rows,        # 1: _SITE_NODES_QUERY
                [{"site_id": "site-sfo", "device_count": 5}],  # 2: _SITE_DEVICE_COUNTS_QUERY
                [],               # 3: _CHILD_NODES_BY_SITE (no child nodes)
                [],               # 4: _HEALTH_EVENTS_QUERY (child enrich — skipped)
                [],               # 5: _HEALTH_INVENTORY_QUERY (child enrich — skipped)
                [],               # 6: _HEALTH_NODE_PROPS_QUERY (child enrich — skipped)
                [],               # 7: _SITE_NAME_QUERY
                [],               # 8: _HEALTH_EVENTS_QUERY (backbone enrich)
                [],               # 9: _HEALTH_INVENTORY_QUERY (backbone enrich)
                [],               # 10: _HEALTH_NODE_PROPS_QUERY (backbone enrich)
                [],               # 11: _INTER_SITE_EDGES_QUERY (no inter-site edges)
            ]

            response = client.get("/topology/backbone")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 1
            assert data["total_edges"] == 0

    def test_device_count_zero_when_no_child_nodes(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            site_rows = [
                _mock_node_row("mist-site-empty", "site", "Empty Site", site_id="site-empty"),
            ]
            mock_db.fetch.side_effect = [
                site_rows,   # 1: _SITE_NODES_QUERY
                [],          # 2: _SITE_DEVICE_COUNTS_QUERY (no counts found)
                [],          # 3: _CHILD_NODES_BY_SITE
                [],          # 4: _HEALTH_EVENTS_QUERY (child enrich — skipped)
                [],          # 5: _HEALTH_INVENTORY_QUERY (child enrich — skipped)
                [],          # 6: _HEALTH_NODE_PROPS_QUERY (child enrich — skipped)
                [],          # 7: _SITE_NAME_QUERY
                [],          # 8: _HEALTH_EVENTS_QUERY (backbone enrich)
                [],          # 9: _HEALTH_INVENTORY_QUERY (backbone enrich)
                [],          # 10: _HEALTH_NODE_PROPS_QUERY (backbone enrich)
                [],          # 11: _INTER_SITE_EDGES_QUERY
            ]

            response = client.get("/topology/backbone")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 1
            assert data["nodes"][0]["device_count"] == 0


# ==============================================================================
# GET /topology/sites/{site_id}/summary
# ==============================================================================


class TestGetSiteSummary:
    def test_returns_type_health_vendor_breakdown(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            type_rows = [
                {"node_type": "switch", "cnt": 5},
                {"node_type": "ap", "cnt": 15},
                {"node_type": "router", "cnt": 2},
            ]
            vendor_rows = [
                {"vendor": "cisco", "cnt": 5},
                {"vendor": "mist", "cnt": 15},
                {"vendor": "juniper", "cnt": 2},
            ]
            child_node_rows = [
                _mock_node_row("sw-01", "switch", "sw-01", site_id="site-sfo"),
                _mock_node_row("ap-01", "ap", "ap-01", site_id="site-sfo"),
                _mock_node_row("ap-02", "ap", "ap-02", site_id="site-sfo"),
            ]
            mock_db.fetch.side_effect = [
                type_rows,        # 1: _SITE_DEVICE_TYPE_BREAKDOWN
                vendor_rows,      # 2: _SITE_DEVICE_VENDOR_BREAKDOWN
                child_node_rows,  # 3: _NODES_BY_SITE_QUERY
                [],               # 4: _HEALTH_EVENTS_QUERY (child enrich)
                [],               # 5: _HEALTH_INVENTORY_QUERY (child enrich)
                [],               # 6: _HEALTH_NODE_PROPS_QUERY (child enrich)
                [],               # 7: _SITE_NAME_QUERY
            ]

            response = client.get("/topology/sites/site-sfo/summary")
            assert response.status_code == 200
            data = response.json()
            assert data["site_id"] == "site-sfo"
            assert data["total_devices"] == 3
            assert len(data["by_type"]) == 3
            assert data["by_type"][0]["type"] == "switch"
            assert data["by_type"][0]["count"] == 5
            assert len(data["by_vendor"]) == 3
            assert data["by_vendor"][0]["type"] == "cisco"

    def test_empty_when_no_db_pool(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology/sites/site-empty/summary")
            assert response.status_code == 200
            data = response.json()
            assert data["total_devices"] == 0
            assert data["health"]["healthy_count"] == 0

    def test_empty_when_site_has_no_devices(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            mock_db.fetch.side_effect = [
                [],   # 1: _SITE_DEVICE_TYPE_BREAKDOWN (no devices)
                [],   # 2: _SITE_DEVICE_VENDOR_BREAKDOWN
                [],   # 3: _NODES_BY_SITE_QUERY
                [],   # 4: _HEALTH_EVENTS_QUERY (child enrich — skipped)
                [],   # 5: _HEALTH_INVENTORY_QUERY (child enrich — skipped)
                [],   # 6: _HEALTH_NODE_PROPS_QUERY (child enrich — skipped)
                [],   # 7: _SITE_NAME_QUERY
            ]

            response = client.get("/topology/sites/site-empty/summary")
            assert response.status_code == 200
            data = response.json()
            assert data["total_devices"] == 0
            assert data["by_type"] == []
            assert data["by_vendor"] == []

    def test_captures_site_name_from_inventory(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            mock_db.fetch.side_effect = [
                [{"node_type": "ap", "cnt": 3}],              # 1: type breakdown
                [{"vendor": "mist", "cnt": 3}],               # 2: vendor breakdown
                [_mock_node_row("ap-01", "ap", "ap-01", site_id="site-named")],  # 3: child nodes
                [],               # 4: _HEALTH_EVENTS_QUERY (child enrich)
                [],               # 5: _HEALTH_INVENTORY_QUERY (child enrich)
                [],               # 6: _HEALTH_NODE_PROPS_QUERY (child enrich)
                [{"site_id": "site-named", "site_name": "San Francisco Site"}],  # 7: site name
            ]

            response = client.get("/topology/sites/site-named/summary")
            assert response.status_code == 200
            data = response.json()
            assert data["site_name"] == "San Francisco Site"
            assert data["total_devices"] == 1


# ==============================================================================
# GET /topology/sites/{site_id}/internal
# ==============================================================================


class TestGetSiteInternalTopology:
    def test_empty_when_no_db_pool(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = None
            response = client.get("/topology/sites/site-sfo/internal")
            assert response.status_code == 200
            data = response.json()
            assert data["nodes"] == []
            assert data["edges"] == []

    def test_returns_nodes_and_edges_for_site(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node_rows = [
                _mock_node_row("sw-01", "switch", "core-switch", site_id="site-sfo"),
                _mock_node_row("ap-01", "ap", "ap-one", site_id="site-sfo"),
            ]
            edge_rows = [
                _mock_edge_row("ap-01", "sw-01"),
            ]
            mock_db.fetch.side_effect = [
                node_rows,        # 1: _NODES_BY_SITE_QUERY
                [],               # 2: _SITE_NAME_QUERY (enrich_site_names)
                [],               # 3: _HEALTH_EVENTS_QUERY
                [],               # 4: _HEALTH_INVENTORY_QUERY
                [],               # 5: _HEALTH_NODE_PROPS_QUERY
                [],               # 6: _NODE_BY_ID_QUERY (site_id as node_id — not found)
                [],               # 7: _NODE_BY_ID_QUERY (mist-site- prefix — not found)
                edge_rows,        # 8: _EDGES_FOR_SITE_IDS
            ]

            response = client.get("/topology/sites/site-sfo/internal")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 2
            assert data["total_edges"] == 1
            node_ids = {n["node_id"] for n in data["nodes"]}
            assert "sw-01" in node_ids
            assert "ap-01" in node_ids

    def test_appends_site_node_if_exists(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            # First batch: 1 switch node
            node_rows = [
                _mock_node_row("sw-01", "switch", "core-switch", site_id="site-sfo"),
            ]
            # Site node found by direct node_id lookup
            site_node_row = [_mock_node_row("site-sfo", "site", "San Francisco", site_id="site-sfo")]
            edge_rows = []
            mock_db.fetch.side_effect = [
                node_rows,        # 1: _NODES_BY_SITE_QUERY
                [],               # 2: _SITE_NAME_QUERY (enrich_site_names for first batch)
                [],               # 3: _HEALTH_EVENTS_QUERY (enrich_health)
                [],               # 4: _HEALTH_INVENTORY_QUERY
                [],               # 5: _HEALTH_NODE_PROPS_QUERY
                site_node_row,    # 6: _NODE_BY_ID_QUERY (site_id as node_id — found!)
                [],               # 7: _SITE_NAME_QUERY (enrich_site_names for site node)
                [],               # 8: _HEALTH_EVENTS_QUERY (enrich_health for site node)
                [],               # 9: _HEALTH_INVENTORY_QUERY
                [],               # 10: _HEALTH_NODE_PROPS_QUERY
                [],               # 11: _NODE_BY_ID_QUERY (mist-site- prefix — not found)
                edge_rows,        # 12: _EDGES_FOR_SITE_IDS
            ]

            response = client.get("/topology/sites/site-sfo/internal")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 2
            node_ids = {n["node_id"] for n in data["nodes"]}
            assert "sw-01" in node_ids
            assert "site-sfo" in node_ids

    def test_includes_site_membership_edges(self, client):
        """Verify site_membership edges are included (not filtered out)."""
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            node_rows = [
                _mock_node_row("sw-01", "switch", "core-switch", site_id="site-sfo"),
                _mock_node_row("ap-01", "ap", "ap-one", site_id="site-sfo"),
                _mock_node_row("site-sfo", "site", "SFO DC", site_id="site-sfo"),
            ]
            edge_rows = [
                _mock_edge_row("ap-01", "site-sfo", "site_membership"),
                _mock_edge_row("sw-01", "site-sfo", "site_membership"),
                _mock_edge_row("ap-01", "sw-01", "physical_link"),
            ]
            mock_db.fetch.side_effect = [
                node_rows,           # 1: _NODES_BY_SITE_QUERY
                [],                  # 2: _SITE_NAME_QUERY (enrich_site_names)
                [],                  # 3: _HEALTH_EVENTS_QUERY
                [],                  # 4: _HEALTH_INVENTORY_QUERY
                [],                  # 5: _HEALTH_NODE_PROPS_QUERY
                [],                  # 6: _NODE_BY_ID_QUERY (site_id as node_id — already in batch)
                [],                  # 7: _NODE_BY_ID_QUERY (mist-site- — not found)
                edge_rows,           # 8: _EDGES_FOR_SITE_IDS
            ]

            response = client.get("/topology/sites/site-sfo/internal")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 3
            assert data["total_edges"] == 3
            edge_types = {e["edge_type"] for e in data["edges"]}
            assert "site_membership" in edge_types
            assert "physical_link" in edge_types

    def test_not_found_returns_empty(self, client):
        with patch("api.routes.topology.db") as mock_db:
            mock_db.pool = AsyncMock()
            mock_db.fetch = AsyncMock()

            mock_db.fetch.side_effect = [
                [],               # 1: _NODES_BY_SITE_QUERY — no nodes for this site
            ]

            response = client.get("/topology/sites/non-existent/internal")
            assert response.status_code == 200
            data = response.json()
            assert data["total_nodes"] == 0
            assert data["total_edges"] == 0
