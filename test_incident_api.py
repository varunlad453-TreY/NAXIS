#!/usr/bin/env python3
"""
Test Incident API

Tests for the FastAPI incident endpoints.
Uses FastAPI TestClient for synchronous testing.
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services.incident_service import incident_service  # noqa: E402
from backend.shared.models.incident import Incident, IncidentSeverity, IncidentStatus  # noqa: E402

# Create test client
client = TestClient(app)


async def _setup_test_incidents_async():
    """Async helper to create test incidents."""
    # Clear existing incidents
    await incident_service.clear_all()

    # Create test incidents
    incidents = [
        Incident(
            incident_id="inc-test-001",
            title="Site SFO-01 WAN degradation",
            severity=IncidentSeverity.CRITICAL,
            status=IncidentStatus.OPEN,
            affected_sites=["site-sfo-01"],
            affected_devices=["dev-001", "dev-002", "dev-003"],
            related_event_ids=["evt-001", "evt-002", "evt-003"],
            confidence_score=0.82,
        ),
        Incident(
            incident_id="inc-test-002",
            title="Site NYC-01 wireless issues",
            severity=IncidentSeverity.MAJOR,
            status=IncidentStatus.INVESTIGATING,
            affected_sites=["site-nyc-01"],
            affected_devices=["ap-001", "ap-002"],
            related_event_ids=["evt-004", "evt-005"],
            confidence_score=0.65,
        ),
        Incident(
            incident_id="inc-test-003",
            title="Site LAX-01 resolved issue",
            severity=IncidentSeverity.MINOR,
            status=IncidentStatus.RESOLVED,
            affected_sites=["site-lax-01"],
            affected_devices=["dev-010"],
            related_event_ids=["evt-006"],
            confidence_score=0.50,
        ),
    ]

    await incident_service.add_incidents(incidents)
    return incidents


def setup_test_incidents():
    """Create test incidents for API testing (sync wrapper)."""
    return asyncio.run(_setup_test_incidents_async())


def test_health_endpoint():
    """Test health check endpoint."""
    print("✓ Testing health endpoint...")

    response = client.get("/health")
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "healthy"
    assert data["version"] == "1.0.0"
    assert "timestamp" in data

    print("  ✓ Health endpoint works")


def test_list_all_incidents():
    """Test listing all incidents."""
    print("✓ Testing list all incidents...")

    setup_test_incidents()

    response = client.get("/incidents")
    assert response.status_code == 200

    data = response.json()
    assert "incidents" in data
    assert "total" in data
    assert data["total"] == 3
    assert len(data["incidents"]) == 3

    # Check incident structure
    incident = data["incidents"][0]
    assert "incident_id" in incident
    assert "title" in incident
    assert "severity" in incident
    assert "status" in incident
    assert "event_count" in incident
    assert "confidence_score" in incident
    assert "created_at" in incident

    print(f"  ✓ Retrieved {data['total']} incidents")


def test_list_active_incidents():
    """Test listing active incidents only."""
    print("✓ Testing list active incidents...")

    setup_test_incidents()

    response = client.get("/incidents/active")
    assert response.status_code == 200

    data = response.json()
    assert "incidents" in data
    assert "total" in data

    # Should only get OPEN and INVESTIGATING incidents (not RESOLVED)
    assert data["total"] == 2
    assert len(data["incidents"]) == 2

    # Verify none are resolved
    for incident in data["incidents"]:
        assert incident["status"] in ["open", "investigating", "mitigated"]
        assert incident["status"] not in ["resolved", "closed", "suppressed"]

    print(f"  ✓ Retrieved {data['total']} active incidents")


def test_get_incident_by_id():
    """Test retrieving incident by ID."""
    print("✓ Testing get incident by ID...")

    setup_test_incidents()

    response = client.get("/incidents/inc-test-001")
    assert response.status_code == 200

    data = response.json()
    assert data["incident_id"] == "inc-test-001"
    assert data["title"] == "Site SFO-01 WAN degradation"
    assert data["severity"] == "critical"
    assert data["status"] == "open"
    assert data["event_count"] == 3
    assert data["confidence_score"] == 0.82

    # Check detailed fields
    assert "affected_sites" in data
    assert "affected_devices" in data
    assert "related_event_ids" in data
    assert len(data["affected_sites"]) == 1
    assert len(data["affected_devices"]) == 3
    assert len(data["related_event_ids"]) == 3

    print(f"  ✓ Retrieved incident: {data['incident_id']}")


def test_get_incident_not_found():
    """Test 404 when incident doesn't exist."""
    print("✓ Testing 404 not found...")

    setup_test_incidents()

    response = client.get("/incidents/inc-does-not-exist")
    assert response.status_code == 404

    data = response.json()
    assert "detail" in data
    assert "not found" in data["detail"].lower()

    print("  ✓ 404 handling works")


