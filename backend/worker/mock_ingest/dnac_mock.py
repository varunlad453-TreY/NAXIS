"""
Cisco DNAC Mock Generator

Generates realistic DNAC telemetry and normalizes to UnifiedEvent.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List
from uuid import uuid4

try:
    from ...shared.models.event import (
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
except (ImportError, ValueError):
    # Fallback for direct execution
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from shared.models.event import (
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
from .sample_payloads import dnac_device_unreachable_payload, dnac_high_latency_payload

logger = logging.getLogger(__name__)


class DNACMockGenerator:
    """
    Generates mock Cisco DNAC telemetry events.

    Simulates DNAC assurance issues:
      - High WAN latency
      - Device unreachable
      - Interface issues
    """

    def __init__(self, site_id: str = "site-sfo-01"):
        self.site_id = site_id
        self.source = EventSource.DNAC

    def generate_events(self, count: int = 3, base_time: datetime = None) -> List[Dict[str, Any]]:
        """
        Generate mock DNAC event payloads.

        Args:
            count: Number of events to generate
            base_time: Base timestamp (defaults to now)

        Returns:
            List of raw DNAC payload dicts
        """
        if base_time is None:
            base_time = datetime.utcnow()

        payloads = []

        # Generate variety of events
        for i in range(count):
            timestamp = base_time + timedelta(seconds=i * 30)
            device_id = f"dnac-dev-{i+1:03d}"

            if i % 3 == 0:
                # High latency event
                payload = dnac_high_latency_payload(
                    device_id=device_id,
                    site_id=self.site_id,
                    latency_ms=150.0 + (i * 10),
                    timestamp=timestamp,
                )
            elif i % 3 == 1:
                # Device unreachable
                payload = dnac_device_unreachable_payload(
                    device_id=device_id,
                    site_id=self.site_id,
                    timestamp=timestamp,
                )
            else:
                # High latency variation
                payload = dnac_high_latency_payload(
                    device_id=device_id,
                    site_id=self.site_id,
                    latency_ms=200.0 + (i * 15),
                    timestamp=timestamp,
                )

            payloads.append(payload)

        logger.info(f"Generated {len(payloads)} DNAC mock events")
        return payloads

    def normalize_payload(self, payload: Dict[str, Any]) -> UnifiedEvent:
        """
        Normalize DNAC payload to UnifiedEvent.

        Args:
            payload: Raw DNAC event payload

        Returns:
            UnifiedEvent object
        """
        # Extract timestamp (DNAC uses milliseconds)
        timestamp_ms = payload.get("timestamp", int(datetime.utcnow().timestamp() * 1000))
        timestamp = datetime.utcfromtimestamp(timestamp_ms / 1000)

        # Map DNAC severity to EventSeverity
        dnac_severity = payload.get("severity", 5)
        severity = self._map_severity(dnac_severity)

        # Extract device info
        network = payload.get("network", {})
        device_id = network.get("deviceId") or payload.get("details", {}).get("Device", "unknown")
        site_id = network.get("siteId", "unknown")

        device = DeviceInfo(
            device_id=device_id,
            device_name=device_id,
            device_ip=network.get("managementIp", ""),
            device_type="router",
            site_id=site_id,
            site_name=f"Site-{site_id}",
        )

        # Determine event type and category
        event_name = payload.get("name", "Unknown")
        event_type, category = self._map_event_type(event_name, payload)

        # Build UnifiedEvent
        event = UnifiedEvent(
            event_id=f"dnac-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.DNAC,
            source_event_id=payload.get("eventId", ""),
            severity=severity,
            category=category,
            event_type=event_type,
            title=payload.get("name", "DNAC Event").replace("_", " "),
            description=payload.get("message", payload.get("description", "No description")),
            device=device,
            tags=payload.get("tags", []),
            metadata={"dnac_namespace": payload.get("namespace"), "dnac_domain": payload.get("domain")},
            raw_event=payload,
        )

        logger.debug(f"Normalized DNAC event: {event.event_id} | {event.event_type.value}")
        return event

    @staticmethod
    def _map_severity(dnac_severity: int) -> EventSeverity:
        """Map DNAC severity (1-5) to EventSeverity."""
        mapping = {
            1: EventSeverity.CRITICAL,  # DNAC P0
            2: EventSeverity.CRITICAL,  # DNAC P1
            3: EventSeverity.MAJOR,     # DNAC P2
            4: EventSeverity.MINOR,     # DNAC P3
            5: EventSeverity.WARNING,   # DNAC P4
        }
        return mapping.get(dnac_severity, EventSeverity.INFO)

    @staticmethod
    def _map_event_type(event_name: str, payload: Dict[str, Any]) -> tuple:
        """Map DNAC event name to (EventType, EventCategory)."""
        name_lower = event_name.lower()

        if "unreachable" in name_lower:
            return EventType.DEVICE_UNREACHABLE, EventCategory.CONNECTIVITY
        elif "latency" in name_lower:
            return EventType.HIGH_LATENCY, EventCategory.PERFORMANCE
        elif "interface" in name_lower and "down" in name_lower:
            return EventType.INTERFACE_DOWN, EventCategory.CONNECTIVITY
        elif "cpu" in name_lower:
            return EventType.HIGH_CPU, EventCategory.PERFORMANCE
        elif "memory" in name_lower:
            return EventType.HIGH_MEMORY, EventCategory.PERFORMANCE
        elif "bgp" in name_lower:
            return EventType.BGP_DOWN, EventCategory.CONNECTIVITY
        else:
            return EventType.OTHER, EventCategory.SYSTEM
