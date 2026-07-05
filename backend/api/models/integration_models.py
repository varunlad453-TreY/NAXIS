"""
Integration API response models.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

IntegrationStatus = Literal["connected", "disconnected", "not_configured", "testing", "error"]
CollectorOperationalStatus = Literal["active", "working", "inactive", "not_configured"]


class IntegrationCollectorSummary(BaseModel):
    id: str
    label: str
    status: IntegrationStatus
    operational_status: CollectorOperationalStatus = "not_configured"
    last_sync: Optional[datetime] = None
    health_score: Optional[int] = None
    message: Optional[str] = None
    collects: List[str] = Field(default_factory=list)
    purpose: Optional[str] = None
    output: Optional[str] = None
    why_it_matters: Optional[str] = None


class IntegrationConfigItem(BaseModel):
    label: str
    value: str
    masked: bool = False


class IntegrationConfigGroup(BaseModel):
    title: str
    items: List[IntegrationConfigItem] = Field(default_factory=list)


class IntegrationConfigResponse(BaseModel):
    integration_id: str
    status: IntegrationStatus
    configured: bool
    coming_soon: bool = False
    validation_message: Optional[str] = None
    last_tested_at: Optional[datetime] = None
    recent_errors: List[str] = Field(default_factory=list)
    groups: List[IntegrationConfigGroup] = Field(default_factory=list)
    collectors: List[IntegrationCollectorSummary] = Field(default_factory=list)


class IntegrationSummary(BaseModel):
    id: str
    name: str
    vendor: str
    description: str
    icon: str
    status: IntegrationStatus
    configured: bool = False
    coming_soon: bool = False
    last_sync: Optional[datetime] = None
    health_score: Optional[int] = None
    events_collected: int = 0
    errors: List[str] = Field(default_factory=list)
    collectors: List[IntegrationCollectorSummary] = Field(default_factory=list)


class IntegrationDetailResponse(IntegrationSummary):
    config: IntegrationConfigResponse


class IntegrationListResponse(BaseModel):
    integrations: List[IntegrationSummary]
    total: int
    connected: int
    disconnected: int
    not_configured: int
    average_health: Optional[float] = None
    total_events_collected: int = 0


class IntegrationActionResponse(BaseModel):
    success: bool
    message: str
    integration: IntegrationSummary