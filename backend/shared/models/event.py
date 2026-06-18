"""
Unified Event Model

Normalized event schema that consolidates events from all vendors
(Cisco DNAC, Juniper Mist, Arista SD-WAN, Arista WLC) into a single format.
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field, field_validator


class EventSource(str, Enum):
    """Vendor sources for events"""
    DNAC = "dnac"
    MIST = "mist"
    ARISTA_SDWAN = "arista_sdwan"
    ARISTA_WLC = "arista_wlc"
    SYSTEM = "system"


class EventSeverity(str, Enum):
    """Event severity levels (aligned with syslog)"""
    CRITICAL = "critical"  # 1-2: System unusable, immediate action needed
    MAJOR = "major"        # 3: Major functionality affected
    MINOR = "minor"        # 4: Minor functionality affected
    WARNING = "warning"    # 5: Warning condition
    INFO = "info"          # 6: Informational
    DEBUG = "debug"        # 7: Debug-level messages


class EventCategory(str, Enum):
    """High-level event categories"""
    CONNECTIVITY = "connectivity"
    PERFORMANCE = "performance"
    SECURITY = "security"
    CONFIGURATION = "configuration"
    HARDWARE = "hardware"
    APPLICATION = "application"
    CLIENT = "client"
    SYSTEM = "system"


class EventType(str, Enum):
    """Specific event types (extensible)"""
    # Connectivity
    LINK_DOWN = "link_down"
    LINK_UP = "link_up"
    INTERFACE_DOWN = "interface_down"
    INTERFACE_UP = "interface_up"
    BGP_DOWN = "bgp_down"
    BGP_UP = "bgp_up"
    OSPF_NEIGHBOR_DOWN = "ospf_neighbor_down"
    OSPF_NEIGHBOR_UP = "ospf_neighbor_up"
    TUNNEL_DOWN = "tunnel_down"
    TUNNEL_UP = "tunnel_up"

    # Performance
    HIGH_CPU = "high_cpu"
    HIGH_MEMORY = "high_memory"
    HIGH_BANDWIDTH = "high_bandwidth"
    HIGH_LATENCY = "high_latency"
    PACKET_LOSS = "packet_loss"
    JITTER = "jitter"

    # Security
    AUTH_FAILURE = "auth_failure"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    ROGUE_AP = "rogue_ap"
    DOS_ATTACK = "dos_attack"
    SECURITY_VIOLATION = "security_violation"

    # Configuration
    CONFIG_CHANGE = "config_change"
    FIRMWARE_UPGRADE = "firmware_upgrade"
    POLICY_CHANGE = "policy_change"

    # Hardware
    POWER_SUPPLY_FAILURE = "power_supply_failure"
    FAN_FAILURE = "fan_failure"
    TEMPERATURE_HIGH = "temperature_high"
    HARDWARE_ERROR = "hardware_error"

    # Application
    APP_UNAVAILABLE = "app_unavailable"
    APP_SLOW = "app_slow"

    # Client
    CLIENT_CONNECTED = "client_connected"
    CLIENT_DISCONNECTED = "client_disconnected"
    CLIENT_ROAM = "client_roam"
    CLIENT_AUTH_FAILED = "client_auth_failed"

    # System
    DEVICE_UNREACHABLE = "device_unreachable"
    DEVICE_REACHABLE = "device_reachable"
    DEVICE_REBOOT = "device_reboot"
    SYSTEM_ERROR = "system_error"

    # Generic
    OTHER = "other"


class DeviceInfo(BaseModel):
    """Device information embedded in event"""
    device_id: str = Field(..., description="Canonical device ID")
    device_name: Optional[str] = Field(None, description="Device hostname")
    device_ip: Optional[str] = Field(None, description="Management IP")
    device_type: Optional[str] = Field(None, description="Device type (switch, router, ap, etc)")
    device_model: Optional[str] = Field(None, description="Device model")
    site_id: Optional[str] = Field(None, description="Site/location ID")
    site_name: Optional[str] = Field(None, description="Site/location name")


class ClientInfo(BaseModel):
    """Client/endpoint information embedded in event"""
    client_id: str = Field(..., description="Canonical client ID")
    client_mac: Optional[str] = Field(None, description="Client MAC address")
    client_ip: Optional[str] = Field(None, description="Client IP address")
    client_hostname: Optional[str] = Field(None, description="Client hostname")
    username: Optional[str] = Field(None, description="Username if authenticated")
    ssid: Optional[str] = Field(None, description="SSID for wireless clients")
    vlan: Optional[int] = Field(None, description="VLAN ID")


class InterfaceInfo(BaseModel):
    """Interface information embedded in event"""
    interface_name: str = Field(..., description="Interface name (e.g., GigabitEthernet0/0/1)")
    interface_type: Optional[str] = Field(None, description="Interface type")
    interface_status: Optional[str] = Field(None, description="Interface status")
    speed: Optional[str] = Field(None, description="Interface speed (e.g., 1Gbps)")
    duplex: Optional[str] = Field(None, description="Duplex mode")


class MetricData(BaseModel):
    """Performance metrics embedded in event"""
    metric_name: str = Field(..., description="Metric name (cpu, memory, latency, etc)")
    metric_value: float = Field(..., description="Metric value")
    metric_unit: str = Field(..., description="Unit (%, ms, Mbps, etc)")
    threshold: Optional[float] = Field(None, description="Threshold that was crossed")


class UnifiedEvent(BaseModel):
    """
    Unified event schema that normalizes events from all vendors.

    This is the core data model stored in ClickHouse and processed
    throughout the platform.
    """

    # Identity
    event_id: str = Field(..., description="Unique event ID (UUID)")

    # Temporal
    timestamp: datetime = Field(..., description="Event timestamp (UTC)")
    received_at: datetime = Field(default_factory=datetime.utcnow, description="Ingestion timestamp")

    # Source
    source: EventSource = Field(..., description="Vendor source")
    source_event_id: Optional[str] = Field(None, description="Original vendor event ID")

    # Classification
    severity: EventSeverity = Field(..., description="Event severity")
    category: EventCategory = Field(..., description="Event category")
    event_type: EventType = Field(..., description="Specific event type")

    # Content
    title: str = Field(..., description="Human-readable event title")
    description: str = Field(..., description="Detailed event description")

    # Entities
    device: Optional[DeviceInfo] = Field(None, description="Affected device")
    client: Optional[ClientInfo] = Field(None, description="Affected client")
    interface: Optional[InterfaceInfo] = Field(None, description="Affected interface")

    # Metrics (for performance events)
    metrics: List[MetricData] = Field(default_factory=list, description="Performance metrics")

    # Context
    tags: List[str] = Field(default_factory=list, description="Tags for filtering")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional vendor-specific metadata")

    # Correlation
    incident_id: Optional[str] = Field(None, description="Linked incident ID (if correlated)")
    correlation_key: Optional[str] = Field(None, description="Key used for correlation (device_id, site_id, etc)")

    # Raw Data
    raw_event: Optional[Dict[str, Any]] = Field(None, description="Original vendor event (for debugging)")

    @field_validator('timestamp', 'received_at')
    @classmethod
    def validate_timezone(cls, v: datetime) -> datetime:
        """Ensure all timestamps are UTC"""
        if v.tzinfo is None:
            return v.replace(tzinfo=None)
        return v.astimezone(None).replace(tzinfo=None)

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, v: List[str]) -> List[str]:
        """Normalize tags to lowercase"""
        return [tag.lower().strip() for tag in v]

    def to_clickhouse_row(self) -> Dict[str, Any]:
        """Convert to ClickHouse row format"""
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "received_at": self.received_at,
            "source": self.source.value,
            "source_event_id": self.source_event_id or "",
            "severity": self.severity.value,
            "category": self.category.value,
            "event_type": self.event_type.value,
            "title": self.title,
            "description": self.description,
            "device_id": self.device.device_id if self.device else "",
            "device_name": self.device.device_name if self.device else "",
            "device_ip": self.device.device_ip if self.device else "",
            "device_type": self.device.device_type if self.device else "",
            "site_id": self.device.site_id if self.device else "",
            "site_name": self.device.site_name if self.device else "",
            "client_id": self.client.client_id if self.client else "",
            "client_mac": self.client.client_mac if self.client else "",
            "client_ip": self.client.client_ip if self.client else "",
            "interface_name": self.interface.interface_name if self.interface else "",
            "tags": self.tags,
            "incident_id": self.incident_id or "",
            "correlation_key": self.correlation_key or "",
            "metadata": self.metadata,
            "raw_event": self.raw_event or {},
        }

    def add_tag(self, tag: str) -> None:
        """Add a tag to the event"""
        normalized = tag.lower().strip()
        if normalized not in self.tags:
            self.tags.append(normalized)

    def link_incident(self, incident_id: str) -> None:
        """Link this event to an incident"""
        self.incident_id = incident_id

    def is_connectivity_issue(self) -> bool:
        """Check if this is a connectivity-related event"""
        return self.category == EventCategory.CONNECTIVITY

    def is_performance_issue(self) -> bool:
        """Check if this is a performance-related event"""
        return self.category == EventCategory.PERFORMANCE

    def is_security_issue(self) -> bool:
        """Check if this is a security-related event"""
        return self.category == EventCategory.SECURITY

    def is_critical(self) -> bool:
        """Check if this event is critical severity"""
        return self.severity in [EventSeverity.CRITICAL, EventSeverity.MAJOR]


class EventQuery(BaseModel):
    """Query parameters for filtering events"""
    start_time: Optional[datetime] = Field(None, description="Start time filter")
    end_time: Optional[datetime] = Field(None, description="End time filter")
    sources: Optional[List[EventSource]] = Field(None, description="Filter by sources")
    severities: Optional[List[EventSeverity]] = Field(None, description="Filter by severities")
    categories: Optional[List[EventCategory]] = Field(None, description="Filter by categories")
    event_types: Optional[List[EventType]] = Field(None, description="Filter by event types")
    device_ids: Optional[List[str]] = Field(None, description="Filter by device IDs")
    site_ids: Optional[List[str]] = Field(None, description="Filter by site IDs")
    tags: Optional[List[str]] = Field(None, description="Filter by tags")
    incident_id: Optional[str] = Field(None, description="Filter by incident ID")
    search: Optional[str] = Field(None, description="Full-text search in title/description")
    limit: int = Field(100, ge=1, le=1000, description="Max results")
    offset: int = Field(0, ge=0, description="Pagination offset")


class EventStats(BaseModel):
    """Event statistics for dashboards"""
    total_count: int
    by_severity: Dict[EventSeverity, int]
    by_category: Dict[EventCategory, int]
    by_source: Dict[EventSource, int]
    time_range: Tuple[datetime, datetime]
