"""
Tests for the GET /incidents/stats endpoint (Phase 4 — Truthful KPIs).

Exercises the real SQL path through `get_incident_stats()` with a mocked
database client (no Postgres needed), asserting the aggregate computation,
severity zero-fill, the active-status filter passed to the query, and the
route-ordering guarantee (never swallowed by GET /incidents/{incident_id}).
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


class StatsRow:
    """dict-style row returned by the aggregate fetchrow."""

    def __init__(self, total=0, active=0, distinct_sites=0, distinct_devices=0, avg_confidence=0.0):
        self._d = {
            "total": total,
            "active": active,
            "distinct_sites": distinct_sites,
            "distinct_devices": distinct_devices,
            "avg_confidence": avg_confidence,
        }

    def __getitem__(self, key):
        return self._d[key]


def _mock_db(total, active, distinct_sites, distinct_devices, avg_confidence, severity_rows):
    mock_db = AsyncMock()
    mock_db.fetchrow = AsyncMock(
        return_value=StatsRow(total, active, distinct_sites, distinct_devices, avg_confidence)
    )
    mock_db.fetch = AsyncMock(return_value=severity_rows)
    return mock_db


# ==============================================================================
# GET /incidents/stats
# ==============================================================================


class TestGetIncidentStats:
    def test_returns_sql_aggregates(self, client):
        mock_db = _mock_db(
            total=42,
            active=7,
            distinct_sites=3,
            distinct_devices=15,
            avg_confidence=0.62,
            severity_rows=[
                {"severity": "critical", "cnt": 2},
                {"severity": "major", "cnt": 4},
                {"severity": "minor", "cnt": 8},
                {"severity": "info", "cnt": 28},
            ],
        )
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents/stats")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 42
        assert data["active"] == 7
        assert data["by_severity"] == {
            "critical": 2,
            "major": 4,
            "minor": 8,
            "warning": 0,
            "info": 28,
        }
        assert data["distinct_sites"] == 3
        assert data["distinct_devices"] == 15
        assert data["avg_confidence"] == 0.62

    def test_passes_active_status_values_to_query(self, client):
        mock_db = _mock_db(0, 0, 0, 0, 0.0, severity_rows=[])
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents/stats")

        assert response.status_code == 200
        fetchrow_args = mock_db.fetchrow.call_args
        # The active filter must come from the single source of truth
        assert fetchrow_args[0][1] == ["open", "investigating", "mitigated"]

    def test_zero_fills_all_severities(self, client):
        mock_db = _mock_db(0, 0, 0, 0, 0.0, severity_rows=[])
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents/stats")

        assert response.status_code == 200
        assert response.json()["by_severity"] == {
            "critical": 0,
            "major": 0,
            "minor": 0,
            "warning": 0,
            "info": 0,
        }

    def test_is_not_swallowed_by_incident_detail_route(self, client):
        """Route ordering: /stats must resolve before /{incident_id}."""
        mock_db = _mock_db(5, 1, 2, 3, 0.4, severity_rows=[{"severity": "major", "cnt": 5}])
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents/stats")

        assert response.status_code == 200
        assert "total" in response.json()

    def test_returns_500_on_db_error(self, client):
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(side_effect=RuntimeError("db down"))
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents/stats")

        assert response.status_code == 500
