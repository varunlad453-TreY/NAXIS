"""
Locations Database Helper (WP-5)

Provides async database helper functions to persist, query, and map physical locations,
facilities, floorplans, and vendor site mappings in PostgreSQL.
"""

import json
import logging
from typing import Any, Dict, List, Optional

try:
    from backend.shared.database.client import db
except ImportError:
    from shared.database.client import db

logger = logging.getLogger(__name__)


async def create_location(
    location_id: str,
    name: str,
    location_type: str,
    parent_id: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    address: Optional[str] = None,
    floorplan_image_url: Optional[str] = None,
    floor_number: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> bool:
    """Inserts or updates a location record in PostgreSQL."""
    if metadata is None:
        metadata = {}

    query = """
        INSERT INTO locations (
            location_id, parent_id, name, type, latitude, longitude,
            address, floorplan_image_url, floor_number, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        ON CONFLICT (location_id) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            address = EXCLUDED.address,
            floorplan_image_url = EXCLUDED.floorplan_image_url,
            floor_number = EXCLUDED.floor_number,
            metadata = EXCLUDED.metadata;
    """

    try:
        res = await db.execute(
            query,
            location_id,
            parent_id,
            name,
            location_type,
            latitude,
            longitude,
            address,
            floorplan_image_url,
            floor_number,
            json.dumps(metadata),
        )
        return "INSERT" in res or "UPDATE" in res
    except Exception as exc:
        logger.exception("Failed to create/update location %s: %s", location_id, exc)
        return False


async def get_location(location_id: str) -> Optional[Dict[str, Any]]:
    """Fetches location details by ID."""
    query = """
        SELECT location_id, parent_id, name, type, latitude, longitude,
               address, floorplan_image_url, floor_number, metadata, created_at
        FROM locations
        WHERE location_id = $1;
    """
    try:
        row = await db.fetchrow(query, location_id)
        return dict(row) if row else None
    except Exception as exc:
        logger.exception("Failed to fetch location %s: %s", location_id, exc)
        return None


async def get_all_locations() -> List[Dict[str, Any]]:
    """Lists all locations ordered by type and name."""
    query = """
        SELECT location_id, parent_id, name, type, latitude, longitude,
               address, floorplan_image_url, floor_number, metadata, created_at
        FROM locations
        ORDER BY parent_id NULLS FIRST, name ASC;
    """
    try:
        rows = await db.fetch(query)
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.exception("Failed to list locations: %s", exc)
        return []


async def create_location_mapping(
    location_id: str,
    vendor: str,
    vendor_site_id: str,
    vendor_map_id: Optional[str] = None,
) -> bool:
    """Binds a vendor's internal site/map ID to Naxis canonical location_id."""
    query = """
        INSERT INTO location_mappings (location_id, vendor, vendor_site_id, vendor_map_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (vendor, vendor_site_id) DO UPDATE SET
            location_id = EXCLUDED.location_id,
            vendor_map_id = EXCLUDED.vendor_map_id;
    """
    try:
        res = await db.execute(query, location_id, vendor, vendor_site_id, vendor_map_id)
        return "INSERT" in res or "UPDATE" in res
    except Exception as exc:
        logger.exception("Failed to map vendor site %s: %s", vendor_site_id, exc)
        return False


async def get_location_by_vendor_site(vendor: str, vendor_site_id: str) -> Optional[str]:
    """Resolves Naxis location_id for a given vendor site ID."""
    query = """
        SELECT location_id
        FROM location_mappings
        WHERE vendor = $1 AND vendor_site_id = $2;
    """
    try:
        row = await db.fetchrow(query, vendor, vendor_site_id)
        return row["location_id"] if row else None
    except Exception as exc:
        logger.exception("Failed to resolve vendor site %s/%s: %s", vendor, vendor_site_id, exc)
        return None
