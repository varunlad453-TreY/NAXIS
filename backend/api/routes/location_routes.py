"""
Locations API Routes (WP-5)

Provides endpoints for querying authoritative location hierarchies, site floorplans,
and vendor site mappings.
"""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

try:
    from backend.api.models.location_models import (
        FloorplanResponse,
        LocationCreate,
        LocationMappingCreate,
        LocationNode,
    )
    from backend.api.services.location_service import location_service
    from backend.shared.auth.dependencies import require_role
    from backend.shared.auth.keycloak import UserPrincipal
    from backend.shared.database.locations_db import (
        create_location,
        create_location_mapping,
        get_location,
    )
except ImportError:
    from api.models.location_models import (
        FloorplanResponse,
        LocationCreate,
        LocationMappingCreate,
        LocationNode,
    )
    from api.services.location_service import location_service
    from shared.auth.dependencies import require_role
    from shared.auth.keycloak import UserPrincipal
    from shared.database.locations_db import (
        create_location,
        create_location_mapping,
        get_location,
    )

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get(
    "/tree",
    response_model=List[LocationNode],
    summary="Get global location hierarchy tree",
    description="Returns nested region -> site -> building -> floor -> zone tree with aggregated health scores.",
)
async def get_location_tree() -> List[LocationNode]:
    try:
        return await location_service.get_location_tree()
    except Exception as exc:
        logger.error(f"Error fetching location tree: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch location hierarchy tree")


@router.get(
    "/{location_id}",
    response_model=Dict[str, Any],
    summary="Get location details",
)
async def get_location_by_id(location_id: str) -> Dict[str, Any]:
    loc = await get_location(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail=f"Location '{location_id}' not found")
    return loc


@router.get(
    "/{location_id}/floorplan",
    response_model=FloorplanResponse,
    summary="Get interactive floorplan canvas and AP placements",
    description="Returns floorplan background image and AP markers normalized as percentage coordinates (x_pct, y_pct).",
)
async def get_location_floorplan(location_id: str) -> FloorplanResponse:
    try:
        return await location_service.get_floorplan_details(location_id)
    except Exception as exc:
        logger.error(f"Error fetching floorplan for {location_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch floorplan details")


@router.post(
    "",
    summary="Create or update physical location (Admin only)",
    description="Registers a region, site, building, floor, or zone in Naxis's authoritative location registry.",
)
async def create_new_location(
    payload: LocationCreate,
    user: UserPrincipal = Depends(require_role(["admin"])),
) -> Dict[str, Any]:
    success = await create_location(
        location_id=payload.location_id,
        name=payload.name,
        location_type=payload.type,
        parent_id=payload.parent_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        address=payload.address,
        floorplan_image_url=payload.floorplan_image_url,
        floor_number=payload.floor_number,
        metadata=payload.metadata,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to create/update location record")

    return {"status": "success", "location_id": payload.location_id}


@router.post(
    "/mappings",
    summary="Map vendor site/map ID to Naxis canonical location (Admin only)",
)
async def create_vendor_mapping(
    payload: LocationMappingCreate,
    user: UserPrincipal = Depends(require_role(["admin"])),
) -> Dict[str, Any]:
    success = await create_location_mapping(
        location_id=payload.location_id,
        vendor=payload.vendor,
        vendor_site_id=payload.vendor_site_id,
        vendor_map_id=payload.vendor_map_id,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to bind vendor site mapping")

    return {"status": "success", "vendor_site_id": payload.vendor_site_id, "location_id": payload.location_id}
