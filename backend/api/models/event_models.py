"""
Event API Models

Pydantic response models for event endpoints.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class EventSummary(BaseModel):
    """Lightweight event summary for list views."""

    event_id: str = Field(..., description="Unique event ID")
    timestamp: datetime = Field(..., description="Event timestamp (UTC)")
    source: str = Field(..., description="Vendor source")
    severity: str = Field(..., description="Event severity")
    category: str = Field(..., description="Event category")
    event_type: str = Field(..., description="Specific event type")
    title: str = Field(..., description="Human-readable title")
    description: str = Field(..., description="Detailed description")
    device_id: str = Field(default="", description="Affected device ID")
    device_name: str = Field(default="", description="Affected device name")
    site_id: str = Field(default="", description="Site ID")
    site_name: str = Field(default="", description="Site name")
    incident_id: Optional[str] = Field(None, description="Linked incident ID")


class EventListResponse(BaseModel):
    """Response wrapper for event list endpoint."""

    events: List[EventSummary] = Field(default_factory=list, description="List of events")
    total: int = Field(..., description="Total matching events")
    page: int = Field(default=1, description="Current page")
    page_size: int = Field(default=100, description="Items per page")
