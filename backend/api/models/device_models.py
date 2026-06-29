"""
Device API Models

Pydantic response models for device endpoints.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class DeviceSummary(BaseModel):
    """Lightweight device summary for inventory views."""

    device_id: str = Field(..., description="Unique device ID")
    platform: str = Field(..., description="Vendor platform")
    hostname: str = Field(default="", description="Device hostname")
    ip_address: str = Field(default="", description="Management IP")
    device_type: str = Field(default="", description="Device type")
    site_id: str = Field(default="", description="Site ID")
    site_name: str = Field(default="", description="Site name")
    reachability: str = Field(default="unknown", description="Reachability status")
    management_state: str = Field(default="unknown", description="Management state")
    last_seen: Optional[datetime] = Field(None, description="Last seen timestamp")


class DeviceListResponse(BaseModel):
    """Response wrapper for device list endpoint."""

    devices: list[DeviceSummary] = Field(default_factory=list, description="List of devices")
    total: int = Field(..., description="Total matching devices")
    page: int = Field(default=1, description="Current page")
    page_size: int = Field(default=100, description="Items per page")
