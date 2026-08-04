"""
Incident API Models

Pydantic models for incident API responses.
These are optimized for API serialization (vs. internal Incident model).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class IncidentSummary(BaseModel):
    """
    Lightweight incident summary for list views.

    Used by GET /incidents endpoint.
    """

    incident_id: str = Field(..., description="Unique incident ID")
    title: str = Field(..., description="Human-readable incident title")
    severity: str = Field(..., description="Incident severity (critical, major, minor, etc.)")
    severity_label: str = Field(..., description="Operator-friendly severity display name")
    status: str = Field(..., description="Lifecycle status (open, investigating, resolved, etc.)")
    site_name: str = Field(default="", description="Resolved display name of the primary affected site")
    root_device: str = Field(default="", description="Resolved display name of the root-cause device")
    event_count: int = Field(..., description="Number of related events")
    affected_sites_count: int = Field(..., description="Number of affected sites")
    affected_devices_count: int = Field(..., description="Number of affected devices")
    root_device_count: int = Field(default=0, description="Number of root-cause devices (cascade incidents)")
    symptom_device_count: int = Field(default=0, description="Number of symptom devices (cascade incidents)")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="RCA confidence score")
    created_at: datetime = Field(..., description="Incident creation time (UTC)")
    updated_at: datetime = Field(..., description="Last update time (UTC)")

    class Config:
        json_schema_extra = {
            "example": {
                "incident_id": "inc-abc123def456",
                "title": "SFO-01 · edge-sfo-01 link down — 2 devices affected",
                "severity": "critical",
                "status": "open",
                "event_count": 5,
                "affected_sites_count": 1,
                "affected_devices_count": 3,
                "confidence_score": 0.82,
                "created_at": "2026-05-28T10:30:00",
                "updated_at": "2026-05-28T10:35:00",
            }
        }


class IncidentDetail(BaseModel):
    """
    Complete incident detail for single-incident views.

    Used by GET /incidents/{id} endpoint.
    """

    incident_id: str = Field(..., description="Unique incident ID")
    title: str = Field(..., description="Human-readable incident title")
    severity: str = Field(..., description="Incident severity")
    severity_label: str = Field(..., description="Operator-friendly severity display name")
    status: str = Field(..., description="Lifecycle status")

    # Blast radius
    affected_sites: List[str] = Field(default_factory=list, description="Affected site IDs")
    affected_devices: List[str] = Field(default_factory=list, description="Affected device IDs")
    affected_clients: List[str] = Field(default_factory=list, description="Affected client IDs")
    topology_node_ids: List[str] = Field(default_factory=list, description="Resolved topology node IDs for affected devices")

    # Correlation reasoning — root cause vs symptom split
    root_device_ids: List[str] = Field(
        default_factory=list,
        description="Infrastructure device IDs identified as root cause(s)",
    )
    symptom_device_ids: List[str] = Field(
        default_factory=list,
        description="Leaf device IDs that failed as downstream consequences",
    )

    # Related events
    related_event_ids: List[str] = Field(default_factory=list, description="Related event IDs")
    event_count: int = Field(..., description="Number of related events")

    # RCA enrichment
    probable_cause: Optional[str] = Field(None, description="AI-generated probable cause")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="RCA confidence score")
    confidence_breakdown: Optional[Dict[str, Any]] = Field(
        None,
        description="Factor breakdown: {event_score, avg_severity, device_score, total}",
    )

    # Timestamps
    created_at: datetime = Field(..., description="Creation time (UTC)")
    updated_at: datetime = Field(..., description="Last update time (UTC)")

    class Config:
        json_schema_extra = {
            "example": {
                "incident_id": "inc-abc123def456",
                "title": "SFO-01 · edge-sfo-01 link down — 2 devices affected",
                "severity": "critical",
                "status": "investigating",
                "affected_sites": ["site-sfo-01"],
                "affected_devices": ["dev-001", "dev-002", "dev-003"],
                "affected_clients": [],
                "root_device_ids": ["core-switch-sfo-01"],
                "symptom_device_ids": ["ap-sfo-101", "ap-sfo-102"],
                "related_event_ids": ["evt-001", "evt-002", "evt-003", "evt-004", "evt-005"],
                "event_count": 5,
                "probable_cause": "ISP BGP flap on primary uplink",
                "confidence_score": 0.82,
                "confidence_breakdown": {"event_score": 0.6826, "avg_severity": 0.76, "device_score": 0.6, "total": 0.725},
                "created_at": "2026-05-28T10:30:00",
                "updated_at": "2026-05-28T10:35:00",
            }
        }


class IncidentListResponse(BaseModel):
    """
    Response wrapper for incident list endpoint.

    Includes metadata for pagination (future) and result counts.
    """

    incidents: List[IncidentSummary] = Field(
        default_factory=list, description="List of incident summaries"
    )
    total: int = Field(..., description="Total number of incidents")
    page: int = Field(default=1, description="Current page (for future pagination)")
    page_size: int = Field(default=100, description="Items per page")

    class Config:
        json_schema_extra = {
            "example": {
                "incidents": [
                    {
                        "incident_id": "inc-abc123",
                        "title": "SFO-01 · edge-sfo-01 link down — 2 devices affected",
                        "severity": "critical",
                        "status": "open",
                        "event_count": 5,
                        "affected_sites_count": 1,
                        "affected_devices_count": 3,
                        "confidence_score": 0.82,
                        "created_at": "2026-05-28T10:30:00",
                        "updated_at": "2026-05-28T10:35:00",
                    }
                ],
                "total": 1,
                "page": 1,
                "page_size": 100,
            }
        }


class IncidentStats(BaseModel):
    """
    Truthful incident KPIs computed as SQL aggregates — never page-length.

    Used by GET /incidents/stats endpoint.
    """

    total: int = Field(..., description="Total number of incidents")
    active: int = Field(..., description="Incidents in an actionable state (open/investigating/mitigated)")
    by_severity: Dict[str, int] = Field(
        ...,
        description="Incident counts per severity (all five severities, zero-filled)",
    )
    distinct_sites: int = Field(..., description="Distinct site IDs across all incidents")
    distinct_devices: int = Field(..., description="Distinct device IDs across all incidents")
    avg_confidence: float = Field(..., ge=0.0, le=1.0, description="Mean confidence score (0.0 when empty)")

    class Config:
        json_schema_extra = {
            "example": {
                "total": 42,
                "active": 7,
                "by_severity": {"critical": 2, "major": 4, "minor": 8, "warning": 0, "info": 28},
                "distinct_sites": 3,
                "distinct_devices": 15,
                "avg_confidence": 0.62,
            }
        }


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="API health status")
    version: str = Field(..., description="API version")
    timestamp: datetime = Field(..., description="Current server time (UTC)")

    class Config:
        json_schema_extra = {
            "example": {
                "status": "healthy",
                "version": "1.0.0",
                "timestamp": "2026-05-28T10:30:00",
            }
        }
