"""
Incident API Routes

REST API endpoints for incident operations.
"""

import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException, Query, status

from backend.api.models.incident_models import (
    HealthResponse,
    IncidentDetail,
    IncidentListResponse,
    IncidentSummary,
)
from backend.shared.models.incident import Incident
from backend.services.incident_service import incident_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/incidents",
    tags=["incidents"],
    responses={
        404: {"description": "Incident not found"},
        500: {"description": "Internal server error"},
    },
)


def _incident_to_summary(incident: Incident) -> IncidentSummary:
    """Convert internal Incident model to API IncidentSummary."""
    return IncidentSummary(
        incident_id=incident.incident_id,
        title=incident.title,
        severity=incident.severity.value,
        status=incident.status.value,
        event_count=incident.event_count(),
        affected_sites_count=len(incident.affected_sites),
        affected_devices_count=len(incident.affected_devices),
        confidence_score=incident.confidence_score,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


def _incident_to_detail(incident: Incident) -> IncidentDetail:
    """Convert internal Incident model to API IncidentDetail."""
    return IncidentDetail(
        incident_id=incident.incident_id,
        title=incident.title,
        severity=incident.severity.value,
        status=incident.status.value,
        affected_sites=list(incident.affected_sites),
        affected_devices=list(incident.affected_devices),
        affected_clients=list(incident.affected_clients),
        related_event_ids=list(incident.related_event_ids),
        event_count=incident.event_count(),
        probable_cause=incident.probable_cause,
        confidence_score=incident.confidence_score,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


@router.get(
    "",
    response_model=IncidentListResponse,
    summary="List incidents",
)
async def list_incidents(
    severity: List[str] = Query(
        None,
        description="Filter by severity (e.g., critical, major)",
    ),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> IncidentListResponse:
    """List all incidents with optional filtering and pagination."""
    try:
        incidents = await incident_service.list_incidents(
            severity_filter=severity, limit=limit, offset=offset
        )
        summaries = [_incident_to_summary(i) for i in incidents]
        total = await incident_service.count_incidents(severity_filter=severity)
        return IncidentListResponse(
            incidents=summaries, total=total, page=1, page_size=limit
        )
    except Exception as e:
        logger.error("Error listing incidents: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list incidents: {e}",
        )


@router.get(
    "/active",
    response_model=IncidentListResponse,
    summary="List active incidents",
)
async def list_active_incidents(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> IncidentListResponse:
    """List incidents that are not yet resolved."""
    try:
        incidents = await incident_service.get_active_incidents()
        total = len(incidents)
        incidents = incidents[offset : offset + limit]
        summaries = [_incident_to_summary(i) for i in incidents]
        return IncidentListResponse(
            incidents=summaries, total=total, page=1, page_size=limit
        )
    except Exception as e:
        logger.error("Error listing active incidents: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list active incidents: {e}",
        )


@router.get(
    "/{incident_id}",
    response_model=IncidentDetail,
    summary="Get incident by ID",
)
async def get_incident(incident_id: str) -> IncidentDetail:
    """Retrieve detailed information for a single incident."""
    try:
        incident = await incident_service.get_incident(incident_id)
        if not incident:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Incident not found: {incident_id}",
            )
        return _incident_to_detail(incident)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error retrieving incident %s: %s", incident_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve incident: {e}",
        )


# Health check router (no prefix)
health_router = APIRouter(tags=["health"])


@health_router.get("/health", response_model=HealthResponse, summary="API health check")
async def health_check() -> HealthResponse:
    """Check if the API is healthy and responsive."""
    return HealthResponse(
        status="healthy", version="1.0.0", timestamp=datetime.utcnow()
    )
