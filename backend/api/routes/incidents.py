"""
Incident API Routes

REST API endpoints for incident operations.

Endpoints:
  - GET /health                 - API health check
  - GET /incidents              - List all incidents
  - GET /incidents/active       - List active incidents
  - GET /incidents/{id}         - Get incident by ID
"""

import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException, Query, status

try:
    from ...shared.models.incident import Incident
    from ..models.incident_models import (
        HealthResponse,
        IncidentDetail,
        IncidentListResponse,
        IncidentSummary,
    )
    from ..services.incident_service import incident_service
except (ImportError, ValueError):
    # Fallback for direct execution
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from shared.models.incident import Incident
    from api.models.incident_models import (
        HealthResponse,
        IncidentDetail,
        IncidentListResponse,
        IncidentSummary,
    )
    from api.services.incident_service import incident_service

logger = logging.getLogger(__name__)

# Create router
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
    description="Retrieve all incidents with optional filters",
)
async def list_incidents(
    severity: List[str] = Query(
        None,
        description="Filter by severity (e.g., critical, major)",
        example=["critical", "major"],
    ),
    limit: int = Query(100, ge=1, le=1000, description="Max results to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> IncidentListResponse:
    """
    List all incidents with optional filtering.

    Query parameters:
      - severity: Filter by severity (can specify multiple)
      - limit: Max results (default 100, max 1000)
      - offset: Pagination offset (default 0)

    Returns list of incident summaries sorted by created_at descending.
    """
    try:
        # Fetch incidents
        incidents = incident_service.list_incidents(
            severity_filter=severity, limit=limit, offset=offset
        )

        # Convert to API models
        summaries = [_incident_to_summary(i) for i in incidents]

        # Get total count
        total = incident_service.count_incidents(severity_filter=severity)

        logger.info(
            f"Listed {len(summaries)} incidents (total={total}, severity={severity})"
        )

        return IncidentListResponse(
            incidents=summaries, total=total, page=1, page_size=limit
        )

    except Exception as e:
        logger.error(f"Error listing incidents: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list incidents: {str(e)}",
        )


@router.get(
    "/active",
    response_model=IncidentListResponse,
    summary="List active incidents",
    description="Retrieve incidents that are not yet resolved (OPEN, INVESTIGATING, MITIGATED)",
)
async def list_active_incidents(
    limit: int = Query(100, ge=1, le=1000, description="Max results to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> IncidentListResponse:
    """
    List active incidents only.

    Returns incidents with status: OPEN, INVESTIGATING, or MITIGATED.
    Excludes RESOLVED, CLOSED, and SUPPRESSED incidents.

    Sorted by created_at descending (most recent first).
    """
    try:
        # Fetch active incidents
        incidents = incident_service.get_active_incidents()

        # Apply pagination manually (service already filters by status)
        total = len(incidents)
        incidents = incidents[offset : offset + limit]

        # Convert to API models
        summaries = [_incident_to_summary(i) for i in incidents]

        logger.info(f"Listed {len(summaries)} active incidents (total={total})")

        return IncidentListResponse(
            incidents=summaries, total=total, page=1, page_size=limit
        )

    except Exception as e:
        logger.error(f"Error listing active incidents: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list active incidents: {str(e)}",
        )


@router.get(
    "/{incident_id}",
    response_model=IncidentDetail,
    summary="Get incident by ID",
    description="Retrieve detailed information for a single incident",
    responses={
        200: {"description": "Incident found"},
        404: {"description": "Incident not found"},
    },
)
async def get_incident(incident_id: str) -> IncidentDetail:
    """
    Get detailed incident information by ID.

    Returns complete incident details including:
      - All affected entities (sites, devices, clients)
      - Related event IDs
      - RCA probable cause (if enriched)
      - Confidence score
      - Timestamps

    Returns 404 if incident not found.
    """
    try:
        # Fetch incident
        incident = incident_service.get_incident(incident_id)

        if not incident:
            logger.warning(f"Incident not found: {incident_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Incident not found: {incident_id}",
            )

        # Convert to API model
        detail = _incident_to_detail(incident)

        logger.info(f"Retrieved incident: {incident_id}")
        return detail

    except HTTPException:
        # Re-raise HTTP exceptions (like 404)
        raise
    except Exception as e:
        logger.error(f"Error retrieving incident {incident_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve incident: {str(e)}",
        )


# Health check endpoint (no prefix, goes at root)
health_router = APIRouter(tags=["health"])


@health_router.get(
    "/health",
    response_model=HealthResponse,
    summary="API health check",
    description="Check if the API is healthy and responsive",
)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns API status, version, and current timestamp.
    Always returns 200 OK if the API is running.
    """
    return HealthResponse(
        status="healthy", version="1.0.0", timestamp=datetime.utcnow()
    )
