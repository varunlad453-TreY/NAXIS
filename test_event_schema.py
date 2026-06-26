#!/usr/bin/env python3
"""
Quick validation test for event schema.
Run this to verify the event model works correctly.
"""

import sys
import json
from datetime import datetime
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from shared.models.event import (
    UnifiedEvent,
    EventSource,
    EventSeverity,
    EventCategory,
    EventType,
    DeviceInfo,
    InterfaceInfo,
)
from shared.models.event_factory import EventFactory, create_sample_event


def test_basic_event():
    """Test basic event creation"""
    print("✓ Testing basic event creation...")

    device = DeviceInfo(
        device_id="dev-001",
        device_name="core-switch-01",
        device_ip="10.1.1.1",
        device_type="switch",
    )

    event = UnifiedEvent(
        event_id="test-001",
        timestamp=datetime.utcnow(),
        source=EventSource.DNAC,
        severity=EventSeverity.MAJOR,
        category=EventCategory.CONNECTIVITY,
        event_type=EventType.LINK_DOWN,
        title="Test Event",
        description="This is a test event",
        device=device,
    )

    assert event.event_id == "test-001"
    assert event.source == EventSource.DNAC
    assert event.severity == EventSeverity.MAJOR
    assert event.is_connectivity_issue()
    assert event.is_critical()

    print("  ✓ Basic event creation works")


def test_event_factory():
    """Test event factory methods"""
    print("✓ Testing event factory...")

    device = DeviceInfo(
        device_id="dev-001",
        device_name="core-switch-01",
        device_ip="10.1.1.1",
        device_type="switch",
    )

    interface = InterfaceInfo(
        interface_name="GigabitEthernet1/0/1",
        interface_type="physical",
    )

    # Test link down event
    event = EventFactory.create_link_down_event(
        source=EventSource.DNAC,
        device=device,
        interface=interface,
    )

    assert event.event_type == EventType.LINK_DOWN
    assert event.category == EventCategory.CONNECTIVITY
    assert event.severity == EventSeverity.MAJOR
    assert len(event.tags) > 0

    print("  ✓ Event factory works")


def test_high_cpu_event():
    """Test high CPU event creation"""
    print("✓ Testing high CPU event...")

    device = DeviceInfo(
        device_id="dev-002",
        device_name="router-01",
        device_ip="10.1.1.2",
        device_type="router",
    )

    event = EventFactory.create_high_cpu_event(
        source=EventSource.MIST,
        device=device,
        cpu_value=96.5,
        threshold=80.0,
    )

    assert event.event_type == EventType.HIGH_CPU
    assert event.category == EventCategory.PERFORMANCE
    assert event.severity == EventSeverity.CRITICAL
    assert len(event.metrics) == 1
    assert event.metrics[0].metric_value == 96.5

    print("  ✓ High CPU event works")


def test_clickhouse_conversion():
    """Test ClickHouse row conversion"""
    print("✓ Testing ClickHouse conversion...")

    event = create_sample_event()
    row = event.to_clickhouse_row()

    assert "event_id" in row
    assert "timestamp" in row
    assert "device_id" in row
    assert row["source"] == "dnac"
    assert row["severity"] == "major"

    print("  ✓ ClickHouse conversion works")


def test_json_serialization():
    """Test JSON serialization"""
    print("✓ Testing JSON serialization...")

    event = create_sample_event()
    json_str = event.model_dump_json()
    parsed = json.loads(json_str)

    assert "event_id" in parsed
    assert "timestamp" in parsed
    assert parsed["source"] == "dnac"

    # Test round-trip
    event2 = UnifiedEvent.model_validate_json(json_str)
    assert event2.event_id == event.event_id
    assert event2.source == event.source

    print("  ✓ JSON serialization works")


def test_event_methods():
    """Test event helper methods"""
    print("✓ Testing event helper methods...")

    event = create_sample_event()

    # Test add_tag
    event.add_tag("urgent")
    assert "urgent" in event.tags

    # Test tag normalization
    event.add_tag("URGENT")
    assert event.tags.count("urgent") == 1  # Should not duplicate

    # Test link_incident
    event.link_incident("incident-001")
    assert event.incident_id == "incident-001"

    # Test category checks
    assert event.is_connectivity_issue()
    assert not event.is_performance_issue()
    assert not event.is_security_issue()

    print("  ✓ Event methods work")


def print_sample_event():
    """Print a sample event for inspection"""
    print("\n" + "="*60)
    print("SAMPLE UNIFIED EVENT")
    print("="*60)

    event = create_sample_event()
    print(event.model_dump_json(indent=2))

    print("\n" + "="*60)
    print("CLICKHOUSE ROW FORMAT")
    print("="*60)

    row = event.to_clickhouse_row()
    print(json.dumps(row, indent=2, default=str))


def main():
    """Run all tests"""
    print("Testing Naxis Event Schema\n")

    try:
        test_basic_event()
        test_event_factory()
        test_high_cpu_event()
        test_clickhouse_conversion()
        test_json_serialization()
        test_event_methods()

        print("\n✅ All tests passed!\n")

        print_sample_event()

        print("\n" + "="*60)
        print("Event schema is ready for use!")
        print("="*60)

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
