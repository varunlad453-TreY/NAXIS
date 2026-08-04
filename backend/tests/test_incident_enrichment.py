"""
Tests for the Phase 5 Alerts enrichment — operator-facing display names.

GET /incidents now resolves each incident's primary site (affected_sites[0])
to an inventory site name and its root-cause device (root_device_ids[0]) to a
hostname, so the Alerts page can render "root device + site name per row"
without parsing titles. Resolution is batched and best-effort.
"""

from unittest.mock import AsyncMock, patch

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _incident_row(incident_id="inc-1", title="t", sites=("site-uuid-1",), roots=("42201",)):
    now = datetime.now(timezone.utc)
    return {
        "incident_id": incident_id,
        "title": title,
        "severity": "critical",
        "status": "open",
        "affected_sites": list(sites),
        "affected_devices": ["d1"],
        "affected_clients": [],
        "root_device_ids": list(roots),
        "symptom_device_ids": [],
        "related_event_ids": [],
        "probable_cause": None,
        "confidence_score": 0.9,
        "confidence_breakdown": None,
        "created_at": now,
        "updated_at": now,
    }


class TestIncidentEnrichment:
    def test_site_and_root_device_names_resolved(self, client):
        mock_db = AsyncMock()
        # fetch call order: incidents list, site names, events device names
        mock_db.fetch = AsyncMock(
            side_effect=[
                [_incident_row()],
                [{"site_id": "site-uuid-1", "site_name": "Pimpri Plant"}],
                [{"device_id": "42201", "device_name": "PLT-EDGE-SOF-01"}],
            ]
        )
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incidents = response.json()["incidents"]
        assert incidents[0]["site_name"] == "Pimpri Plant"
        assert incidents[0]["root_device"] == "PLT-EDGE-SOF-01"

    def test_missing_names_fall_back_to_empty_string(self, client):
        mock_db = AsyncMock()
        mock_db.fetch = AsyncMock(
            side_effect=[[_incident_row()], [], []]
        )
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incidents = response.json()["incidents"]
        assert incidents[0]["site_name"] == ""
        assert incidents[0]["root_device"] == ""

    def test_uuid_root_device_resolved_from_inventory(self, client):
        mock_db = AsyncMock()
        mock_db.fetch = AsyncMock(
            side_effect=[
                [_incident_row(roots=("00000000-0000-0000-1000-a8f7d9044336",))],
                [{"site_id": "site-uuid-1", "site_name": "Site One"}],
                [{"device_id": "00000000-0000-0000-1000-a8f7d9044336", "hostname": "TMPNE-A61-GDC-OFF-08"}],
            ]
        )
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incident = response.json()["incidents"][0]
        assert incident["root_device"] == "TMPNE-A61-GDC-OFF-08"
        queries = [c.args[0] for c in mock_db.fetch.await_args_list]
        assert any("FROM events" in q for q in queries) is False

    def test_no_incidents_returns_empty_list(self, client):
        mock_db = AsyncMock()
        mock_db.fetch = AsyncMock(return_value=[])
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 0})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        assert response.json()["incidents"] == []