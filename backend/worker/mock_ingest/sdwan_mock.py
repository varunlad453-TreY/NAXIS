"""
SD-WAN Mock Generator

Generates realistic SD-WAN/MPLS telemetry and normalizes to UnifiedEvent.
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
        MetricData,
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
        MetricData,
        UnifiedEvent,
    )
from .sample_payloads import sdwan_high_cpu_payload, sdwan_packet_loss_payload

logger = logging.getLogger(__name__)


class SDWANMockGenerator:
    """
    Generates mock SD-WAN/MPLS telemetry events.

    Simulates SD-WAN controller events:
      - Tunnel packet loss (MPLS degradation)
      - High device CPU
      - Tunnel state changes
    """

    def __init__(self, site_id: str = "site-sfo-01"):
        self.site_id = site_id
        self.source = EventSource.ARISTA_SDWAN  # Generic SD-WAN source

    def generate_events(self, count: int = 3, base_time: datetime = None) -> List[Dict[str, Any]]:
        """
        Generate mock SD-WAN event payloads.

        Args:
            count: Number of events to generate
            base_time: Base timestamp (defaults to now)

        Returns:
            List of raw SD-WAN payload dicts
        """
        if base_time is None:
            base_time = datetime.utcnow()

        payloads = []

        for i in range(count):
            timestamp = base_time + timedelta(seconds=i * 30)
            device_id = f"sdwan-edge-{i+1:03d}"
            tunnel_id = f"tunnel-{i+1:03d}"

            if i % 2 == 0:
                # Packet loss event
                payload = sdwan_packet_loss_payload(
                    device_id=device_id,
                    site_id=self.site_id,
                    tunnel_id=tunnel_id,
                    loss_pct=6.5 + (i * 1.5),
                    timestamp=timestamp,
                )
            else:
                # High CPU event
                payload = sdwan_high_cpu_payload(
                    device_id=device_id,
                    site_id=self.site_id,
                    cpu_pct=92.0 + (i * 2),
                    timestamp=timestamp,
                )

            payloads.append(payload)

        logger.info(f"Generated {len(payloads)} SD-WAN mock events")
        return payloads

    def normalize_payload(self, payload: Dict[str, Any]) -> UnifiedEvent:
        """
        Normalize SD-WAN payload to UnifiedEvent.

        Args:
            payload: Raw SD-WAN event payload

        Returns:
            UnifiedEvent object
        """
        # Extract timestamp (ISO8601 format)
        timestamp_str = payload.get("timestamp", datetime.utcnow().isoformat())
        # Remove 'Z' suffix if present
        if timestamp_str.endswith("Z"):
            timestamp_str = timestamp_str[:-1]
        timestamp = datetime.fromisoformat(timestamp_str)

        # Map SD-WAN severity
        sdwan_severity = payload.get("severity", "MEDIUM")
        severity = self._map_severity(sdwan_severity)

        # Extract device info
        device_data = payload.get("device", {})
        device_id = device_data.get("id", "unknown")
        device_name = device_data.get("name", device_id)
        site_id = device_data.get("site", "unknown")

        device = DeviceInfo(
            device_id=device_id,
            device_name=device_name,
            device_ip=device_data.get("mgmt_ip", ""),
            device_type=device_data.get("type", "router"),
            device_model=device_data.get("model"),
            site_id=site_id,
            site_name=f"Site-{site_id}",
        )

        # Determine event type and category
        event_type_str = payload.get("eventType", "unknown")
        event_type, category = self._map_event_type(event_type_str, payload)

        # Extract metrics if present
        metrics = []
        metrics_data = payload.get("metrics", {})
        if "packet_loss_pct" in metrics_data:
            metrics.append(
                MetricData(
                    metric_name="packet_loss",
                    metric_value=metrics_data["packet_loss_pct"],
                    metric_unit="%",
                    threshold=metrics_data.get("threshold_loss_pct"),
                )
            )
        if "latency_ms" in metrics_data:
            metrics.append(
                MetricData(
                    metric_name="latency",
                    metric_value=metrics_data["latency_ms"],
                    metric_unit="ms",
                )
            )
        if "cpu_utilization_pct" in metrics_data:
            metrics.append(
                MetricData(
                    metric_name="cpu_utilization",
                    metric_value=metrics_data["cpu_utilization_pct"],
                    metric_unit="%",
                    threshold=metrics_data.get("threshold_pct"),
                )
            )

        # Build UnifiedEvent
        event = UnifiedEvent(
            event_id=f"sdwan-{uuid4().hex[:12]}",
            timestamp=timestamp,
            source=self.source,
            source_event_id=payload.get("eventId", ""),
            severity=severity,
            category=category,
            event_type=event_type,
            title=event_type_str.replace("_", " ").title(),
            description=payload.get("message", "SD-WAN event"),
            device=device,
            metrics=metrics,
            tags=payload.get("tags", []) + ["sdwan"],
            metadata={
                "sdwan_priority": payload.get("priority"),
                "sdwan_recommendation": payload.get("recommendation"),
            },
            raw_event=payload,
        )

        logger.debug(f"Normalized SD-WAN event: {event.event_id} | {event.event_type.value}")
        return event

    @staticmethod
    def _map_severity(sdwan_severity: str) -> EventSeverity:
        """Map SD-WAN severity strings to EventSeverity."""
        mapping = {
            "CRITICAL": EventSeverity.CRITICAL,
            "HIGH": EventSeverity.MAJOR,
            "MEDIUM": EventSeverity.MINOR,
            "LOW": EventSeverity.WARNING,
            "INFO": EventSeverity.INFO,
        }
        return mapping.get(sdwan_severity.upper(), EventSeverity.INFO)

    @staticmethod
    def _map_event_type(event_type_str: str, payload: Dict[str, Any]) -> tuple:
        """Map SD-WAN event type to (EventType, EventCategory)."""
        type_lower = event_type_str.lower()

        if "tunnel" in type_lower and ("down" in type_lower or "degraded" in type_lower):
            return EventType.TUNNEL_DOWN, EventCategory.CONNECTIVITY
        elif "tunnel" in type_lower and "up" in type_lower:
            return EventType.TUNNEL_UP, EventCategory.CONNECTIVITY
        elif "packet_loss" in type_lower or "quality_degraded" in type_lower:
            return EventType.PACKET_LOSS, EventCategory.PERFORMANCE
        elif "latency" in type_lower:
            return EventType.HIGH_LATENCY, EventCategory.PERFORMANCE
        elif "cpu" in type_lower or "performance" in type_lower:
            # Check if it's actually CPU-related
            metrics = payload.get("metrics", {})
            if "cpu_utilization_pct" in metrics:
                return EventType.HIGH_CPU, EventCategory.PERFORMANCE
            return EventType.OTHER, EventCategory.PERFORMANCE
        elif "bgp" in type_lower:
            return EventType.BGP_DOWN, EventCategory.CONNECTIVITY
        else:
            return EventType.OTHER, EventCategory.SYSTEM
