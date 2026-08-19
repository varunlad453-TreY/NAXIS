"""
Location Service & Floorplan Engine (WP-5)

Constructs hierarchical location trees, aggregates location health, and normalizes AP
floorplan coordinates for interactive NOC drill-downs.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

try:
    from backend.api.models.location_models import (
        APPlacement,
        FloorplanResponse,
        LocationNode,
    )
    from backend.shared.database.client import db
    from backend.shared.database.locations_db import (
        get_all_locations,
        get_location,
    )
except ImportError:
    from api.models.location_models import (
        APPlacement,
        FloorplanResponse,
        LocationNode,
    )
    from shared.database.client import db
    from shared.database.locations_db import (
        get_all_locations,
        get_location,
    )

logger = logging.getLogger(__name__)

_TYPE_RANK = {"region": 0, "site": 1, "building": 2, "floor": 3, "zone": 4}
_HEALTH_RANK = {"healthy": 0, "unknown": 1, "degraded": 2, "critical": 3}


def _roll_up(node: "LocationNode") -> Tuple[int, str]:
    """Sums descendant device counts and lifts the worst health onto the parent."""
    count = node.device_count or 0
    worst = node.health_status or "healthy"
    for child in node.children:
        child_count, child_health = _roll_up(child)
        count += child_count
        if _HEALTH_RANK.get(child_health, 0) > _HEALTH_RANK.get(worst, 0):
            worst = child_health
    node.device_count = count
    node.health_status = worst
    return count, worst


def _as_dict(value: Any) -> Dict[str, Any]:
    """asyncpg hands jsonb back as str unless a codec is registered."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class LocationService:
    """Service handling facility hierarchy, floorplan AP placement, and health aggregation."""

    async def get_location_tree(self) -> List[LocationNode]:
        """Constructs recursive tree of physical locations with aggregated health scores.

        Health and device counts are resolved with two set-based queries; per-location
        lookups fanned out into ~9 sequential round-trips each and timed the endpoint out.
        """
        all_locs = await get_all_locations()
        loc_ids = [l["location_id"] for l in all_locs if l.get("location_id")]

        health_by_id = await self._get_location_health_bulk(loc_ids)
        counts_by_id = await self._get_location_device_counts_bulk(loc_ids)

        nodes_by_id: Dict[str, LocationNode] = {}
        for l in all_locs:
            loc_id = l["location_id"]
            health = health_by_id.get(loc_id, "healthy")
            dev_count = counts_by_id.get(loc_id, 0)
            nodes_by_id[loc_id] = LocationNode(
                location_id=loc_id,
                name=l["name"],
                type=l["type"],
                parent_id=l.get("parent_id"),
                latitude=l.get("latitude"),
                longitude=l.get("longitude"),
                health_status=health,
                device_count=dev_count,
                children=[],
            )


        roots: List[LocationNode] = []
        for loc_id, node in nodes_by_id.items():
            if node.parent_id and node.parent_id in nodes_by_id:
                nodes_by_id[node.parent_id].children.append(node)
            else:
                roots.append(node)

        def sort_key(n: LocationNode) -> Tuple[int, str]:
            return (_TYPE_RANK.get(n.type, len(_TYPE_RANK)), (n.name or "").lower())

        for node in nodes_by_id.values():
            node.children.sort(key=sort_key)
        roots.sort(key=sort_key)

        # Devices hang off floors and sites, never regions, so without this every
        # region reads "0 devices / healthy" no matter what is failing beneath it.
        for root in roots:
            _roll_up(root)

        return roots

    async def get_floorplan_details(self, location_id: str, name: Optional[str] = None) -> FloorplanResponse:
        """Returns the floorplan image, its pixel dimensions, and the APs Mist has positioned on it."""
        loc = await get_location(location_id)
        loc_name = name or (loc.get("name") if loc else None) or location_id
        metadata = _as_dict(loc.get("metadata")) if loc else {}

        parent_building = ""
        if loc and loc.get("parent_id"):
            p = await get_location(loc["parent_id"])
            if p:
                parent_building = p["name"] or ""

        aps = await self._fetch_ap_placements(location_id)
        unplaced = await self._count_unplaced_site_aps(location_id, metadata)

        floor_health = "healthy"
        for ap in aps:
            if ap.health_status == "critical":
                floor_health = "critical"
                break
            elif ap.health_status == "degraded" and floor_health != "critical":
                floor_health = "degraded"

        return FloorplanResponse(
            location_id=location_id,
            name=loc_name,
            building_name=parent_building,
            floor_number=loc.get("floor_number") if loc else None,
            floorplan_image_url=(loc.get("floorplan_image_url") if loc else None),
            floorplan_width=_as_int(metadata.get("width")),
            floorplan_height=_as_int(metadata.get("height")),
            ap_placements=aps,
            placed_ap_count=len(aps),
            unplaced_ap_count=unplaced,
            health_status=floor_health,
        )

    async def _count_unplaced_site_aps(self, location_id: str, metadata: Dict[str, Any]) -> int:
        """APs at this floor's parent site that Mist has not positioned on any map."""
        vendor_site_id = metadata.get("mist_site_id")
        if not vendor_site_id:
            try:
                row = await db.fetchrow(
                    """
                    SELECT vendor_site_id
                    FROM location_mappings
                    WHERE location_id = $1 AND vendor = 'mist'
                    LIMIT 1;
                    """,
                    location_id,
                )
                vendor_site_id = row["vendor_site_id"] if row else None
            except Exception as exc:
                logger.warning("Could not resolve vendor site for %s: %s", location_id, exc)
                return 0
        if not vendor_site_id:
            return 0

        try:
            row = await db.fetchrow(
                """
                SELECT COUNT(*) AS cnt
                FROM inventory i
                WHERE i.platform = 'mist' AND i.site_id = $1 AND i.device_type = 'ap'
                  AND NOT EXISTS (
                      SELECT 1 FROM ap_placements p WHERE p.device_id = i.device_id
                  );
                """,
                str(vendor_site_id),
            )
            return int(row["cnt"] or 0) if row else 0
        except Exception as exc:
            logger.warning("Could not count unplaced APs for site %s: %s", vendor_site_id, exc)
            return 0

    async def _fetch_ap_placements(self, location_id: str) -> List[APPlacement]:
        """Returns the APs the vendor has positioned on this floor, at their real coordinates.

        Coordinates come from `ap_placements`, written by the Mist floorplan collector
        from each AP's own x/y in its map's pixel space. No rows means no placed APs —
        there is deliberately no fallback that borrows APs from other sites.
        """
        query = """
            SELECT p.device_id, p.x_pct, p.y_pct, p.vendor,
                   COALESCE(NULLIF(i.hostname, ''), p.device_id) AS name,
                   i.mac, i.ip_address, i.platform, i.model, i.num_clients, i.connected,
                   i.props
              FROM ap_placements p
              LEFT JOIN inventory i ON i.device_id = p.device_id
             WHERE p.location_id = $1
             ORDER BY name ASC;
        """
        try:
            rows = await db.fetch(query, location_id)
        except Exception as exc:
            logger.warning("Could not fetch AP placements for %s: %s", location_id, exc)
            return []

        if not rows:
            return []

        device_ids = [str(r["device_id"]) for r in rows]
        event_health = await self._get_device_event_health_bulk(device_ids)

        placements: List[APPlacement] = []
        for r in rows:
            node_id = str(r["device_id"])
            channel, channel_util = self._radio_stats(r["props"])

            if r["connected"] is False:
                health = "degraded"
                health_reason = "Device unreachable — no controller heartbeat"
            else:
                health, health_reason = event_health.get(node_id, ("healthy", None))

            placements.append(
                APPlacement(
                    device_id=node_id,
                    name=str(r["name"]),
                    mac_address=r["mac"],
                    ip_address=r["ip_address"],
                    vendor=str(r["platform"] or r["vendor"]),
                    x_pct=float(r["x_pct"]),
                    y_pct=float(r["y_pct"]),
                    health_status=health,
                    health_reason=health_reason,
                    client_count=int(r["num_clients"] or 0),
                    channel=channel,
                    rssi=None,
                    model=r["model"],
                    channel_util=channel_util,
                )
            )

        return placements

    @staticmethod
    def _radio_stats(props: Any) -> Tuple[Optional[int], Optional[float]]:
        """Pulls the real operating channel and utilization out of inventory.props.radio_stat."""
        radio_stat = _as_dict(_as_dict(props).get("radio_stat"))
        for band in ("band_5", "band_6", "band_24"):
            band_stat = _as_dict(radio_stat.get(band))
            if not band_stat:
                continue
            channel = _as_int(band_stat.get("channel"))
            if not channel:
                continue
            try:
                util = float(band_stat["util_all"]) if band_stat.get("util_all") is not None else None
            except (TypeError, ValueError):
                util = None
            return channel, util
        return None, None

    async def _get_device_event_health_bulk(
        self, device_ids: List[str]
    ) -> Dict[str, Tuple[str, Optional[str]]]:
        """Latest recent event severity per device, in one query instead of one per AP.

        Events reference an AP by its canonical device_key or by its bare MAC, never by
        the '00000000-0000-0000-1000-<mac>' inventory id that ap_placements is keyed on,
        so the id is widened through device_identities before the join can match.
        """
        result: Dict[str, Tuple[str, Optional[str]]] = {}
        if not device_ids or not db.pool:
            return result
        try:
            rows = await db.fetch(
                """
                WITH wanted AS (
                    SELECT unnest($1::text[]) AS device_id
                ),
                keys AS (
                    SELECT w.device_id, w.device_id AS match_id FROM wanted w
                    UNION
                    SELECT w.device_id, di.device_key
                      FROM wanted w
                      JOIN device_identities di ON di.vendor_device_id = w.device_id
                    UNION
                    SELECT w.device_id, alias.vendor_device_id
                      FROM wanted w
                      JOIN device_identities di ON di.vendor_device_id = w.device_id
                      JOIN device_identities alias ON alias.device_key = di.device_key
                )
                SELECT DISTINCT ON (k.device_id)
                       k.device_id, e.severity, e.title, e.description
                FROM keys k
                JOIN events e ON e.device_id = k.match_id
                WHERE e.timestamp > NOW() - INTERVAL '24 hours'
                ORDER BY k.device_id, e.timestamp DESC
                """,
                device_ids,
            )
        except Exception as exc:
            logger.warning("Bulk device event health lookup failed: %s", exc)
            return result

        for row in rows:
            sev = str(row["severity"] or "").lower()
            reason = str(row["title"] or row["description"] or "Active telemetry anomaly")
            if sev in ("critical", "fatal"):
                result[str(row["device_id"])] = ("critical", reason)
            elif sev in ("major", "warning"):
                result[str(row["device_id"])] = ("degraded", reason)
        return result

    async def _get_location_health_bulk(self, location_ids: List[str]) -> Dict[str, str]:
        """Worst recent event severity per location, in one query.

        Matches on the canonical site_key, on every vendor site id aliased to it, and on
        the vendor site id bound to the location itself, so a location resolves whether
        events carry the canonical key or the vendor's own id. Floor-level mappings are
        excluded so a floor does not inherit whole-site severity.
        """
        result: Dict[str, str] = {}
        if not location_ids or not db.pool:
            return result
        try:
            rows = await db.fetch(
                """
                WITH wanted AS (
                    SELECT unnest($1::text[]) AS location_id
                ),
                keys AS (
                    SELECT w.location_id, w.location_id AS match_id FROM wanted w
                    UNION
                    SELECT w.location_id, si.vendor_site_id
                      FROM wanted w
                      JOIN site_identities si ON si.site_key = w.location_id
                    UNION
                    SELECT w.location_id, lm.vendor_site_id
                      FROM wanted w
                      JOIN location_mappings lm
                        ON lm.location_id = w.location_id AND lm.vendor_map_id IS NULL
                )
                SELECT k.location_id,
                       MAX(CASE lower(e.severity)
                             WHEN 'critical' THEN 3
                             WHEN 'major'    THEN 2
                             WHEN 'warning'  THEN 2
                             ELSE 1
                           END) AS rank
                FROM keys k
                JOIN events e ON e.site_id = k.match_id
                WHERE e.received_at > NOW() - INTERVAL '24 hours'
                GROUP BY k.location_id
                """,
                location_ids,
            )
        except Exception as exc:
            logger.warning("Bulk location health lookup failed: %s", exc)
            return result

        for row in rows:
            rank = int(row["rank"] or 1)
            result[row["location_id"]] = (
                "critical" if rank >= 3 else "degraded" if rank == 2 else "healthy"
            )
        return result

    async def _get_location_device_counts_bulk(self, location_ids: List[str]) -> Dict[str, int]:
        """Device count per location, in one query.

        Site-level rows count their topology nodes; floor rows count the APs the vendor
        actually placed on that floorplan, which is the only device set a floor owns.
        """
        result: Dict[str, int] = {}
        if not location_ids or not db.pool:
            return result
        try:
            rows = await db.fetch(
                """
                WITH wanted AS (
                    SELECT unnest($1::text[]) AS location_id
                ),
                keys AS (
                    SELECT w.location_id, w.location_id AS match_id FROM wanted w
                    UNION
                    SELECT w.location_id, si.vendor_site_id
                      FROM wanted w
                      JOIN site_identities si ON si.site_key = w.location_id
                    UNION
                    SELECT w.location_id, lm.vendor_site_id
                      FROM wanted w
                      JOIN location_mappings lm
                        ON lm.location_id = w.location_id AND lm.vendor_map_id IS NULL
                )
                SELECT k.location_id, COUNT(DISTINCT n.node_id) AS cnt
                FROM keys k
                JOIN topology_nodes n ON n.site_id = k.match_id
                WHERE n.node_type <> 'site'
                GROUP BY k.location_id
                """,
                location_ids,
            )
        except Exception as exc:
            logger.warning("Bulk location device count failed: %s", exc)
            rows = []

        for row in rows:
            result[row["location_id"]] = int(row["cnt"] or 0)

        try:
            floor_rows = await db.fetch(
                """
                SELECT location_id, COUNT(*) AS cnt
                FROM ap_placements
                WHERE location_id = ANY($1::text[])
                GROUP BY location_id
                """,
                location_ids,
            )
        except Exception as exc:
            logger.warning("Bulk floor AP placement count failed: %s", exc)
            return result

        for row in floor_rows:
            result[row["location_id"]] = int(row["cnt"] or 0)
        return result


location_service = LocationService()
