"""
Incident API Routes
"""

import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException, Query, status

from shared.database.topology import resolve_node_id as resolve_topology_node_id
from shared.models.incident import Incident
from ..models.incident_models import (
    HealthResponse,
    IncidentDetail,
    IncidentListResponse,
    IncidentSummary,
)
from ..services.incident_service import incident_service

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
    return IncidentSummary(
        incident_id=incident.incident_id,
        title=incident.title,
        severity=incident.severity.value,
        severity_label=incident.severity.label,
        status=incident.status.value,
        event_count=incident.event_count(),
        affected_sites_count=len(incident.affected_sites),
        affected_devices_count=len(incident.affected_devices),
        confidence_score=incident.confidence_score,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


async def _resolve_affected_device_ids(device_ids: List[str]) -> List[str]:
    """Resolve incident device_ids to topology node_ids."""
    if not device_ids:
        return []
    resolved: List[str] = []
    for did in device_ids:
        nid = await resolve_topology_node_id(did)
        if nid:
            resolved.append(nid)
    if not resolved:
        # Fallback: use device_ids as node_ids
        resolved = list(device_ids)
    return resolved


async def _incident_to_detail(incident: Incident) -> IncidentDetail:
    topology_node_ids = await _resolve_affected_device_ids(list(incident.affected_devices))
    return IncidentDetail(
        incident_id=incident.incident_id,
        title=incident.title,
        severity=incident.severity.value,
        severity_label=incident.severity.label,
        status=incident.status.value,
        affected_sites=list(incident.affected_sites),
        affected_devices=list(incident.affected_devices),
        affected_clients=list(incident.affected_clients),
        topology_node_ids=topology_node_ids,
        related_event_ids=list(incident.related_event_ids),
        event_count=incident.event_count(),
        probable_cause=incident.probable_cause,
        confidence_score=incident.confidence_score,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


@router.get("", response_model=IncidentListResponse, summary="List incidents")
async def list_incidents(
    severity: List[str] = Query(None, description="Filter by severity"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> IncidentListResponse:
    try:
        incidents = await incident_service.list_incidents(
            severity_filter=severity, limit=limit, offset=offset
        )
        total = await incident_service.count_incidents(severity_filter=severity)
        summaries = [_incident_to_summary(i) for i in incidents]
        return IncidentListResponse(incidents=summaries, total=total, page=1, page_size=limit)
    except Exception as e:
        logger.error(f"Error listing incidents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/active", response_model=IncidentListResponse, summary="List active incidents")
async def list_active_incidents(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> IncidentListResponse:
    try:
        incidents = await incident_service.get_active_incidents(limit=limit, offset=offset)
        total = len(incidents)
        summaries = [_incident_to_summary(i) for i in incidents]
        return IncidentListResponse(incidents=summaries, total=total, page=1, page_size=limit)
    except Exception as e:
        logger.error(f"Error listing active incidents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{incident_id}", response_model=IncidentDetail, summary="Get incident by ID")
async def get_incident(incident_id: str) -> IncidentDetail:
    try:
        incident = await incident_service.get_incident(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail=f"Incident not found: {incident_id}")
        return await _incident_to_detail(incident)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving incident {incident_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


health_router = APIRouter(tags=["health"])


@health_router.get("/health", response_model=HealthResponse, summary="API health check")
async def health_check() -> HealthResponse:
    return HealthResponse(status="healthy", version="1.0.0", timestamp=datetime.utcnow())
