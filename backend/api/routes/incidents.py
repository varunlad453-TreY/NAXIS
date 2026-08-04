"""
Incident API Routes
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status

from shared.database.incidents import resolve_display_names
from shared.database.topology import resolve_node_id as resolve_topology_node_id
from shared.models.incident import Incident, IncidentStatus
from ..models.incident_models import (
    HealthResponse,
    IncidentDetail,
    IncidentListResponse,
    IncidentStats,
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


async def _enrich_summaries(
    incidents: List[Incident],
) -> tuple:
    """
    Resolve operator-facing display names for a page of incidents.

    Walks each incident's primary site (affected_sites[0]) and root-cause
    device (root_device_ids[0]) and resolves them to inventory site names and
    device hostnames in two batched queries.  Falls back to the raw id when a
    name cannot be resolved.
    """
    site_ids = [i.affected_sites[0] for i in incidents if i.affected_sites]
    root_ids = [i.root_device_ids[0] for i in incidents if i.root_device_ids]
    if not site_ids and not root_ids:
        return {}, {}
    site_names, device_names = await resolve_display_names(site_ids, root_ids)
    return site_names, device_names


def _incident_to_summary(
    incident: Incident,
    site_names: Optional[Dict[str, str]] = None,
    root_device_names: Optional[Dict[str, str]] = None,
) -> IncidentSummary:
    site_names = site_names or {}
    root_device_names = root_device_names or {}
    return IncidentSummary(
        incident_id=incident.incident_id,
        title=incident.title,
        severity=incident.severity.value,
        severity_label=incident.severity.label,
        status=incident.status.value,
        site_name=site_names.get(incident.affected_sites[0], "")
        if incident.affected_sites
        else "",
root_device=root_device_names.get(incident.root_device_ids[0], "")
        if incident.root_device_ids
        else "",
        event_count=incident.event_count(),
        affected_sites_count=len(incident.affected_sites),
        affected_devices_count=len(incident.affected_devices),
        root_device_count=len(incident.root_device_ids),
        symptom_device_count=len(incident.symptom_device_ids),
        confidence_score=incident.confidence_score,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


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
        root_device_ids=list(incident.root_device_ids),
        symptom_device_ids=list(incident.symptom_device_ids),
        topology_node_ids=topology_node_ids,
        related_event_ids=list(incident.related_event_ids),
        event_count=incident.event_count(),
        probable_cause=incident.probable_cause,
        confidence_score=incident.confidence_score,
        confidence_breakdown=incident.confidence_breakdown,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


@router.get("", response_model=IncidentListResponse, summary="List incidents")
async def list_incidents(
    severity: List[str] = Query(None, description="Filter by severity"),
    status: List[IncidentStatus] = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> IncidentListResponse:
    try:
        incidents = await incident_service.list_incidents(
            severity_filter=severity,
            status_filter=status,
            limit=limit,
            offset=offset,
        )
        total = await incident_service.count_incidents(
            severity_filter=severity,
            status_filter=status,
        )
        site_names, root_device_names = await _enrich_summaries(incidents)
        summaries = [
            _incident_to_summary(i, site_names, root_device_names) for i in incidents
        ]
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
        site_names, root_device_names = await _enrich_summaries(incidents)
        summaries = [
            _incident_to_summary(i, site_names, root_device_names) for i in incidents
        ]
        return IncidentListResponse(incidents=summaries, total=total, page=1, page_size=limit)
    except Exception as e:
        logger.error(f"Error listing active incidents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/stats",
    response_model=IncidentStats,
    summary="Incident KPIs",
    description=(
        "Truthful incident aggregates computed in SQL — total, active, "
        "by severity, distinct sites/devices, average confidence. Never "
        "derived from a list page length."
    ),
)
async def get_incident_stats() -> IncidentStats:
    try:
        return IncidentStats(**await incident_service.get_stats())
    except Exception as e:
        logger.error(f"Error computing incident stats: {e}", exc_info=True)
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
