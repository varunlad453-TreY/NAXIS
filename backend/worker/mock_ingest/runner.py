#!/usr/bin/env python3
"""
Mock Telemetry Pipeline Runner

End-to-end demonstration of the Naxis operational intelligence pipeline:
    Mock Vendor Telemetry → UnifiedEvent → CorrelationEngine → Incidents

This simulates the live platform behavior with realistic vendor payloads.
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import List

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from backend.shared.correlation import CorrelationEngine  # noqa: E402
from backend.shared.models.event import UnifiedEvent  # noqa: E402
from backend.shared.models.incident import Incident  # noqa: E402
from backend.worker.mock_ingest import (  # noqa: E402
    DNACMockGenerator,
    MistMockGenerator,
    SDWANMockGenerator,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


class MockTelemetryPipeline:
    """
    Orchestrates the full mock telemetry pipeline.

    Flow:
      1. Generate mock vendor payloads (DNAC, Mist, SD-WAN)
      2. Normalize to UnifiedEvent objects
      3. Pass events to CorrelationEngine
      4. Output generated Incidents
    """

    def __init__(self, site_id: str = "site-sfo-01"):
        self.site_id = site_id
        self.dnac_gen = DNACMockGenerator(site_id=site_id)
        self.mist_gen = MistMockGenerator(site_id=site_id)
        self.sdwan_gen = SDWANMockGenerator(site_id=site_id)
        self.correlation_engine = CorrelationEngine()

    def run(
        self,
        dnac_count: int = 2,
        mist_count: int = 2,
        sdwan_count: int = 2,
        base_time: datetime = None,
    ) -> tuple[List[UnifiedEvent], List[Incident]]:
        """
        Run the complete pipeline.

        Args:
            dnac_count: Number of DNAC events to generate
            mist_count: Number of Mist events to generate
            sdwan_count: Number of SD-WAN events to generate
            base_time: Base timestamp (defaults to now)

        Returns:
            Tuple of (normalized events, generated incidents)
        """
        if base_time is None:
            base_time = datetime.utcnow()

        logger.info("="*80)
        logger.info("NAXIS MOCK TELEMETRY PIPELINE")
        logger.info("="*80)

        # Step 1: Generate vendor payloads
        logger.info("\n[STEP 1] Generating mock vendor telemetry...")
        dnac_payloads = self.dnac_gen.generate_events(count=dnac_count, base_time=base_time)
        mist_payloads = self.mist_gen.generate_events(count=mist_count, base_time=base_time)
        sdwan_payloads = self.sdwan_gen.generate_events(count=sdwan_count, base_time=base_time)

        logger.info(f"  ✓ DNAC:   {len(dnac_payloads)} events")
        logger.info(f"  ✓ Mist:   {len(mist_payloads)} events")
        logger.info(f"  ✓ SD-WAN: {len(sdwan_payloads)} events")

        # Step 2: Normalize to UnifiedEvent
        logger.info("\n[STEP 2] Normalizing to UnifiedEvent schema...")
        all_events: List[UnifiedEvent] = []

        for payload in dnac_payloads:
            event = self.dnac_gen.normalize_payload(payload)
            all_events.append(event)

        for payload in mist_payloads:
            event = self.mist_gen.normalize_payload(payload)
            all_events.append(event)

        for payload in sdwan_payloads:
            event = self.sdwan_gen.normalize_payload(payload)
            all_events.append(event)

        logger.info(f"  ✓ Normalized {len(all_events)} events")

        # Step 3: Correlate events
        logger.info("\n[STEP 3] Running correlation engine...")
        incidents = self.correlation_engine.process_events(all_events)
        logger.info(f"  ✓ Generated {len(incidents)} incidents")

        # Step 4: Output results
        self._print_results(all_events, incidents)

        return all_events, incidents

    def _print_results(self, events: List[UnifiedEvent], incidents: List[Incident]) -> None:
        """Print detailed pipeline results."""
        logger.info("\n" + "="*80)
        logger.info("PIPELINE RESULTS")
        logger.info("="*80)

        # Print event summary
        print("\n" + "─"*80)
        print("NORMALIZED EVENTS")
        print("─"*80)
        for event in events:
            print(
                f"  {event.event_id:15} | "
                f"{event.source.value:12} | "
                f"{event.severity.value:8} | "
                f"{event.event_type.value:20} | "
                f"{event.device.device_id if event.device else 'N/A':15}"
            )

        # Print incident summary
        print("\n" + "─"*80)
        print("GENERATED INCIDENTS")
        print("─"*80)
        if incidents:
            for incident in incidents:
                print(f"\nIncident: {incident.incident_id}")
                print(f"  Title:      {incident.title}")
                print(f"  Severity:   {incident.severity.value}")
                print(f"  Status:     {incident.status.value}")
                print(f"  Events:     {len(incident.related_event_ids)}")
                print(f"  Devices:    {len(incident.affected_devices)} ({', '.join(incident.affected_devices[:3])})")
                print(f"  Sites:      {', '.join(incident.affected_sites)}")
                print(f"  Confidence: {incident.confidence_score:.2f}")
                print(f"  Created:    {incident.created_at.strftime('%Y-%m-%d %H:%M:%S')}")
        else:
            print("  (No incidents generated - events below correlation threshold)")

        # Print detailed incident JSON
        if incidents:
            print("\n" + "─"*80)
            print("INCIDENT DETAIL (First Incident)")
            print("─"*80)
            print(json.dumps(incidents[0].to_clickhouse_dict(), indent=2, default=str))

        # Print statistics
        print("\n" + "─"*80)
        print("STATISTICS")
        print("─"*80)
        print(f"  Total events processed:     {len(events)}")
        print(f"  Incidents generated:        {len(incidents)}")
        print(f"  Total devices affected:     {len(set(e.device.device_id for e in events if e.device))}")
        print(f"  Total sites affected:       {len(set(e.device.site_id for e in events if e.device and e.device.site_id))}")
        print(f"  Correlation success rate:   {len(incidents) / max(len(events), 1) * 100:.1f}%")


def demo_scenario_wan_degradation():
    """
    Demo scenario: WAN degradation affecting a site.

    Simulates:
      - DNAC detects high WAN latency
      - Mist detects wireless retries (clients affected by poor connectivity)
      - SD-WAN detects MPLS packet loss

    Expected outcome: 1 major incident correlating all events
    """
    print("\n" + "="*80)
    print("DEMO SCENARIO: WAN DEGRADATION AT SITE SFO-01")
    print("="*80)
    print("\nScenario:")
    print("  - DNAC reports high WAN latency on edge routers")
    print("  - Mist reports wireless client retry issues (poor connectivity)")
    print("  - SD-WAN controller detects MPLS packet loss")
    print("\nExpected: Single correlated incident showing site-wide impact")
    print("="*80)

    pipeline = MockTelemetryPipeline(site_id="site-sfo-01")
    incidents = pipeline.run(dnac_count=2, mist_count=2, sdwan_count=2)

    print("\n" + "="*80)
    if len(incidents) == 1:
        print("✅ SCENARIO SUCCESS: 1 correlated incident generated")
    elif len(incidents) > 1:
        print(f"⚠️  SCENARIO PARTIAL: {len(incidents)} incidents generated (expected 1)")
    else:
        print("❌ SCENARIO FAILED: No incidents generated")
    print("="*80)

    return incidents


def demo_scenario_multi_site():
    """
    Demo scenario: Issues at multiple sites (should create multiple incidents).
    """
    print("\n" + "="*80)
    print("DEMO SCENARIO: MULTI-SITE ISSUES")
    print("="*80)
    print("\nScenario:")
    print("  - Different events at different sites")
    print("\nExpected: Multiple independent incidents")
    print("="*80)

    base_time = datetime.utcnow()

    # Site 1
    pipeline1 = MockTelemetryPipeline(site_id="site-nyc-01")
    incidents1 = pipeline1.run(dnac_count=2, mist_count=0, sdwan_count=0, base_time=base_time)

    # Site 2
    pipeline2 = MockTelemetryPipeline(site_id="site-lax-01")
    incidents2 = pipeline2.run(dnac_count=0, mist_count=2, sdwan_count=0, base_time=base_time)

    all_incidents = incidents1 + incidents2

    print("\n" + "="*80)
    print(f"✅ MULTI-SITE RESULT: {len(all_incidents)} incidents across sites")
    print("="*80)

    return all_incidents


def main():
    """Run demo scenarios."""
    logger.info("Starting Naxis Mock Telemetry Pipeline\n")

    try:
        # Demo 1: WAN degradation (primary scenario)
        demo_scenario_wan_degradation()

        # Uncomment to run multi-site demo
        # print("\n\n")
        # demo_scenario_multi_site()

        print("\n" + "="*80)
        print("Pipeline execution complete!")
        print("="*80)

    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
