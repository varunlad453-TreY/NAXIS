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


def _default_fetch_sequence(node_rows, edge_rows):
    """Build the fetch side_effect sequence with health enrichment mocks."""
    return [
        node_rows,          # _NODES_QUERY (or filtered query)
        [],                 # _enrich_site_names (empty site name lookup)
        [],                 # _HEALTH_EVENTS_QUERY (empty events)
        [],                 # _HEALTH_INVENTORY_QUERY (empty inventory)
        [],                 # _HEALTH_NODE_PROPS_QUERY (empty props)
        edge_rows,          # _EDGES_QUERY
    ]


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
                [sfo_node], []
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
                [switch_node], []
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

            switch_node = _mock_node_row("core-switch-01", "switch", "naxis-core-01")
            ap1_node = _mock_node_row("ap-sfo-101", "ap", "ap-101")
            ap2_node = _mock_node_row("ap-sfo-102", "ap", "ap-102")

            # Patch resolve_topology_node_id to return the same device_id as node_id
            with patch("api.routes.topology.resolve_topology_node_id") as mock_resolve:
                mock_resolve.side_effect = lambda did: did

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
