"""
Location Data Models (WP-5)

Pydantic schemas for physical location hierarchy, vendor site mapping, and floorplan AP placement.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class LocationCreate(BaseModel):
    """Payload for creating or updating a location node."""
    location_id: str = Field(..., description="Canonical location identifier")
    name: str = Field(..., description="Human-readable location name")
    type: str = Field(..., description="Type: 'region' | 'site' | 'building' | 'floor' | 'zone'")
    parent_id: Optional[str] = Field(None, description="Parent location ID for hierarchy")
    latitude: Optional[float] = Field(None, description="GPS Latitude")
    longitude: Optional[float] = Field(None, description="GPS Longitude")
    address: Optional[str] = Field(None, description="Physical street address")
    floorplan_image_url: Optional[str] = Field(None, description="URL or path to floorplan image asset")
    floor_number: Optional[int] = Field(None, description="Floor index number")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Custom metadata attributes")


class LocationMappingCreate(BaseModel):
    """Payload for mapping vendor site IDs to canonical locations."""
    location_id: str = Field(..., description="Target Naxis canonical location ID")
    vendor: str = Field(..., description="Vendor identifier (mist, dnac, velocloud, etc.)")
    vendor_site_id: str = Field(..., description="Vendor internal site ID")
    vendor_map_id: Optional[str] = Field(None, description="Vendor internal map ID")


class APPlacement(BaseModel):
    """Represents a wireless AP positioned on a floorplan canvas."""
    device_id: str = Field(..., description="Device canonical UUID")
    name: str = Field(..., description="AP display name")
    mac_address: Optional[str] = Field(None, description="AP MAC address")
    ip_address: Optional[str] = Field(None, description="AP IP address")
    vendor: str = Field(..., description="Vendor name")
    x_pct: float = Field(..., description="X position as percentage of canvas width (0.0 to 100.0)")
    y_pct: float = Field(..., description="Y position as percentage of canvas height (0.0 to 100.0)")
    health_status: str = Field("healthy", description="Health: 'healthy' | 'degraded' | 'critical'")
    health_reason: Optional[str] = Field(None, description="Diagnostic issue reason if degraded or critical")
    client_count: int = Field(0, description="Connected client count")
    channel: Optional[int] = Field(None, description="Operating Wi-Fi channel")
    rssi: Optional[int] = Field(None, description="Average RSSI")


class FloorplanResponse(BaseModel):
    """Floorplan details and AP overlays for NOC drill-down."""
    location_id: str = Field(..., description="Floor location ID")
    name: str = Field(..., description="Floor name")
    building_name: str = Field(..., description="Parent building name")
    floor_number: Optional[int] = Field(None, description="Floor number index")
    floorplan_image_url: Optional[str] = Field(None, description="Floorplan image URL")
    ap_placements: List[APPlacement] = Field(default_factory=list, description="Array of positioned AP markers")
    health_status: str = Field("healthy", description="Aggregated floor health status")


class LocationNode(BaseModel):
    """Recursive location tree node."""
    location_id: str = Field(..., description="Location ID")
    name: str = Field(..., description="Name")
    type: str = Field(..., description="Type")
    parent_id: Optional[str] = Field(None, description="Parent ID")
    latitude: Optional[float] = Field(None, description="Latitude")
    longitude: Optional[float] = Field(None, description="Longitude")
    health_status: str = Field("healthy", description="Aggregated health status")
    device_count: int = Field(0, description="Total assigned devices")
    children: List["LocationNode"] = Field(default_factory=list, description="Child locations")


LocationNode.model_rebuild()
