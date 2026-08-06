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
        
        async def mock_fetch(query, *args):
            if "FROM incidents" in query:
                return [_incident_row()]
            elif "FROM sites" in query:
                return [{"site_key": "site-uuid-1", "name": "Pimpri Plant"}]
            elif "FROM devices" in query:
                return [{"device_key": "42201", "display_name": "PLT-EDGE-SOF-01"}]
            elif "FROM device_identities" in query:
                return [{"vendor_device_id": "42201", "resolved_name": "PLT-EDGE-SOF-01"}]
            elif "FROM inventory" in query:
                return [{"site_id": "site-uuid-1", "site_name": "Pimpri Plant"}, {"device_id": "42201", "hostname": "PLT-EDGE-SOF-01"}]
            elif "FROM events" in query:
                return [{"device_id": "42201", "device_name": "PLT-EDGE-SOF-01"}]
            return []

        mock_db.fetch = AsyncMock(side_effect=mock_fetch)
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incidents = response.json()["incidents"]
        assert incidents[0]["site_name"] == "Pimpri Plant"
        assert incidents[0]["root_device"] == "PLT-EDGE-SOF-01"

    def test_missing_names_fall_back_to_empty_string(self, client):
        mock_db = AsyncMock()
        
        async def mock_fetch(query, *args):
            if "FROM incidents" in query:
                return [_incident_row()]
            return []

        mock_db.fetch = AsyncMock(side_effect=mock_fetch)
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incidents = response.json()["incidents"]
        assert incidents[0]["site_name"] == ""
        assert incidents[0]["root_device"] == ""

    def test_uuid_root_device_resolved_from_inventory(self, client):
        mock_db = AsyncMock()
        
        async def mock_fetch(query, *args):
            if "FROM incidents" in query:
                return [_incident_row(roots=("00000000-0000-0000-1000-a8f7d9044336",))]
            elif "FROM inventory" in query:
                return [
                    {"site_id": "site-uuid-1", "site_name": "Site One"},
                    {"device_id": "00000000-0000-0000-1000-a8f7d9044336", "hostname": "TMPNE-A61-GDC-OFF-08"},
                ]
            return []

        mock_db.fetch = AsyncMock(side_effect=mock_fetch)
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incident = response.json()["incidents"][0]
        assert incident["root_device"] == "TMPNE-A61-GDC-OFF-08"

    def test_display_names_resolve_when_events_table_is_empty(self, client):
        """WP-2.7 Guarantee: Display names resolve from devices/sites even post-48h event pruning."""
        mock_db = AsyncMock()
        
        async def mock_fetch(query, *args):
            if "FROM incidents" in query:
                return [_incident_row(sites=("site-pruned-01",), roots=("dev-pruned-01",))]
            elif "FROM sites" in query:
                return [{"site_key": "site-pruned-01", "name": "Canonical Site 01"}]
            elif "FROM devices" in query:
                return [{"device_key": "dev-pruned-01", "display_name": "Canonical Switch 01"}]
            elif "FROM events" in query:
                return []  # Simulates 100% pruned events buffer
            return []

        mock_db.fetch = AsyncMock(side_effect=mock_fetch)
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 1})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        incident = response.json()["incidents"][0]
        assert incident["site_name"] == "Canonical Site 01"
        assert incident["root_device"] == "Canonical Switch 01"

    def test_no_incidents_returns_empty_list(self, client):
        mock_db = AsyncMock()
        mock_db.fetch = AsyncMock(return_value=[])
        mock_db.fetchrow = AsyncMock(return_value={"cnt": 0})
        with patch("shared.database.incidents.db", mock_db):
            response = client.get("/incidents?limit=10")

        assert response.status_code == 200
        assert response.json()["incidents"] == []


class TestIncidentDetailRoute:
    """Regression: GET /incidents/{id} must keep working (Phase 5 refactor
    briefly removed _incident_to_detail — caught live as a 500)."""

    def test_detail_route_returns_full_payload(self, client, monkeypatch):
        from shared.models.incident import Incident, IncidentSeverity, IncidentStatus

        now = datetime.now(timezone.utc)
        incident = Incident(
            incident_id="inc-detail-1",
            title="SFO-01 · edge-sfo-01 link down",
            severity=IncidentSeverity.CRITICAL,
            status=IncidentStatus.OPEN,
            affected_sites=["site-sfo-01"],
            affected_devices=["edge-1", "ap-1"],
            root_device_ids=["edge-1"],
            symptom_device_ids=["ap-1"],
            related_event_ids=["e1"],
            confidence_score=0.9,
            created_at=now,
            updated_at=now,
        )

        async def fake_get_incident(_id):
            return incident

        monkeypatch.setattr(
            "api.services.incident_service.incident_service.get_incident",
            fake_get_incident,
        )
        response = client.get("/incidents/inc-detail-1")

        assert response.status_code == 200
        data = response.json()
        assert data["incident_id"] == "inc-detail-1"
        assert data["severity_label"] == "Outage"
        assert data["root_device_ids"] == ["edge-1"]
        assert data["symptom_device_ids"] == ["ap-1"]
        assert data["event_count"] == 1
        assert data["probable_cause"] is None

    def test_detail_route_404_when_missing(self, client, monkeypatch):
        async def fake_get_incident(_id):
            return None

        monkeypatch.setattr(
            "api.services.incident_service.incident_service.get_incident",
            fake_get_incident,
        )
        response = client.get("/incidents/does-not-exist")

        assert response.status_code == 404