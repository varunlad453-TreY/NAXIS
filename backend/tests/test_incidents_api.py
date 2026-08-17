"""
Tests for the GET /incidents list route's status filter (Phase 4 follow-up).

The route previously ignored `?status=` silently; the service/repository
already supported the filter, so the route now exposes it. These tests pin
that the filter reaches the SQL and that invalid values are rejected.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestListIncidentsStatusFilter:
    def test_status_filter_reaches_sql_and_drives_total(self, client):
        mock_db = AsyncMock()
        mock_db.fetch = AsyncMock(return_value=[])
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 7})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?status=open&status=resolved")

        assert response.status_code == 200
        assert response.json()["total"] == 7
        sql, *params = mock_db.fetchrow.call_args[0]
        assert "status = ANY($1)" in sql
        assert params[0] == ["open", "resolved"]

    def test_invalid_status_rejected_with_422(self, client):
        response = client.get("/incidents?status=bogus")
        assert response.status_code == 422

    def test_no_status_param_does_not_filter(self, client):
        mock_db = AsyncMock()
        mock_db.fetch = AsyncMock(return_value=[])
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 9})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents")

        assert response.status_code == 200
        sql = mock_db.fetchrow.call_args[0][0]
        assert "status = ANY" not in sql
