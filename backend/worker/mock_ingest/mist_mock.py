"""
Juniper Mist Mock Generator

Generates realistic Mist wireless telemetry and normalizes to UnifiedEvent.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List
from uuid import uuid4

try:
    from ...shared.models.event import (
        ClientInfo,
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
        ClientInfo,
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
from .sample_payloads import mist_ap_degraded_payload, mist_client_retry_payload

logger = logging.getLogger(__name__)


class MistMockGenerator:
    """
    Generates mock Juniper Mist wireless telemetry events.

    Simulates Mist events:
      - Client retry issues (poor RF)
      - AP health degradation
      - Authentication failures
    """

    def __init__(self, site_id: str = "site-sfo-01"):
        self.site_id = site_id
        self.source = EventSource.MIST

    def generate_events(self, count: int = 3, base_time: datetime = None) -> List[Dict[str, Any]]:
        """
        Generate mock Mist event payloads.

        Args:
            count: Number of events to generate
            base_time: Base timestamp (defaults to now)

        Returns:
            List of raw Mist payload dicts
        """
        if base_time is None:
            base_time = datetime.utcnow()

        payloads = []

        for i in range(count):
            timestamp = base_time + timedelta(seconds=i * 30)
            ap_id = f"mist-ap-{i+1:03d}"

            if i % 2 == 0:
                # Client retry event
                payload = mist_client_retry_payload(
                    ap_id=ap_id,
                    site_id=self.site_id,
                    client_mac=f"aa:bb:cc:dd:ee:{i+1:02x}",
                    ssid="Corporate-WiFi",
                    retry_pct=25.0 + (i * 5),
                    timestamp=timestamp,
                )
            else:
                # AP health degraded
                payload = mist_ap_degraded_payload(
                    ap_id=ap_id,
                    site_id=self.site_id,
                    timestamp=timestamp,
                )

            payloads.append(payload)

        logger.info(f"Generated {len(payloads)} Mist mock events")
        return payloads

    def normalize_payload(self, payload: Dict[str, Any]) -> UnifiedEvent:
        """
        Normalize Mist payload to UnifiedEvent.

        Mist payloads are wrapped in {"topic": ..., "events": [...]}.
        We extract the first event from the array.

        Args:
            payload: Raw Mist event payload

        Returns:
            UnifiedEvent object
        """
        # Mist wraps events in an array
        events = payload.get("events", [])
        if not events:
            raise ValueError("Mist payload has no events array")

        event_data = events[0]

        # Extract timestamp
        timestamp_sec = event_data.get("timestamp", int(datetime.utcnow().timestamp()))
        timestamp = datetime.utcfromtimestamp(timestamp_sec)

        # Map Mist severity
        mist_severity = event_data.get("severity", "info")
        severity = self._map_severity(mist_severity)

        # Extract device (AP) info
        ap_id = event_data.get("ap_id") or event_data.get("ap", "unknown")
        ap_name = event_data.get("ap_name", ap_id)
        site_id = event_data.get("site_id", "unknown")
        site_name = event_data.get("site_name", f"Site-{site_id}")

        device = DeviceInfo(
            device_id=ap_id,
            device_name=ap_name,
            device_type="ap",
            site_id=site_id,
            site_name=site_name,
        )

        # Extract client info (if present)
        client = None
        client_mac = event_data.get("client_mac")
        if client_mac:
            client = ClientInfo(
                client_id=client_mac,
                client_mac=client_mac,
                ssid=event_data.get("ssid"),
            )

        # Determine event type and category
        event_type_str = event_data.get("type", "unknown")
        event_type, category = self._map_event_type(event_type_str, event_data)

        # Build description
        description = event_data.get("text", "Mist wireless event")
        if "retry_pct" in event_data:
            description += f" (retry: {event_data['retry_pct']}%)"
        if "health_score" in event_data:
            description += f" (health: {event_data['health_score']})"

        # Build UnifiedEvent
        event = UnifiedEvent(
            event_id=f"mist-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=EventSource.MIST,
            source_event_id=f"mist-{event_type_str}-{timestamp_sec}",
            severity=severity,
            category=category,
            event_type=event_type,
            title=event_type_str.replace("_", " ").title(),
            description=description,
            device=device,
            client=client,
            tags=["wireless", "mist"] + event_data.get("tags", []),
            metadata={
                "mist_org_id": event_data.get("org_id"),
                "mist_topic": payload.get("topic"),
            },
            raw_event=payload,
        )

        logger.debug(f"Normalized Mist event: {event.event_id} | {event.event_type.value}")
        return event

    @staticmethod
    def _map_severity(mist_severity: str) -> EventSeverity:
        """Map Mist severity strings to EventSeverity."""
        mapping = {
            "critical": EventSeverity.CRITICAL,
            "major": EventSeverity.MAJOR,
            "warn": EventSeverity.WARNING,
            "warning": EventSeverity.WARNING,
            "info": EventSeverity.INFO,
        }
        return mapping.get(mist_severity.lower(), EventSeverity.INFO)

    @staticmethod
    def _map_event_type(event_type_str: str, event_data: Dict[str, Any]) -> tuple:
        """Map Mist event type to (EventType, EventCategory)."""
        type_lower = event_type_str.lower()

        if "client" in type_lower and "retry" in type_lower:
            return EventType.CLIENT_ROAM, EventCategory.CLIENT
        elif "client" in type_lower and "auth" in type_lower:
            return EventType.CLIENT_AUTH_FAILED, EventCategory.SECURITY
        elif "client" in type_lower and "disconnect" in type_lower:
            return EventType.CLIENT_DISCONNECTED, EventCategory.CLIENT
        elif "ap_health" in type_lower or "degraded" in type_lower:
            return EventType.HARDWARE_ERROR, EventCategory.HARDWARE
        elif "rogue" in type_lower:
            return EventType.ROGUE_AP, EventCategory.SECURITY
        elif "marvis" in type_lower:
            # Marvis AI insights - typically client or performance issues
            if "retry" in event_data.get("text", "").lower():
                return EventType.PACKET_LOSS, EventCategory.PERFORMANCE
            return EventType.OTHER, EventCategory.APPLICATION
        else:
            return EventType.OTHER, EventCategory.SYSTEM
