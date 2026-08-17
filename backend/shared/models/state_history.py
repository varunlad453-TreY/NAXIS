"""
State History Models (WP-2.5)

Represents permanent, diff-on-write state transition records for devices and topology links.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class DeviceStateTransition(BaseModel):
    """A recorded device state transition."""

    history_id: Optional[int] = Field(None, description="Primary key history ID")
    device_key: str = Field(..., description="Canonical device key or ID")
    site_key: Optional[str] = Field(None, description="Site key or ID")
    previous_state: Optional[str] = Field(None, description="Previous state before transition")
    new_state: str = Field(..., description="New state after transition")
    duration_seconds: Optional[float] = Field(None, description="Duration in seconds of the previous state")
    transition_reason: Optional[str] = Field(None, description="Reason / triggering event type")
    event_id: Optional[str] = Field(None, description="ID of triggering event")
    recorded_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of transition")


class LinkStateTransition(BaseModel):
    """A recorded topology link state transition."""

    history_id: Optional[int] = Field(None, description="Primary key history ID")
    link_key: str = Field(..., description="Canonical link key (parent->child)")
    parent_node_id: str = Field(..., description="Parent node ID")
    child_node_id: str = Field(..., description="Child node ID")
    previous_state: Optional[str] = Field(None, description="Previous state before transition")
    new_state: str = Field(..., description="New state after transition")
    duration_seconds: Optional[float] = Field(None, description="Duration in seconds of the previous state")
    transition_reason: Optional[str] = Field(None, description="Reason / triggering event type")
    event_id: Optional[str] = Field(None, description="ID of triggering event")
    recorded_at: datetime = Field(default_factory=datetime.utcnow, description="Timestamp of transition")


class StateHistoryQuery(BaseModel):
    """Query parameters for fetching state history."""

    key: str = Field(..., description="Device or link key")
    limit: int = Field(100, ge=1, le=1000)
    offset: int = Field(0, ge=0)
