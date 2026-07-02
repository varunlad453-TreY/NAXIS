"""
Event API Routes

REST endpoints for querying normalized network events.
Reads directly from the events table via the asyncpg pool.
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Query, status
from fastapi.exceptions import HTTPException

from api.models.event_models import EventListResponse, EventSummary
from shared.database.client import db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/events",
    tags=["events"],
    responses={500: {"description": "Internal server error"}},
)


def _row_to_summary(row) -> EventSummary:
    return EventSummary(
        event_id=row["event_id"],
        timestamp=row["timestamp"],
        source=row["source"],
        severity=row["severity"],
        category=row["category"],
        event_type=row["event_type"],
        title=row["title"],
        description=row["description"] or "",
        device_id=row["device_id"] or "",
        device_name=row["device_name"] or "",
        site_id=row["site_id"] or "",
        site_name=row["site_name"] or "",
        incident_id=row["incident_id"] or None,
    )


@router.get("", response_model=EventListResponse, summary="List events")
async def list_events(
    source: Optional[str] = Query(None, description="Filter by vendor source"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    site_id: Optional[str] = Query(None, description="Filter by site ID"),
    device_id: Optional[str] = Query(None, description="Filter by device ID"),
    incident_id: Optional[str] = Query(None, description="Filter by linked incident ID"),
    start_time: Optional[datetime] = Query(None, description="Filter by timestamp >="),
    end_time: Optional[datetime] = Query(None, description="Filter by timestamp <="),
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
) -> EventListResponse:
    try:
        conditions = []
        params: List = []

        if source:
            params.append(source)
            conditions.append(f"source = ${len(params)}")
        if severity:
            params.append(severity)
            conditions.append(f"severity = ${len(params)}")
        if site_id:
            params.append(site_id)
            conditions.append(f"site_id = ${len(params)}")
        if device_id:
            params.append(device_id)
            conditions.append(f"device_id = ${len(params)}")
        if incident_id:
            params.append(incident_id)
            conditions.append(f"incident_id = ${len(params)}")
        if start_time:
            params.append(start_time)
            conditions.append(f"timestamp >= ${len(params)}")
        if end_time:
            params.append(end_time)
            conditions.append(f"timestamp <= ${len(params)}")

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        count_row = await db.fetchrow(
            f"SELECT COUNT(*) AS total FROM events {where}", *params
        )
        total = int(count_row["total"]) if count_row else 0

        data_params = params + [limit, offset]
        rows = await db.fetch(
            f"SELECT * FROM events {where} ORDER BY timestamp DESC "
            f"LIMIT ${len(data_params) - 1} OFFSET ${len(data_params)}",
            *data_params,
        )

        return EventListResponse(
            events=[_row_to_summary(r) for r in rows],
            total=total,
            page=1,
            page_size=limit,
        )
    except Exception as exc:
        logger.error("Error listing events: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
