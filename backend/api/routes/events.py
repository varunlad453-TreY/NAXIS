"""
Event API Routes

REST endpoints for querying normalized network events.
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Query, status
from fastapi.exceptions import HTTPException

from backend.api.models.event_models import EventListResponse, EventSummary
from backend.services.event_service import event_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/events",
    tags=["events"],
    responses={500: {"description": "Internal server error"}},
)


def _row_to_summary(row: dict) -> EventSummary:
    """Convert a raw event row to an API summary model."""
    return EventSummary(
        event_id=row.get("event_id", ""),
        timestamp=row.get("timestamp"),
        source=row.get("source", ""),
        severity=row.get("severity", ""),
        category=row.get("category", ""),
        event_type=row.get("event_type", ""),
        title=row.get("title", ""),
        description=row.get("description", ""),
        device_id=row.get("device_id", ""),
        device_name=row.get("device_name", ""),
        site_id=row.get("site_id", ""),
        site_name=row.get("site_name", ""),
        incident_id=row.get("incident_id", "") or None,
    )


@router.get(
    "",
    response_model=EventListResponse,
    summary="List events",
)
async def list_events(
    source: Optional[str] = Query(None, description="Filter by vendor source"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    site_id: Optional[str] = Query(None, description="Filter by site ID"),
    device_id: Optional[str] = Query(None, description="Filter by device ID"),
    incident_id: Optional[str] = Query(None, description="Filter by linked incident ID"),
    start_time: Optional[datetime] = Query(None, description="Filter by timestamp >="),
    end_time: Optional[datetime] = Query(None, description="Filter by timestamp <="),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> EventListResponse:
    """List events with filtering and pagination."""
    try:
        rows, total = await event_service.list_events(
            source=source,
            severity=severity,
            site_id=site_id,
            device_id=device_id,
            incident_id=incident_id,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
        )
        summaries = [_row_to_summary(r) for r in rows]
        return EventListResponse(
            events=summaries, total=total, page=1, page_size=limit
        )
    except Exception as exc:
        logger.error("Error listing events: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list events: {exc}",
        )
