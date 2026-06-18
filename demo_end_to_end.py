#!/usr/bin/env python3
"""
End-to-End Demo: Mock Telemetry → Correlation → API

Demonstrates the complete Naxis operational intelligence flow:
  1. Generate mock vendor telemetry
  2. Normalize to UnifiedEvents
  3. Correlate into Incidents
  4. Store in incident service
  5. Query via FastAPI

This simulates the full production flow without external dependencies.
"""

import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

from api.services.incident_service import incident_service  # noqa: E402
from shared.correlation import CorrelationEngine  # noqa: E402
from worker.mock_ingest import (  # noqa: E402
    DNACMockGenerator,
    MistMockGenerator,
    SDWANMockGenerator,
)

print("=" * 80)
print("NAXIS END-TO-END DEMO")
print("Mock Telemetry → Correlation Engine → Incident API")
print("=" * 80)

# Clear any existing incidents
incident_service.clear_all()

# Step 1: Generate mock telemetry
print("\n[STEP 1] Generating mock vendor telemetry...")
print("-" * 80)

base_time = datetime.utcnow()
site_id = "site-sfo-01"

dnac_gen = DNACMockGenerator(site_id=site_id)
mist_gen = MistMockGenerator(site_id=site_id)
sdwan_gen = SDWANMockGenerator(site_id=site_id)

dnac_payloads = dnac_gen.generate_events(count=2, base_time=base_time)
mist_payloads = mist_gen.generate_events(count=2, base_time=base_time)
sdwan_payloads = sdwan_gen.generate_events(count=2, base_time=base_time)

print(f"  ✓ Generated {len(dnac_payloads)} DNAC events")
print(f"  ✓ Generated {len(mist_payloads)} Mist events")
print(f"  ✓ Generated {len(sdwan_payloads)} SD-WAN events")

# Step 2: Normalize to UnifiedEvents
print("\n[STEP 2] Normalizing to UnifiedEvent schema...")
print("-" * 80)

all_events = []

for payload in dnac_payloads:
    event = dnac_gen.normalize_payload(payload)
    all_events.append(event)
    print(f"  • {event.event_id:20} | {event.source.value:12} | {event.event_type.value}")

for payload in mist_payloads:
    event = mist_gen.normalize_payload(payload)
    all_events.append(event)
    print(f"  • {event.event_id:20} | {event.source.value:12} | {event.event_type.value}")

for payload in sdwan_payloads:
    event = sdwan_gen.normalize_payload(payload)
    all_events.append(event)
    print(f"  • {event.event_id:20} | {event.source.value:12} | {event.event_type.value}")

print(f"\n  ✓ Normalized {len(all_events)} events")

# Step 3: Run correlation engine
print("\n[STEP 3] Running correlation engine...")
print("-" * 80)

engine = CorrelationEngine()
incidents = engine.process_events(all_events)

print(f"  ✓ Generated {len(incidents)} incidents")

for incident in incidents:
    print(f"\n  Incident: {incident.incident_id}")
    print(f"    Title:      {incident.title}")
    print(f"    Severity:   {incident.severity.value}")
    print(f"    Events:     {len(incident.related_event_ids)}")
    print(f"    Devices:    {len(incident.affected_devices)}")
    print(f"    Confidence: {incident.confidence_score:.2f}")

# Step 4: Store incidents in API service
print("\n[STEP 4] Storing incidents in API service...")
print("-" * 80)

incident_service.add_incidents(incidents)
print(f"  ✓ Stored {len(incidents)} incidents in API service")

# Step 5: Query via API service (simulates REST API calls)
print("\n[STEP 5] Querying incidents via API service...")
print("-" * 80)

# List all incidents
all_incidents = incident_service.list_incidents()
print(f"\n  GET /incidents")
print(f"    → {len(all_incidents)} incidents found")

# Get active incidents
active_incidents = incident_service.get_active_incidents()
print(f"\n  GET /incidents/active")
print(f"    → {len(active_incidents)} active incidents")

# Get specific incident
if incidents:
    incident_id = incidents[0].incident_id
    incident = incident_service.get_incident(incident_id)
    print(f"\n  GET /incidents/{incident_id}")
    print(f"    → Found: {incident.title}")
    print(f"    → Severity: {incident.severity.value}")
    print(f"    → Status: {incident.status.value}")

# Get stats
stats = incident_service.get_stats()
print(f"\n  Statistics:")
print(f"    Total incidents: {stats['total']}")
print(f"    By status:  {stats['by_status']}")
print(f"    By severity: {stats['by_severity']}")

# Summary
print("\n" + "=" * 80)
print("END-TO-END DEMO COMPLETE")
print("=" * 80)
print("\nFlow Summary:")
print(f"  • {len(all_events)} vendor events generated")
print(f"  • {len(incidents)} incidents correlated")
print(f"  • {len(all_incidents)} incidents stored")
print(f"  • {len(active_incidents)} active incidents")
print("\nAPI is now ready to serve these incidents!")
print("\nTo start the API server:")
print("  python3 -m uvicorn backend.api.main:app --reload --host 0.0.0.0 --port 8000")
print("\nThen query with:")
print("  curl http://localhost:8000/health")
print("  curl http://localhost:8000/incidents")
print("  curl http://localhost:8000/incidents/active")
print(f"  curl http://localhost:8000/incidents/{incidents[0].incident_id if incidents else 'inc-xxx'}")
print("\nAPI Documentation:")
print("  http://localhost:8000/docs")
print("=" * 80)
