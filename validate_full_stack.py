#!/usr/bin/env python3
"""
Naxis Platform Full Stack Validation

Validates the complete operational intelligence stack:
  1. UnifiedEvent schema ✓
  2. Incident schema ✓
  3. Correlation engine ✓
  4. Mock telemetry pipeline ✓

Run this to verify the entire MVP stack is working.
"""

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

print("="*80)
print("NAXIS PLATFORM FULL STACK VALIDATION")
print("="*80)

# Test 1: Event schema
print("\n[1/4] Testing UnifiedEvent schema...")
try:
    from shared.models.event import (
        UnifiedEvent,
        EventSource,
        EventSeverity,
        EventCategory,
        EventType,
        DeviceInfo,
    )

    device = DeviceInfo(
        device_id="test-dev",
        device_name="Test Device",
        device_type="switch",
        site_id="test-site",
    )

    event = UnifiedEvent(
        event_id="test-001",
        timestamp=datetime.utcnow(),
        source=EventSource.DNAC,
        severity=EventSeverity.MAJOR,
        category=EventCategory.CONNECTIVITY,
        event_type=EventType.LINK_DOWN,
        title="Test Event",
        description="Test event for validation",
        device=device,
    )

    assert event.event_id == "test-001"
    assert event.is_connectivity_issue()
    row = event.to_clickhouse_row()
    assert "event_id" in row

    print("  ✓ UnifiedEvent schema works")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    sys.exit(1)

# Test 2: Incident schema
print("\n[2/4] Testing Incident schema...")
try:
    from shared.models.incident import Incident, IncidentSeverity, IncidentStatus

    incident = Incident(
        title="Test Incident",
        severity=IncidentSeverity.MAJOR,
    )

    assert incident.incident_id.startswith("inc-")
    assert incident.status == IncidentStatus.OPEN

    incident.add_event("evt-1", device_id="dev-1", site_id="site-1")
    assert len(incident.related_event_ids) == 1

    incident.update_confidence(0.75, probable_cause="Test cause")
    assert incident.confidence_score == 0.75

    row = incident.to_clickhouse_dict()
    assert "incident_id" in row

    print("  ✓ Incident schema works")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    sys.exit(1)

# Test 3: Correlation engine
print("\n[3/4] Testing Correlation engine...")
try:
    from shared.correlation import CorrelationEngine, correlate_events
    from shared.models.event import UnifiedEvent, EventSource, EventSeverity, EventCategory, EventType, DeviceInfo

    base_time = datetime.utcnow()

    events = [
        UnifiedEvent(
            event_id=f"test-{i}",
            timestamp=base_time,
            source=EventSource.DNAC,
            severity=EventSeverity.MAJOR,
            category=EventCategory.CONNECTIVITY,
            event_type=EventType.LINK_DOWN,
            title=f"Event {i}",
            description="Test",
            device=DeviceInfo(
                device_id=f"dev-{i}",
                device_type="switch",
                site_id="test-site",
            ),
        )
        for i in range(3)
    ]

    incidents = correlate_events(events)
    assert len(incidents) >= 1, "Expected at least 1 incident"
    assert incidents[0].severity == IncidentSeverity.MAJOR
    assert len(incidents[0].related_event_ids) >= 2

    print(f"  ✓ Correlation engine works ({len(incidents)} incidents from {len(events)} events)")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    sys.exit(1)

# Test 4: Mock telemetry pipeline
print("\n[4/4] Testing Mock telemetry pipeline...")
try:
    # Direct imports to avoid relative import issues
    sys.path.insert(0, str(Path(__file__).parent / "backend" / "worker"))
    from mock_ingest.dnac_mock import DNACMockGenerator
    from mock_ingest.mist_mock import MistMockGenerator
    from mock_ingest.sdwan_mock import SDWANMockGenerator

    # Test DNAC
    dnac_gen = DNACMockGenerator(site_id="test-site")
    dnac_payloads = dnac_gen.generate_events(count=2)
    dnac_events = [dnac_gen.normalize_payload(p) for p in dnac_payloads]
    assert len(dnac_events) == 2
    assert all(e.source == EventSource.DNAC for e in dnac_events)

    # Test Mist
    mist_gen = MistMockGenerator(site_id="test-site")
    mist_payloads = mist_gen.generate_events(count=2)
    mist_events = [mist_gen.normalize_payload(p) for p in mist_payloads]
    assert len(mist_events) == 2
    assert all(e.source == EventSource.MIST for e in mist_events)

    # Test SD-WAN
    sdwan_gen = SDWANMockGenerator(site_id="test-site")
    sdwan_payloads = sdwan_gen.generate_events(count=2)
    sdwan_events = [sdwan_gen.normalize_payload(p) for p in sdwan_payloads]
    assert len(sdwan_events) == 2
    assert all(e.source == EventSource.ARISTA_SDWAN for e in sdwan_events)

    # Test full pipeline
    all_events = dnac_events + mist_events + sdwan_events
    incidents = correlate_events(all_events)

    print(f"  ✓ Mock telemetry pipeline works")
    print(f"    - Generated {len(all_events)} events across 3 vendors")
    print(f"    - Correlated into {len(incidents)} incidents")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Summary
print("\n" + "="*80)
print("✅ FULL STACK VALIDATION PASSED")
print("="*80)
print("\nThe Naxis MVP operational intelligence stack is fully functional:")
print("  ✓ UnifiedEvent schema")
print("  ✓ Incident schema")
print("  ✓ Correlation engine")
print("  ✓ Mock telemetry pipeline (DNAC, Mist, SD-WAN)")
print("\nNext steps:")
print("  1. Run mock pipeline: python3 backend/worker/mock_ingest/runner.py")
print("  2. Deploy ClickHouse and persist events/incidents")
print("  3. Build incident API endpoints")
print("  4. Integrate real vendor APIs")
print("="*80)
