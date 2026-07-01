"""
Device API Models
"""

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class DeviceSummary(BaseModel):
    device_id: str = Field(..., description="Unique device ID")
    platform: str = Field(..., description="Vendor platform")
    hostname: str = Field(default="", description="Device hostname")
    mac: str = Field(default="", description="MAC address")
    serial: str = Field(default="", description="Serial number")
    model: str = Field(default="", description="Hardware model")
    ip_address: str = Field(default="", description="Management IP")
    device_type: str = Field(default="", description="Device type")
    site_id: str = Field(default="", description="Site ID")
    site_name: str = Field(default="", description="Site name")
    connected: bool = Field(default=False, description="Currently connected to cloud")
    reachability: str = Field(default="unknown", description="Reachability status")
    num_clients: int = Field(default=0, description="Number of connected clients")
    uptime_seconds: int = Field(default=0, description="Uptime in seconds")
    firmware_version: str = Field(default="", description="Firmware/software version")
    management_state: str = Field(default="managed", description="Management state")
    last_seen: Optional[datetime] = Field(None, description="Last seen timestamp")
    props: Optional[Dict[str, Any]] = Field(None, description="Platform-specific properties (VeloBrain scores, links, etc.)")


class DeviceListResponse(BaseModel):
    devices: list[DeviceSummary] = Field(default_factory=list)
    total: int = Field(..., description="Total matching devices")
    page: int = Field(default=1)
    page_size: int = Field(default=100)
