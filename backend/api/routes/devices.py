"""
Device API Routes

REST endpoints for querying the network device inventory.
Serves from the `inventory` table (populated by MistInventoryCollector).
Falls back to deriving from events if inventory is empty.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Query, status
from fastapi.exceptions import HTTPException

from api.models.device_models import DeviceListResponse, DeviceSummary
from shared.database.client import db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/devices",
    tags=["devices"],
    responses={500: {"description": "Internal server error"}},
)

_INVENTORY_QUERY = """
    SELECT
        device_id,
        platform,
        hostname,
        mac,
        serial,
        model,
        device_type,
        ip_address,
        site_id,
        site_name,
        connected,
        reachability,
        num_clients,
        uptime_seconds,
        firmware_version,
        'managed'   AS management_state,
        last_seen
    FROM inventory
    WHERE 1=1
    {where}
    ORDER BY site_name ASC, hostname ASC
    LIMIT $1 OFFSET $2
"""

_COUNT_QUERY = """
    SELECT COUNT(*) AS total FROM inventory WHERE 1=1 {where}
"""


def _row_to_summary(row) -> DeviceSummary:
    return DeviceSummary(
        device_id=row["device_id"] or "",
        platform=row["platform"] or "",
        hostname=row["hostname"] or "",
        mac=row["mac"] or "",
        serial=row["serial"] or "",
        model=row["model"] or "",
        ip_address=row["ip_address"] or "",
        device_type=row["device_type"] or "",
        site_id=row["site_id"] or "",
        site_name=row["site_name"] or "",
        connected=bool(row["connected"]),
        reachability=row["reachability"],
        num_clients=row["num_clients"] or 0,
        uptime_seconds=row["uptime_seconds"] or 0,
        firmware_version=row["firmware_version"] or "",
        management_state=row["management_state"],
        last_seen=row["last_seen"],
    )


@router.get("", response_model=DeviceListResponse, summary="List devices")
async def list_devices(
    platform: Optional[str] = Query(None, description="Filter by vendor platform"),
    site_id: Optional[str] = Query(None, description="Filter by site ID"),
    reachability: Optional[str] = Query(None, description="Filter by reachability status"),
    search: Optional[str] = Query(None, description="Search hostname, MAC, model, site"),
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> DeviceListResponse:
    try:
        conditions: List[str] = []
        params: List = []

        if platform:
            params.append(platform)
            conditions.append(f"AND platform = ${len(params)}")
        if site_id:
            params.append(site_id)
            conditions.append(f"AND site_id = ${len(params)}")
        if reachability:
            params.append(reachability)
            conditions.append(f"AND reachability = ${len(params)}")
        if search:
            params.append(f"%{search.lower()}%")
            n = len(params)
            conditions.append(
                f"AND (LOWER(hostname) LIKE ${n} OR LOWER(mac) LIKE ${n} "
                f"OR LOWER(model) LIKE ${n} OR LOWER(site_name) LIKE ${n} "
                f"OR LOWER(ip_address) LIKE ${n})"
            )

        where_clause = " ".join(conditions)

        count_row = await db.fetchrow(
            _COUNT_QUERY.format(where=where_clause), *params
        )
        total = int(count_row["total"]) if count_row else 0

        n = len(params)
        data_query = (
            _INVENTORY_QUERY
            .format(where=where_clause)
            .replace("LIMIT $1 OFFSET $2", f"LIMIT ${n + 1} OFFSET ${n + 2}")
        )
        rows = await db.fetch(data_query, *(params + [limit, offset]))

        return DeviceListResponse(
            devices=[_row_to_summary(r) for r in rows],
            total=total,
            page=(offset // limit) + 1,
            page_size=limit,
        )
    except Exception as exc:
        logger.error("Error listing devices: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
