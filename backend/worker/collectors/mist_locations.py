"""
Mist Locations Collector

Builds the real physical hierarchy from:
  - /api/v1/orgs/{org_id}/sites                       → sites (name, address, latlng)
  - /api/v1/sites/{site_id}/maps                      → floorplans (url, width, height, ppm)
  - /api/v1/sites/{site_id}/devices?type=ap&limit=1000 → AP map_id + x/y pixel coords

Writes:
  locations         region → site → floor
  location_mappings site-level and floor-level vendor bindings
  ap_placements     one row per AP that Mist has actually placed on a floorplan

Returns a ``CollectorOutcome`` with structured telemetry metadata.
"""

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

try:
    from backend.config.settings import get_settings
    from backend.shared.models.collector_outcome import CollectorOutcome
except ImportError:  # pragma: no cover - supports both entry-point styles
    from config.settings import get_settings
    from shared.models.collector_outcome import CollectorOutcome
try:
    from backend.shared.database.client import db
    from backend.shared.database.locations_db import create_location, create_location_mapping
except ImportError:  # pragma: no cover - supports both entry-point styles
    from shared.database.client import db
    from shared.database.locations_db import create_location, create_location_mapping

logger = logging.getLogger(__name__)

COLLECTOR_ID = "mist-locations"
SOURCE_SYSTEM = "mist"
VENDOR = "mist"

_SITE_CONCURRENCY = 8

# Mist addresses sometimes name only a city that is itself a state/UT ("Delhi, India").
_INDIAN_STATES: Tuple[str, ...] = (
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Andaman and Nicobar Islands",
    "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Lakshadweep",
    "Puducherry",
)

_UNASSIGNED_REGION_ID = "mist-region-unassigned"
_UNASSIGNED_REGION_NAME = "Unassigned"

_FLOOR_WORDS = {
    "ground": 0,
    "basement": -1,
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
}


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


def derive_region(address: Optional[str]) -> Tuple[str, str]:
    """Returns (region_location_id, region_name) parsed from a postal address."""
    if not address:
        return _UNASSIGNED_REGION_ID, _UNASSIGNED_REGION_NAME
    # Indian addresses put the state last before the country, so an earlier
    # match is a city/locality that shares a state name ("Chandigarh, Punjab").
    best: Optional[Tuple[int, int, str]] = None
    for state in _INDIAN_STATES:
        for m in re.finditer(rf"\b{re.escape(state)}\b", address, flags=re.IGNORECASE):
            candidate = (m.end(), len(state), state)
            if best is None or candidate > best:
                best = candidate
    if best is None:
        return _UNASSIGNED_REGION_ID, _UNASSIGNED_REGION_NAME
    return f"mist-region-{slugify(best[2])}", best[2]


def parse_floor_number(map_name: Optional[str]) -> Optional[int]:
    """Best-effort floor number from a Mist map name. None when ambiguous."""
    if not map_name:
        return None
    name = map_name.lower()

    m = re.search(r"\b(\d{1,2})\s*(?:st|nd|rd|th)\s*floor\b", name)
    if m:
        return int(m.group(1))
    m = re.search(r"\bfloor\s*[-:# ]*\s*(\d{1,2})\b", name)
    if m:
        return int(m.group(1))
    for word, number in _FLOOR_WORDS.items():
        if re.search(rf"\b{word}\s+floor\b", name):
            return number
    return None


def _clamp_pct(value: float) -> float:
    return max(0.0, min(100.0, value))


