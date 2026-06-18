#!/usr/bin/env python3
"""
Quick validation test for the incident schema.
Run this to verify the Incident model works correctly.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from shared.models.incident import (  # noqa: E402
    Incident,
    IncidentSeverity,
    IncidentStatus,
    IncidentQuery,
)


def test_incident_creation():
    """Test basic incident creation and defaults."""
    print("✓ Testing incident creation...")

    incident = Incident(
        title="  Site SFO-01 uplink degraded  ",
        severity=IncidentSeverity.MAJOR,
    )

    # Defaults
    assert incident.incident_id.startswith("inc-")
    assert incident.status == IncidentStatus.OPEN
    assert incident.confidence_score == 0.0
    assert incident.probable_cause is None
    assert incident.related_event_ids == []
    assert incident.affected_devices == []
    assert isinstance(incident.created_at, datetime)
    assert isinstance(incident.updated_at, datetime)

    # Title was stripped
    assert incident.title == "Site SFO-01 uplink degraded"

    # Explicit ID is honored
    explicit = Incident(
        incident_id="inc-fixed-123",
        title="Test",
        severity=IncidentSeverity.MINOR,
    )
    assert explicit.incident_id == "inc-fixed-123"

    print("  ✓ Incident creation works")


def test_validation():
    """Test field validation."""
    print("✓ Testing validation...")

    # Empty title rejected
    try:
        Incident(title="", severity=IncidentSeverity.MINOR)
        raise AssertionError("Empty title should have failed validation")
    except Exception:
        pass

    # Confidence score outside [0, 1] rejected at construction
    try:
        Incident(
            title="bad",
            severity=IncidentSeverity.MINOR,
            confidence_score=1.5,
        )
        raise AssertionError("confidence_score > 1 should have failed validation")
    except Exception:
        pass

    # Dedupe of list fields
    incident = Incident(
        title="Dedupe test",
        severity=IncidentSeverity.MINOR,
        affected_devices=["dev-1", "dev-1", "dev-2"],
        related_event_ids=["e1", "e2", "e1", ""],
    )
    assert incident.affected_devices == ["dev-1", "dev-2"]
    assert incident.related_event_ids == ["e1", "e2"]

    print("  ✓ Validation works")


def test_add_event():
    """Test add_event helper and blast-radius accumulation."""
    print("✓ Testing add_event helper...")

    incident = Incident(title="Uplink flap", severity=IncidentSeverity.MAJOR)
    before = incident.updated_at

    assert incident.add_event(
        "evt-1", device_id="dev-1", site_id="site-1", client_id="cli-1",
    ) is True
    assert incident.add_event("evt-2", device_id="dev-1", site_id="site-1") is True

    # Duplicate event id rejected
    assert incident.add_event("evt-1", device_id="dev-99") is False

    # Blank event id rejected
    assert incident.add_event("", device_id="dev-99") is False

    assert incident.related_event_ids == ["evt-1", "evt-2"]
    assert incident.affected_devices == ["dev-1"]
    assert incident.affected_sites == ["site-1"]
    assert incident.affected_clients == ["cli-1"]
    assert incident.event_count() == 2
    assert incident.updated_at >= before

    # Terminal status blocks new events
    incident.set_status(IncidentStatus.RESOLVED)
    assert incident.is_terminal()
    assert incident.add_event("evt-3", device_id="dev-2") is False
    assert "evt-3" not in incident.related_event_ids

    print("  ✓ add_event works")


def test_update_confidence():
    """Test update_confidence helper and clamping."""
    print("✓ Testing update_confidence helper...")

    incident = Incident(title="x", severity=IncidentSeverity.MINOR)
    assert not incident.is_enriched()

    incident.update_confidence(0.42, probable_cause="Likely BGP flap")
    assert incident.confidence_score == 0.42
    assert incident.probable_cause == "Likely BGP flap"
    assert incident.is_enriched()

    # Clamping
    incident.update_confidence(2.5)
    assert incident.confidence_score == 1.0
    incident.update_confidence(-0.7)
    assert incident.confidence_score == 0.0

    # probable_cause is preserved when not passed
    assert incident.probable_cause == "Likely BGP flap"

    print("  ✓ update_confidence works")


def test_status_transitions():
    """Test set_status helper."""
    print("✓ Testing status transitions...")

    incident = Incident(title="x", severity=IncidentSeverity.MINOR)
    assert incident.status == IncidentStatus.OPEN
    incident.set_status(IncidentStatus.INVESTIGATING)
    assert incident.status == IncidentStatus.INVESTIGATING
    assert not incident.is_terminal()
    incident.set_status(IncidentStatus.CLOSED)
    assert incident.is_terminal()

    print("  ✓ status transitions work")


def test_json_serialization():
    """Test JSON round-trip."""
    print("✓ Testing JSON serialization...")

    incident = Incident(title="JSON test", severity=IncidentSeverity.CRITICAL)
    incident.add_event("evt-1", device_id="dev-1", site_id="site-1")
    incident.update_confidence(0.5, probable_cause="cable cut")

    raw = incident.model_dump_json()
    parsed = json.loads(raw)
    assert parsed["title"] == "JSON test"
    assert parsed["severity"] == "critical"
    assert parsed["status"] == "open"
    assert parsed["related_event_ids"] == ["evt-1"]
    assert parsed["confidence_score"] == 0.5

    # Round trip
    revived = Incident.model_validate_json(raw)
    assert revived.incident_id == incident.incident_id
    assert revived.severity == IncidentSeverity.CRITICAL
    assert revived.related_event_ids == ["evt-1"]

    # Summary view
    summary = incident.to_summary()
    assert summary["event_count"] == 1
    assert summary["affected_sites"] == 1
    assert "created_at" in summary

    print("  ✓ JSON serialization works")


def test_clickhouse_conversion():
    """Test the to_clickhouse_dict shape."""
    print("✓ Testing ClickHouse conversion...")

    incident = Incident(title="CH test", severity=IncidentSeverity.MAJOR)
    incident.add_event("evt-1", device_id="dev-1", site_id="site-1")
    incident.add_event("evt-2", device_id="dev-2", site_id="site-1")
    incident.update_confidence(0.9, probable_cause="LAG member down")
    incident.set_status(IncidentStatus.INVESTIGATING)

    row = incident.to_clickhouse_dict()

    expected_keys = {
        "incident_id", "title", "severity", "status",
        "affected_sites", "affected_devices", "affected_clients",
        "related_event_ids", "probable_cause", "confidence_score",
        "event_count", "created_at", "updated_at",
    }
    assert expected_keys.issubset(row.keys()), f"Missing: {expected_keys - row.keys()}"

    # Enums are serialized as strings (ClickHouse LowCardinality(String))
    assert row["severity"] == "major"
    assert row["status"] == "investigating"

    # Lists are real lists, not None
    assert row["related_event_ids"] == ["evt-1", "evt-2"]
    assert row["affected_devices"] == ["dev-1", "dev-2"]
    assert row["affected_sites"] == ["site-1"]
    assert row["affected_clients"] == []

    # probable_cause empty-string for unenriched incidents
    bare = Incident(title="bare", severity=IncidentSeverity.INFO).to_clickhouse_dict()
    assert bare["probable_cause"] == ""
    assert bare["confidence_score"] == 0.0

    # event_count agrees with the array length
    assert row["event_count"] == len(row["related_event_ids"])

    # Timestamps stay as datetimes for the ClickHouse driver
    assert isinstance(row["created_at"], datetime)
    assert isinstance(row["updated_at"], datetime)

    print("  ✓ ClickHouse conversion works")


def test_incident_query_model():
    """Sanity check the query parameter model."""
    print("✓ Testing IncidentQuery...")

    q = IncidentQuery(
        severities=[IncidentSeverity.CRITICAL, IncidentSeverity.MAJOR],
        statuses=[IncidentStatus.OPEN],
        min_confidence=0.6,
        limit=50,
    )
    assert q.limit == 50
    assert q.offset == 0
    assert q.min_confidence == 0.6
    assert IncidentSeverity.CRITICAL in q.severities

    print("  ✓ IncidentQuery works")


def print_sample_incident():
    """Print a fully populated sample incident for inspection."""
    print("\n" + "=" * 60)
    print("SAMPLE INCIDENT")
    print("=" * 60)

    incident = Incident(title="Site SFO-01 uplink degraded", severity=IncidentSeverity.MAJOR)
    incident.add_event("evt-1001", device_id="dev-001", site_id="site-sfo-01")
    incident.add_event("evt-1002", device_id="dev-002", site_id="site-sfo-01")
    incident.update_confidence(0.82, probable_cause="ISP BGP flap on primary uplink")
    incident.set_status(IncidentStatus.INVESTIGATING)

    print(incident.model_dump_json(indent=2))
    print("\n" + "=" * 60)
    print("CLICKHOUSE ROW FORMAT")
    print("=" * 60)
    print(json.dumps(incident.to_clickhouse_dict(), indent=2, default=str))


def main():
    print("Testing Naxis Incident Schema\n")
    try:
        test_incident_creation()
        test_validation()
        test_add_event()
        test_update_confidence()
        test_status_transitions()
        test_json_serialization()
        test_clickhouse_conversion()
        test_incident_query_model()

        print("\n✅ All tests passed!\n")
        print_sample_incident()

        print("\n" + "=" * 60)
        print("Incident schema is ready for use!")
        print("=" * 60)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