def test_severity_filtering():
    """Test filtering by severity."""
    print("✓ Testing severity filtering...")

    setup_test_incidents()

    # Filter for critical only
    response = client.get("/incidents?severity=critical")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["incidents"][0]["severity"] == "critical"

    # Filter for critical and major
    response = client.get("/incidents?severity=critical&severity=major")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 2

    print("  ✓ Severity filtering works")


def test_pagination():
    """Test pagination parameters."""
    print("✓ Testing pagination...")

    setup_test_incidents()

    # Get first 2 incidents
    response = client.get("/incidents?limit=2")
    assert response.status_code == 200

    data = response.json()
    assert len(data["incidents"]) == 2
    assert data["total"] == 3  # Total should still be 3

    # Get with offset
    response = client.get("/incidents?limit=2&offset=2")
    assert response.status_code == 200

    data = response.json()
    assert len(data["incidents"]) == 1  # Only 1 remaining

    print("  ✓ Pagination works")


def test_empty_state():
    """Test behavior when no incidents exist."""
    print("✓ Testing empty state...")

    asyncio.run(incident_service.clear_all())

    response = client.get("/incidents")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 0
    assert len(data["incidents"]) == 0

    # Active incidents should also be empty
    response = client.get("/incidents/active")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 0

    print("  ✓ Empty state handled correctly")


def test_json_serialization():
    """Test JSON serialization of datetime fields."""
    print("✓ Testing JSON serialization...")

    setup_test_incidents()

    response = client.get("/incidents/inc-test-001")
    assert response.status_code == 200

    data = response.json()

    # Verify datetime fields are properly serialized
    assert "created_at" in data
    assert "updated_at" in data

    # Should be ISO format strings
    created_at = data["created_at"]
    updated_at = data["updated_at"]

    # Parse to verify they're valid datetime strings
    from datetime import datetime

    datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    datetime.fromisoformat(updated_at.replace("Z", "+00:00"))

    print("  ✓ JSON serialization works")


def test_root_endpoint():
    """Test root endpoint."""
    print("✓ Testing root endpoint...")

    response = client.get("/")
    assert response.status_code == 200

    data = response.json()
    assert "message" in data
    assert "version" in data
    assert data["version"] == "1.0.0"

    print("  ✓ Root endpoint works")


def test_api_documentation():
    """Test that API docs are accessible."""
    print("✓ Testing API documentation...")

    # OpenAPI schema
    response = client.get("/openapi.json")
    assert response.status_code == 200

    data = response.json()
    assert "openapi" in data
    assert "info" in data
    assert data["info"]["title"] == "Naxis API"

    print("  ✓ API documentation accessible")


def print_sample_responses():
    """Print sample API responses for inspection."""
    print("\n" + "=" * 80)
    print("SAMPLE API RESPONSES")
    print("=" * 80)

    setup_test_incidents()

    # Health check
    print("\nGET /health")
    print("-" * 80)
    response = client.get("/health")
    print(response.json())

    # List incidents
    print("\nGET /incidents")
    print("-" * 80)
    response = client.get("/incidents")
    import json

    print(json.dumps(response.json(), indent=2, default=str))

    # Get single incident
    print("\nGET /incidents/inc-test-001")
    print("-" * 80)
    response = client.get("/incidents/inc-test-001")
    print(json.dumps(response.json(), indent=2, default=str))


def main():
    """Run all tests."""
    print("Testing Naxis Incident API\n")

    try:
        test_health_endpoint()
        test_list_all_incidents()
        test_list_active_incidents()
        test_get_incident_by_id()
        test_get_incident_not_found()
        test_severity_filtering()
        test_pagination()
        test_empty_state()
        test_json_serialization()
        test_root_endpoint()
        test_api_documentation()

        print("\n✅ All API tests passed!\n")

        print_sample_responses()

        print("\n" + "=" * 80)
        print("API tests complete!")
        print("=" * 80)

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