class MistLocationsCollector:
    def __init__(self):
        settings = get_settings()
        self._api_key = settings.mist_api_key
        self._org_id = settings.mist_org_id
        self._base_url = settings.mist_base_url.rstrip("/")
        self._enabled = settings.mist_enabled
        self._headers = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key and self._org_id and self._enabled)

    async def collect(self) -> CollectorOutcome:
        """Rebuild the Mist location hierarchy and AP placements."""
        outcome = CollectorOutcome(
            collector_id=COLLECTOR_ID,
            source_system=SOURCE_SYSTEM,
        )

        if not self.is_configured:
            outcome.mark_skipped("Mist locations not configured")
            return outcome

        try:
            async with httpx.AsyncClient(
                headers=self._headers,
                timeout=httpx.Timeout(60.0),
                follow_redirects=True,
            ) as client:
                sites = await self._fetch_sites(client)
                site_ids = [s["id"] for s in sites if s.get("id")]
                site_details = await self._fetch_all_site_details(client, site_ids)
            failed_sites = len(site_ids) - len(site_details)

            regions: Dict[str, str] = {}
            site_rows: List[Dict[str, Any]] = []
            floor_rows: List[Dict[str, Any]] = []
            placements: List[Dict[str, Any]] = []
            maps_found = 0
            aps_unplaced = 0

            for site in sites:
                sid = site.get("id")
                if not sid:
                    continue
                detail = site_details.get(sid)
                if detail is None:
                    # Per-site fetch failed; leave its existing rows untouched.
                    continue

                latlng = site.get("latlng") or {}
                lat = latlng.get("lat")
                lng = latlng.get("lng")
                address = site.get("address") or None
                region_id, region_name = derive_region(address)
                regions[region_id] = region_name

                site_location_id = f"mist-site-{sid}"
                site_rows.append({
                    "location_id": site_location_id,
                    "name": site.get("name") or sid,
                    "parent_id": region_id,
                    "latitude": lat,
                    "longitude": lng,
                    "address": address,
                    "metadata": {
                        "mist_site_id": sid,
                        "timezone": site.get("timezone"),
                        "country_code": site.get("country_code"),
                    },
                })

                maps_by_id: Dict[str, Dict[str, Any]] = {}
                for fp in detail["maps"]:
                    mid = fp.get("id")
                    if not mid:
                        continue
                    maps_by_id[mid] = fp
                    maps_found += 1
                    floor_rows.append({
                        "location_id": f"mist-map-{mid}",
                        "name": fp.get("name") or mid,
                        "parent_id": site_location_id,
                        "latitude": lat,
                        "longitude": lng,
                        "floorplan_image_url": fp.get("url"),
                        "floor_number": parse_floor_number(fp.get("name")),
                        "mist_site_id": sid,
                        "mist_map_id": mid,
                        "metadata": {
                            "mist_map_id": mid,
                            "mist_site_id": sid,
                            "width": fp.get("width"),
                            "height": fp.get("height"),
                            "ppm": fp.get("ppm"),
                            "width_m": fp.get("width_m"),
                            "height_m": fp.get("height_m"),
                            "thumbnail_url": fp.get("thumbnail_url"),
                        },
                    })

                for ap in detail["aps"]:
                    device_id = ap.get("id")
                    map_id = ap.get("map_id")
                    x = ap.get("x")
                    y = ap.get("y")
                    if not device_id or not map_id or x is None or y is None:
                        aps_unplaced += 1
                        continue
                    fp = maps_by_id.get(map_id)
                    if not fp:
                        aps_unplaced += 1
                        logger.debug(
                            "Mist locations: AP %s references unknown map %s on site %s",
                            device_id, map_id, sid,
                        )
                        continue
                    width = fp.get("width")
                    height = fp.get("height")
                    if not width or not height:
                        aps_unplaced += 1
                        logger.debug(
                            "Mist locations: map %s has no pixel dimensions — skipping AP %s",
                            map_id, device_id,
                        )
                        continue
                    placements.append({
                        "device_id": device_id,
                        "location_id": f"mist-map-{map_id}",
                        "vendor_site_id": sid,
                        "vendor_map_id": map_id,
                        "x": float(x),
                        "y": float(y),
                        "x_pct": _clamp_pct(100.0 * float(x) / float(width)),
                        "y_pct": _clamp_pct(100.0 * float(y) / float(height)),
                    })

            written = await self._persist(
                regions, site_rows, floor_rows, placements, full_pass=failed_sites == 0
            )

            outcome.metadata["sites_found"] = len(site_rows)
            outcome.metadata["maps_found"] = maps_found
            outcome.metadata["aps_placed"] = len(placements)
            outcome.metadata["aps_unplaced"] = aps_unplaced
            outcome.metadata["regions_created"] = len(regions)
            outcome.metadata["sites_failed"] = failed_sites
            outcome.mark_success(rows_written=written)
            logger.info(
                "Mist locations: %d sites, %d floorplans, %d AP placements (%d unplaced, %d sites failed)",
                len(site_rows), maps_found, len(placements), aps_unplaced, failed_sites,
            )
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Mist locations collection failed")

        return outcome

    # ------------------------------------------------------------------
    # Fetch
    # ------------------------------------------------------------------

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_sites(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        resp = await client.get(f"{self._base_url}/api/v1/orgs/{self._org_id}/sites")
        resp.raise_for_status()
        payload = resp.json()
        return payload if isinstance(payload, list) else []

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_maps(self, client: httpx.AsyncClient, site_id: str) -> List[Dict[str, Any]]:
        resp = await client.get(f"{self._base_url}/api/v1/sites/{site_id}/maps")
        resp.raise_for_status()
        payload = resp.json()
        return payload if isinstance(payload, list) else []

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_aps(self, client: httpx.AsyncClient, site_id: str) -> List[Dict[str, Any]]:
        resp = await client.get(
            f"{self._base_url}/api/v1/sites/{site_id}/devices",
            params={"type": "ap", "limit": 1000},
        )
        resp.raise_for_status()
        payload = resp.json()
        return payload if isinstance(payload, list) else []

    async def _fetch_all_site_details(
        self, client: httpx.AsyncClient, site_ids: List[str]
    ) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
        """Returns {site_id: {"maps": [...], "aps": [...]}}, omitting failed sites."""
        details: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        sem = asyncio.Semaphore(_SITE_CONCURRENCY)

        async def fetch_site(site_id: str) -> None:
            async with sem:
                try:
                    maps, aps = await asyncio.gather(
                        self._fetch_maps(client, site_id),
                        self._fetch_aps(client, site_id),
                    )
                except Exception:
                    logger.warning(
                        "Mist locations: failed to fetch maps/devices for site %s",
                        site_id, exc_info=True,
                    )
                    return
                details[site_id] = {"maps": maps, "aps": aps}

        await asyncio.gather(*[fetch_site(sid) for sid in site_ids])
        return details

    # ------------------------------------------------------------------
    # Persist
    # ------------------------------------------------------------------

    async def _persist(
        self,
        regions: Dict[str, str],
        site_rows: List[Dict[str, Any]],
        floor_rows: List[Dict[str, Any]],
        placements: List[Dict[str, Any]],
        full_pass: bool,
    ) -> int:
        written = 0

        # Parents before children or the self-referential FK rejects the child.
        for region_id, region_name in regions.items():
            if await create_location(
                location_id=region_id,
                name=region_name,
                location_type="region",
            ):
                written += 1

        for row in site_rows:
            if await create_location(
                location_id=row["location_id"],
                name=row["name"],
                location_type="site",
                parent_id=row["parent_id"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                address=row["address"],
                metadata=row["metadata"],
            ):
                written += 1
            await create_location_mapping(
                location_id=row["location_id"],
                vendor=VENDOR,
                vendor_site_id=row["metadata"]["mist_site_id"],
                vendor_map_id=None,
            )

        for row in floor_rows:
            if await create_location(
                location_id=row["location_id"],
                name=row["name"],
                location_type="floor",
                parent_id=row["parent_id"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                floorplan_image_url=row["floorplan_image_url"],
                floor_number=row["floor_number"],
                metadata=row["metadata"],
            ):
                written += 1
            await create_location_mapping(
                location_id=row["location_id"],
                vendor=VENDOR,
                vendor_site_id=row["mist_site_id"],
                vendor_map_id=row["mist_map_id"],
            )

        written += await self._upsert_placements(placements)
        if full_pass:
            await self._prune(site_rows, floor_rows, placements)
        else:
            logger.warning("Mist locations: partial pass — skipping stale-row prune")
        return written

    async def _upsert_placements(self, placements: List[Dict[str, Any]]) -> int:
        if not placements:
            return 0
        query = """
            INSERT INTO ap_placements (
                device_id, location_id, vendor, vendor_site_id, vendor_map_id,
                x, y, x_pct, y_pct, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (device_id) DO UPDATE SET
                location_id    = EXCLUDED.location_id,
                vendor         = EXCLUDED.vendor,
                vendor_site_id = EXCLUDED.vendor_site_id,
                vendor_map_id  = EXCLUDED.vendor_map_id,
                x              = EXCLUDED.x,
                y              = EXCLUDED.y,
                x_pct          = EXCLUDED.x_pct,
                y_pct          = EXCLUDED.y_pct,
                updated_at     = NOW()
        """
        args = [
            (
                p["device_id"], p["location_id"], VENDOR, p["vendor_site_id"],
                p["vendor_map_id"], p["x"], p["y"], p["x_pct"], p["y_pct"],
            )
            for p in placements
        ]
        await db.executemany(query, args)
        return len(args)

    async def _prune(
        self,
        site_rows: List[Dict[str, Any]],
        floor_rows: List[Dict[str, Any]],
        placements: List[Dict[str, Any]],
    ) -> None:
        """Drop rows for upstream objects that no longer exist. No-op on an empty pass."""
        if placements:
            device_ids = [p["device_id"] for p in placements]
            await db.execute(
                "DELETE FROM ap_placements WHERE vendor = $1 AND device_id <> ALL($2::text[])",
                VENDOR, device_ids,
            )

        live_ids = [r["location_id"] for r in site_rows] + [r["location_id"] for r in floor_rows]
        if live_ids:
            # CASCADEs location_mappings and ap_placements, which is intended.
            await db.execute(
                """
                DELETE FROM locations
                WHERE type IN ('site', 'floor')
                  AND location_id LIKE 'mist-%'
                  AND location_id <> ALL($1::text[])
                """,
                live_ids,
            )
