"""
Event Factory

Helper functions for creating UnifiedEvent instances from vendor events.
Used by collectors during normalization.
"""

import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List

from .event import (
    UnifiedEvent,
    EventSource,
    EventSeverity,
    EventCategory,
    EventType,
    DeviceInfo,
    ClientInfo,
    InterfaceInfo,
    MetricData,
)


class EventFactory:
    """Factory for creating UnifiedEvent instances"""

    @staticmethod
    def create_event(
        source: EventSource,
        severity: EventSeverity,
        category: EventCategory,
        event_type: EventType,
        title: str,
        description: str,
        timestamp: Optional[datetime] = None,
        device: Optional[DeviceInfo] = None,
        client: Optional[ClientInfo] = None,
        interface: Optional[InterfaceInfo] = None,
        metrics: Optional[List[MetricData]] = None,
        tags: Optional[List[str]] = None,
        source_event_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        raw_event: Optional[Dict[str, Any]] = None,
    ) -> UnifiedEvent:
        """
        Create a normalized UnifiedEvent.

        Args:
            source: Vendor source
            severity: Event severity
            category: Event category
            event_type: Specific event type
            title: Human-readable title
            description: Detailed description
            timestamp: Event timestamp (defaults to now)
            device: Device information
            client: Client information
            interface: Interface information
            metrics: Performance metrics
            tags: Event tags
            source_event_id: Original vendor event ID
            metadata: Vendor-specific metadata
            raw_event: Original vendor event (for debugging)

        Returns:
            UnifiedEvent instance
        """
        return UnifiedEvent(
            event_id=str(uuid.uuid4()),
            timestamp=timestamp or datetime.utcnow(),
            source=source,
            source_event_id=source_event_id,
            severity=severity,
            category=category,
            event_type=event_type,
            title=title,
            description=description,
            device=device,
            client=client,
            interface=interface,
            metrics=metrics or [],
            tags=tags or [],
            metadata=metadata or {},
            raw_event=raw_event,
        )

    @staticmethod
    def create_link_down_event(
        source: EventSource,
        device: DeviceInfo,
        interface: InterfaceInfo,
        timestamp: Optional[datetime] = None,
        source_event_id: Optional[str] = None,
        raw_event: Optional[Dict[str, Any]] = None,
    ) -> UnifiedEvent:
        """Create a link down event"""
        return EventFactory.create_event(
            source=source,
            severity=EventSeverity.MAJOR,
            category=EventCategory.CONNECTIVITY,
            event_type=EventType.LINK_DOWN,
            title=f"Link down: {device.device_name} - {interface.interface_name}",
            description=f"Interface {interface.interface_name} on {device.device_name} is down",
            timestamp=timestamp,
            device=device,
            interface=interface,
            tags=["connectivity", "link", "outage"],
            source_event_id=source_event_id,
            raw_event=raw_event,
        )

    @staticmethod
    def create_high_cpu_event(
        source: EventSource,
        device: DeviceInfo,
        cpu_value: float,
        threshold: float = 80.0,
        timestamp: Optional[datetime] = None,
        source_event_id: Optional[str] = None,
        raw_event: Optional[Dict[str, Any]] = None,
    ) -> UnifiedEvent:
        """Create a high CPU event"""
        severity = EventSeverity.CRITICAL if cpu_value >= 95 else EventSeverity.MAJOR

        return EventFactory.create_event(
            source=source,
            severity=severity,
            category=EventCategory.PERFORMANCE,
            event_type=EventType.HIGH_CPU,
            title=f"High CPU: {device.device_name} - {cpu_value}%",
            description=f"CPU utilization on {device.device_name} is {cpu_value}% (threshold: {threshold}%)",
            timestamp=timestamp,
            device=device,
            metrics=[
                MetricData(
                    metric_name="cpu_utilization",
                    metric_value=cpu_value,
                    metric_unit="%",
                    threshold=threshold,
                )
            ],
            tags=["performance", "cpu", "threshold"],
            source_event_id=source_event_id,
            raw_event=raw_event,
        )

    @staticmethod
    def create_client_auth_failed_event(
        source: EventSource,
        client: ClientInfo,
        device: DeviceInfo,
        reason: str,
        timestamp: Optional[datetime] = None,
        source_event_id: Optional[str] = None,
        raw_event: Optional[Dict[str, Any]] = None,
    ) -> UnifiedEvent:
        """Create a client authentication failed event"""
        return EventFactory.create_event(
            source=source,
            severity=EventSeverity.WARNING,
            category=EventCategory.SECURITY,
            event_type=EventType.CLIENT_AUTH_FAILED,
            title=f"Client auth failed: {client.client_mac or client.client_id}",
            description=f"Client {client.client_mac or client.client_id} failed to authenticate on {device.device_name}. Reason: {reason}",
            timestamp=timestamp,
            device=device,
            client=client,
            tags=["security", "authentication", "client"],
            source_event_id=source_event_id,
            metadata={"auth_failure_reason": reason},
            raw_event=raw_event,
        )

    @staticmethod
    def create_device_unreachable_event(
        source: EventSource,
        device: DeviceInfo,
        timestamp: Optional[datetime] = None,
        source_event_id: Optional[str] = None,
        raw_event: Optional[Dict[str, Any]] = None,
    ) -> UnifiedEvent:
        """Create a device unreachable event"""
        return EventFactory.create_event(
            source=source,
            severity=EventSeverity.CRITICAL,
            category=EventCategory.CONNECTIVITY,
            event_type=EventType.DEVICE_UNREACHABLE,
            title=f"Device unreachable: {device.device_name}",
            description=f"Device {device.device_name} ({device.device_ip}) is unreachable",
            timestamp=timestamp,
            device=device,
            tags=["connectivity", "device", "unreachable", "critical"],
            source_event_id=source_event_id,
            raw_event=raw_event,
        )

    @staticmethod
    def create_config_change_event(
        source: EventSource,
        device: DeviceInfo,
        changed_by: str,
        change_summary: str,
        timestamp: Optional[datetime] = None,
        source_event_id: Optional[str] = None,
        raw_event: Optional[Dict[str, Any]] = None,
    ) -> UnifiedEvent:
        """Create a configuration change event"""
        return EventFactory.create_event(
            source=source,
            severity=EventSeverity.INFO,
            category=EventCategory.CONFIGURATION,
            event_type=EventType.CONFIG_CHANGE,
            title=f"Config change: {device.device_name}",
            description=f"Configuration changed on {device.device_name} by {changed_by}. {change_summary}",
            timestamp=timestamp,
            device=device,
            tags=["configuration", "change", "audit"],
            source_event_id=source_event_id,
            metadata={"changed_by": changed_by, "change_summary": change_summary},
            raw_event=raw_event,
        )


def create_sample_event() -> UnifiedEvent:
    """Create a sample event for testing"""
    device = DeviceInfo(
        device_id="dev-001",
        device_name="core-switch-01",
        device_ip="10.1.1.1",
        device_type="switch",
        device_model="Catalyst 9300",
        site_id="site-hq",
        site_name="Headquarters",
    )

    interface = InterfaceInfo(
        interface_name="GigabitEthernet1/0/1",
        interface_type="physical",
        interface_status="down",
        speed="1Gbps",
        duplex="full",
    )

    return EventFactory.create_link_down_event(
        source=EventSource.DNAC,
        device=device,
        interface=interface,
        timestamp=datetime.utcnow(),
        source_event_id="dnac-event-12345",
    )
