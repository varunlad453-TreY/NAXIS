"""
Device API Routes

REST endpoints for querying the network device inventory.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Query, status
from fastapi.exceptions import HTTPException

from backend.api.models.device_models import DeviceListResponse, DeviceSummary
from backend.services.device_service import device_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/devices",
    tags=["devices"],
    responses={500: {"description": "Internal server error"}},
)


def _row_to_summary(row: dict) -> DeviceSummary:
    """Convert a raw device row to an API summary model."""
    return DeviceSummary(
        device_id=row.get("device_id", ""),
        platform=row.get("platform", ""),
        hostname=row.get("hostname") or row.get("name", ""),
        ip_address=row.get("ip_address", ""),
        device_type=row.get("device_type", ""),
        site_id=row.get("site_id", ""),
        site_name=row.get("site_name", ""),
        reachability=row.get("reachability", "unknown"),
        management_state=row.get("management_state", "unknown"),
        last_seen=row.get("last_seen"),
    )


@router.get(
    "",
    response_model=DeviceListResponse,
    summary="List devices",
)
async def list_devices(
    platform: Optional[str] = Query(None, description="Filter by vendor platform"),
    site_id: Optional[str] = Query(None, description="Filter by site ID"),
    reachability: Optional[str] = Query(None, description="Filter by reachability status"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> DeviceListResponse:
    """List devices with filtering and pagination."""
    try:
        rows, total = await device_service.list_devices(
            platform=platform,
            site_id=site_id,
            reachability=reachability,
            limit=limit,
            offset=offset,
        )
        summaries = [_row_to_summary(r) for r in rows]
        return DeviceListResponse(
            devices=summaries, total=total, page=1, page_size=limit
        )
    except Exception as exc:
        logger.error("Error listing devices: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list devices: {exc}",
        )
