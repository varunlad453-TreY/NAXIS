"""
Canonical identity resolver.

Maps vendor-native device identifiers (Mist UUID, Mist MAC, VeloCloud edge id,
DNAC device id, SNMP IP, etc.) to a single canonical `device_key` per physical
device, and vendor-native site identifiers to a canonical `site_key`.

Design points:
- One canonical `devices` row per physical device, one canonical `sites` row
  per facility/site.
- `device_identities` is the many-to-one join table: (vendor, vendor_id) -> device_key.
- The resolver is async, DB-backed, and carries a per-instance in-memory cache
  so a single worker cycle does not repeatedly query the same identities.
- Upserts are idempotent and conflict-safe.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

try:
    from backend.shared.database.client import db
except ImportError:  # pragma: no cover - supports both entry-point styles
    from shared.database.client import db

logger = logging.getLogger(__name__)

_MAC_RE = re.compile(r"[^0-9a-fA-F]")


def _normalize_mac(value: Optional[str]) -> str:
    """Return lowercase, colon-free 12-char MAC, or empty string if not a MAC."""
    if not value:
        return ""
    cleaned = _MAC_RE.sub("", value).lower()
    if len(cleaned) == 12:
        return cleaned
    return ""


def _coalesce(*values: Optional[str]) -> str:
    for v in values:
        if v and str(v).strip():
            return str(v).strip()
    return ""


def _site_key(vendor_site_id: str, vendor: str) -> str:
    """Vendor-agnostic stable key for the sites table lookup helper."""
    return f"{vendor}:{vendor_site_id}".lower()


class IdentityResolver:
    """
    Async identity resolver with per-instance caching.

    Usage:
        resolver = IdentityResolver()
        device_key = await resolver.resolve_device(
            "mist", ap_uuid,
            display_name=ap_name,
            mac=ap_mac,
            site_key=site_key,
        )
    """

    def __init__(self) -> None:
        self._device_cache: Dict[Tuple[str, str], str] = {}
        self._site_cache: Dict[str, str] = {}
        self._device_info_cache: Dict[str, Dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def resolve_device(
        self,
        vendor: str,
        vendor_device_id: str,
        display_name: Optional[str] = None,
        device_type: Optional[str] = None,
        role: Optional[str] = None,
        model: Optional[str] = None,
        serial: Optional[str] = None,
        mac: Optional[str] = None,
        ip_address: Optional[str] = None,
        site_key: Optional[str] = None,
        vendor_display_name: Optional[str] = None,
    ) -> str:
        """Return the canonical device_key for a vendor identifier, creating it if needed."""
        if not vendor or not vendor_device_id:
            raise ValueError("vendor and vendor_device_id are required")

        vendor = vendor.lower()
        cache_key = (vendor, vendor_device_id)
        if cache_key in self._device_cache:
            return self._device_cache[cache_key]

        device_key = await self._find_device_key(vendor, vendor_device_id)
        if not device_key:
            device_key = await self._create_device(
                vendor=vendor,
                vendor_device_id=vendor_device_id,
                display_name=display_name,
                device_type=device_type,
                role=role,
                model=model,
                serial=serial,
                mac=mac,
                ip_address=ip_address,
                site_key=site_key,
                vendor_display_name=vendor_display_name,
            )

        self._device_cache[cache_key] = device_key
        return device_key

    async def find_device(
        self,
        vendor: str,
        vendor_device_id: str,
    ) -> Optional[str]:
        """Lookup only; does not create."""
        if not vendor or not vendor_device_id:
            return None
        vendor = vendor.lower()
        cache_key = (vendor, vendor_device_id)
        if cache_key in self._device_cache:
            return self._device_cache[cache_key]
        device_key = await self._find_device_key(vendor, vendor_device_id)
        if device_key:
            self._device_cache[cache_key] = device_key
        return device_key

    async def resolve_devices(
        self,
        pairs: List[Tuple[str, str, Dict[str, Any]]],
    ) -> Dict[Tuple[str, str], str]:
        """
        Bulk resolve/create many (vendor, vendor_id, hints) tuples.
        Returns {(vendor, vendor_id): device_key, ...}.
        """
        result: Dict[Tuple[str, str], str] = {}
        missing: List[Tuple[str, str, Dict[str, Any]]] = []
        seen: Set[Tuple[str, str]] = set()

        for vendor, vendor_id, hints in pairs:
            if not vendor or not vendor_id:
                continue
            vendor = vendor.lower()
            key = (vendor, vendor_id)
            cached = self._device_cache.get(key)
            if cached:
                result[key] = cached
            elif key not in seen:
                # Dedupe: callers routinely pass one spec per row, so the same
                # identifier can appear many times in a single batch. Without
                # this, each repeat is treated as a distinct missing device.
                seen.add(key)
                missing.append((vendor, vendor_id, hints))

        if missing:
            # Try to find existing identities in one query
            found = await self._find_device_keys_bulk([(v, vid) for v, vid, _ in missing])
            still_missing: List[Tuple[str, str, Dict[str, Any]]] = []
            for vendor, vendor_id, hints in missing:
                key = (vendor, vendor_id)
                device_key = found.get(key)
                if device_key:
                    self._device_cache[key] = device_key
                    result[key] = device_key
                else:
                    still_missing.append((vendor, vendor_id, hints))

            if still_missing:
                created = await self._create_devices_bulk(still_missing)
                for key, device_key in created.items():
                    self._device_cache[key] = device_key
                    result[key] = device_key

        return result

    async def resolve_site(
        self,
        vendor_site_id: str,
        site_name: Optional[str] = None,
        vendor: Optional[str] = None,
        parent_key: Optional[str] = None,
    ) -> str:
        """Return the canonical site_key for a vendor site identifier, creating it if needed."""
        if not vendor_site_id:
            raise ValueError("vendor_site_id is required")

        vendor = (vendor or "unknown").lower()
        cache_key = _site_key(vendor_site_id, vendor)
        if cache_key in self._site_cache:
            return self._site_cache[cache_key]

        site_key = await self._find_site_key(vendor_site_id, vendor)
        if not site_key:
            site_key = await self._create_site(
                vendor_site_id=vendor_site_id,
                site_name=site_name or vendor_site_id,
                vendor=vendor,
                parent_key=parent_key,
            )

        self._site_cache[cache_key] = site_key
        return site_key

    async def resolve_sites(
        self,
        site_specs: List[Tuple[str, str, Optional[str], Optional[str]]],
    ) -> Dict[Tuple[str, str], str]:
        """
        Bulk resolve/create sites. Input tuples: (vendor_site_id, site_name, vendor, parent_key).
        Returns {(vendor, vendor_site_id): site_key, ...}.
        """
        result: Dict[Tuple[str, str], str] = {}
        missing: List[Tuple[str, str, Optional[str], Optional[str]]] = []
        seen: Set[Tuple[str, str]] = set()

        for vendor_site_id, site_name, vendor, parent_key in site_specs:
            if not vendor_site_id:
                continue
            vendor = (vendor or "unknown").lower()
            key = (vendor, vendor_site_id)
            cache_key = _site_key(vendor_site_id, vendor)
            cached = self._site_cache.get(cache_key)
            if cached:
                result[key] = cached
            elif key not in seen:
                # Dedupe before create. Callers build site_specs with one entry
                # per DEVICE, so a 345-AP site arrived 345 times; combined with
                # a never-firing ON CONFLICT (site_key) target that minted 345
                # rows for one site.
                seen.add(key)
                missing.append((vendor_site_id, site_name, vendor, parent_key))

        if missing:
            found = await self._find_site_keys_bulk([(v, sid) for sid, _, v, _ in missing])
            still_missing: List[Tuple[str, str, Optional[str], Optional[str]]] = []
            for vendor_site_id, site_name, vendor, parent_key in missing:
                key = (vendor, vendor_site_id)
                site_key = found.get(key)
                if site_key:
                    self._site_cache[_site_key(vendor_site_id, vendor)] = site_key
                    result[key] = site_key
                else:
                    still_missing.append((vendor_site_id, site_name, vendor, parent_key))

            if still_missing:
                created = await self._create_sites_bulk(still_missing)
                for key, site_key in created.items():
                    self._site_cache[_site_key(key[1], key[0])] = site_key
                    result[key] = site_key

        return result

    async def get_device(self, device_key: str) -> Optional[Dict[str, Any]]:
        """Return canonical device metadata by device_key."""
        if not device_key:
            return None
        if device_key in self._device_info_cache:
            return self._device_info_cache[device_key]
        if not db.pool:
            return None
        row = await db.fetchrow(
            "SELECT * FROM devices WHERE device_key = $1",
            device_key,
        )
        if row:
            info = dict(row)
            self._device_info_cache[device_key] = info
            return info
        return None

    async def get_site(self, site_key: str) -> Optional[Dict[str, Any]]:
        """Return canonical site metadata by site_key."""
        if not site_key:
            return None
        if not db.pool:
            return None
        row = await db.fetchrow(
            "SELECT * FROM sites WHERE site_key = $1",
            site_key,
        )
        return dict(row) if row else None

    def clear_cache(self) -> None:
        """Clear the per-instance cache. Useful in tests."""
        self._device_cache.clear()
        self._site_cache.clear()
        self._device_info_cache.clear()

    # ------------------------------------------------------------------
    # Internal: single lookups
    # ------------------------------------------------------------------

    async def _find_device_key(self, vendor: str, vendor_device_id: str) -> Optional[str]:
        if not db.pool:
            return None
        row = await db.fetchrow(
            """
            SELECT di.device_key
            FROM device_identities di
            JOIN devices d ON di.device_key = d.device_key
            WHERE di.vendor = $1 AND di.vendor_device_id = $2
            """,
            vendor,
            vendor_device_id,
        )
        if row:
            return row["device_key"]

        # Fall back to the MAC. One vendor emits several id forms for the same
        # physical device — Mist alone uses '00000000-0000-0000-1000-<mac>'
        # (inventory), a bare MAC (topology/LLDP), and a site-device UUID
        # (events). Exact-match-only lookup minted a separate canonical device
        # per form, so one AP became 2-3 `devices` rows and events resolved
        # against none of them.
        mac = _normalize_mac(vendor_device_id)
        if not mac:
            return None
        row = await db.fetchrow(
            "SELECT device_key FROM devices WHERE mac = $1 ORDER BY created_at LIMIT 1",
            mac,
        )
        if not row:
            return None
        device_key = row["device_key"]
        await self._register_alias(device_key, vendor, vendor_device_id)
        return device_key

    async def _register_alias(
        self, device_key: str, vendor: str, vendor_device_id: str, display_name: str = ""
    ) -> None:
        """Attach another vendor identifier to an existing canonical device.

        Makes the next lookup an exact hit instead of re-deriving the MAC.
        """
        if not db.pool or not device_key or not vendor_device_id:
            return
        await db.execute(
            """
            INSERT INTO device_identities (device_key, vendor, vendor_device_id, vendor_display_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (vendor, vendor_device_id) DO UPDATE SET
                device_key = EXCLUDED.device_key,
                updated_at = NOW()
            """,
            device_key, vendor, vendor_device_id, display_name,
        )

    async def _find_device_keys_by_mac(self, macs: List[str]) -> Dict[str, str]:
        """Bulk MAC -> device_key for already-canonical devices."""
        result: Dict[str, str] = {}
        wanted = sorted({m for m in macs if m})
        if not wanted or not db.pool:
            return result
        rows = await db.fetch(
            """
            SELECT DISTINCT ON (mac) mac, device_key
            FROM devices
            WHERE mac = ANY($1::text[]) AND mac <> ''
            ORDER BY mac, created_at
            """,
            wanted,
        )
        for row in rows:
            result[row["mac"]] = row["device_key"]
        return result

    async def _find_site_key(self, vendor_site_id: str, vendor: str) -> Optional[str]:
        if not db.pool:
            return None
        # site_identities carries the UNIQUE (vendor, vendor_site_id) guarantee.
        # Falls back to the legacy vendor_ids JSONB so a database that has not
        # had migration 017 applied still resolves.
        row = await db.fetchrow(
            """
            SELECT site_key FROM site_identities
            WHERE vendor = $1 AND vendor_site_id = $2
            """,
            vendor,
            vendor_site_id,
        )
        if row:
            return row["site_key"]
        row = await db.fetchrow(
            """
            SELECT site_key
            FROM sites
            WHERE vendor_ids->>$1 = $2
            ORDER BY created_at
            LIMIT 1
            """,
            vendor,
            vendor_site_id,
        )
        return row["site_key"] if row else None

    # ------------------------------------------------------------------
    # Internal: single creates
    # ------------------------------------------------------------------

    async def _create_device(
        self,
        vendor: str,
        vendor_device_id: str,
        display_name: Optional[str],
        device_type: Optional[str],
        role: Optional[str],
        model: Optional[str],
        serial: Optional[str],
        mac: Optional[str],
        ip_address: Optional[str],
        site_key: Optional[str],
        vendor_display_name: Optional[str],
    ) -> str:
        device_key = str(uuid4())
        display_name = _coalesce(display_name, vendor_display_name, vendor_device_id)
        device_type = _coalesce(device_type, "unknown")
        role = _coalesce(role, "")
        model = _coalesce(model, "")
        serial = _coalesce(serial, "")
        mac = _normalize_mac(mac)
        ip_address = _coalesce(ip_address, "")
        site_key = site_key or None

        if not db.pool:
            # No DB connection: return a synthetic key for isolated tests
            return device_key

        # Reconcile on the MAC hint before minting: the same physical device
        # arriving under a second vendor id must become an alias, not a second
        # canonical device.
        if mac:
            existing = await self._find_device_keys_by_mac([mac])
            if mac in existing:
                device_key = existing[mac]
                await self._register_alias(
                    device_key, vendor, vendor_device_id,
                    _coalesce(vendor_display_name, display_name),
                )
                return device_key

        await db.execute(
            """
            INSERT INTO devices (device_key, display_name, device_type, role, model, vendor, site_key, serial, mac, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (device_key) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                device_type  = EXCLUDED.device_type,
                role         = EXCLUDED.role,
                model        = EXCLUDED.model,
                vendor       = EXCLUDED.vendor,
                site_key     = EXCLUDED.site_key,
                serial       = EXCLUDED.serial,
                mac          = EXCLUDED.mac,
                ip_address   = EXCLUDED.ip_address,
                updated_at   = NOW()
            """,
            device_key, display_name, device_type, role, model, vendor, site_key,
            serial, mac, ip_address,
        )

        await db.execute(
            """
            INSERT INTO device_identities (device_key, vendor, vendor_device_id, vendor_display_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (vendor, vendor_device_id) DO UPDATE SET
                device_key = EXCLUDED.device_key,
                vendor_display_name = EXCLUDED.vendor_display_name,
                updated_at = NOW()
            """,
            device_key, vendor, vendor_device_id, _coalesce(vendor_display_name, display_name),
        )

        return device_key

    async def _create_site(
        self,
        vendor_site_id: str,
        site_name: str,
        vendor: str,
        parent_key: Optional[str],
    ) -> str:
        site_key = str(uuid4())
        site_name = _coalesce(site_name, vendor_site_id)
        parent_key = parent_key or None

        if not db.pool:
            return site_key

        await db.execute(
            """
            INSERT INTO sites (site_key, name, parent_key, vendor_ids)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (site_key) DO UPDATE SET
                name        = EXCLUDED.name,
                parent_key  = EXCLUDED.parent_key,
                vendor_ids  = EXCLUDED.vendor_ids,
                updated_at  = NOW()
            """,
            site_key, site_name, parent_key, json.dumps({vendor: vendor_site_id}),
        )

        # Claim the vendor id. If another pass already claimed it, adopt the
        # winner and drop the row we just created rather than keeping both.
        await db.execute(
            """
            INSERT INTO site_identities (site_key, vendor, vendor_site_id, vendor_site_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (vendor, vendor_site_id) DO NOTHING
            """,
            site_key, vendor, vendor_site_id, site_name,
        )
        winner = await self._find_site_key(vendor_site_id, vendor)
        if winner and winner != site_key:
            await db.execute("DELETE FROM sites WHERE site_key = $1", site_key)
            return winner

        try:
            await db.execute(
                """
                INSERT INTO locations (location_id, parent_id, name, type, metadata)
                VALUES ($1, $2, $3, 'site', $4::jsonb)
                ON CONFLICT (location_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    parent_id = EXCLUDED.parent_id;
                """,
                site_key, parent_key, site_name, json.dumps({vendor: vendor_site_id})
            )
            await db.execute(
                """
                INSERT INTO location_mappings (location_id, vendor, vendor_site_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (vendor, vendor_site_id) DO UPDATE SET
                    location_id = EXCLUDED.location_id;
                """,
                site_key, vendor, vendor_site_id
            )
        except Exception as exc:
            logger.warning("Failed to mirror site into locations table: %s", exc)

        return site_key

    # ------------------------------------------------------------------
    # Internal: bulk creates
    # ------------------------------------------------------------------

    async def _create_devices_bulk(
        self,
        items: List[Tuple[str, str, Dict[str, Any]]],
    ) -> Dict[Tuple[str, str], str]:
        """Create devices + identities for all missing items. Returns mapping."""
        result: Dict[Tuple[str, str], str] = {}
        if not items or not db.pool:
            return result

        # Reconcile against devices that already exist under another vendor id,
        # and against other items in this same batch, so one physical device
        # yields exactly one canonical key.
        item_macs = [_normalize_mac(h.get("mac")) for _, _, h in items]
        key_by_mac: Dict[str, str] = await self._find_device_keys_by_mac(item_macs)

        # Generate keys and prepare rows
        device_rows: List[Tuple[str, str, str, str, str, str, Optional[str], str, str, str]] = []
        identity_rows: List[Tuple[str, str, str, str]] = []
        for vendor, vendor_device_id, hints in items:
            display_name = _coalesce(
                hints.get("display_name"),
                hints.get("vendor_display_name"),
                vendor_device_id,
            )
            device_type = _coalesce(hints.get("device_type"), "unknown")
            role = _coalesce(hints.get("role"), "")
            model = _coalesce(hints.get("model"), "")
            serial = _coalesce(hints.get("serial"), "")
            mac = _normalize_mac(hints.get("mac"))
            ip_address = _coalesce(hints.get("ip_address"), "")
            site_key = hints.get("site_key") or None
            vendor_display_name = _coalesce(hints.get("vendor_display_name"), display_name)

            reused = key_by_mac.get(mac) if mac else None
            device_key = reused or str(uuid4())
            if mac and not reused:
                key_by_mac[mac] = device_key
            result[(vendor, vendor_device_id)] = device_key

            # A reused device already has its canonical row; only the alias is new.
            if not reused:
                device_rows.append(
                    (device_key, display_name, device_type, role, model, vendor, site_key, serial, mac, ip_address)
                )
            identity_rows.append((device_key, vendor, vendor_device_id, vendor_display_name))

        if not device_rows:
            await db.executemany(
                """
                INSERT INTO device_identities (device_key, vendor, vendor_device_id, vendor_display_name)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (vendor, vendor_device_id) DO UPDATE SET
                    device_key = EXCLUDED.device_key,
                    vendor_display_name = EXCLUDED.vendor_display_name,
                    updated_at = NOW()
                """,
                identity_rows,
            )
            return result

        # Bulk insert devices.
        #
        # DO NOTHING, not DO UPDATE, and with no inference target: two collectors
        # hold independent resolver caches, so on a cold start both can mint a
        # key for the same MAC in the same moment. A targeted conflict clause
        # would let the loser's row raise on the MAC uniqueness index, aborting
        # the whole executemany — which left this resolver returning keys that
        # were never persisted, and downstream FK violations on
        # topology_nodes.canonical_key.
        await db.executemany(
            """
            INSERT INTO devices (device_key, display_name, device_type, role, model, vendor, site_key, serial, mac, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT DO NOTHING
            """,
            device_rows,
        )

        # Adopt whoever actually won each MAC, so the caller never receives a
        # key that lost the race and does not exist.
        winners = await self._find_device_keys_by_mac(
            [row[8] for row in device_rows if row[8]]
        )
        if winners:
            remapped = 0
            for (vendor, vendor_device_id), device_key in list(result.items()):
                mac = next(
                    (r[8] for r in device_rows if r[0] == device_key and r[8]), ""
                )
                winning = winners.get(mac) if mac else None
                if winning and winning != device_key:
                    result[(vendor, vendor_device_id)] = winning
                    self._device_cache[(vendor, vendor_device_id)] = winning
                    remapped += 1
            if remapped:
                logger.info(
                    "Adopted %d concurrently-created canonical device(s)", remapped
                )
                identity_rows = [
                    (result[(v, vid)], v, vid, name) for _, v, vid, name in identity_rows
                ]

        # Bulk insert identities
        await db.executemany(
            """
            INSERT INTO device_identities (device_key, vendor, vendor_device_id, vendor_display_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (vendor, vendor_device_id) DO UPDATE SET
                device_key = EXCLUDED.device_key,
                vendor_display_name = EXCLUDED.vendor_display_name,
                updated_at = NOW()
            """,
            identity_rows,
        )

        return result

    async def _create_sites_bulk(
        self,
        items: List[Tuple[str, str, str, Optional[str]]],
    ) -> Dict[Tuple[str, str], str]:
        """Create sites for all missing items. Input: (vendor_site_id, site_name, vendor, parent_key)."""
        result: Dict[Tuple[str, str], str] = {}
        if not items or not db.pool:
            return result

        rows: List[Tuple[str, str, Optional[str], str]] = []
        for vendor_site_id, site_name, vendor, parent_key in items:
            site_key = str(uuid4())
            key = (vendor, vendor_site_id)
            result[key] = site_key
            rows.append((site_key, _coalesce(site_name, vendor_site_id), parent_key, json.dumps({vendor: vendor_site_id})))

        await db.executemany(
            """
            INSERT INTO sites (site_key, name, parent_key, vendor_ids)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (site_key) DO UPDATE SET
                name        = EXCLUDED.name,
                parent_key  = EXCLUDED.parent_key,
                vendor_ids  = EXCLUDED.vendor_ids,
                updated_at  = NOW()
            """,
            rows,
        )

        # The identity row is what actually enforces one site per vendor id.
        # If a concurrent pass won the race, adopt its site_key rather than
        # leaving a second canonical site behind.
        await db.executemany(
            """
            INSERT INTO site_identities (site_key, vendor, vendor_site_id, vendor_site_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (vendor, vendor_site_id) DO NOTHING
            """,
            [
                (result[(vendor, vendor_site_id)], vendor, vendor_site_id, _coalesce(site_name, vendor_site_id))
                for vendor_site_id, site_name, vendor, _ in items
            ],
        )
        winners = await self._find_site_keys_bulk([(v, sid) for sid, _, v, _ in items])
        for key, winning_key in winners.items():
            if result.get(key) and result[key] != winning_key:
                result[key] = winning_key
        return result

    async def _find_device_keys_bulk(
        self,
        pairs: List[Tuple[str, str]],
    ) -> Dict[Tuple[str, str], str]:
        """Bulk lookup (vendor, vendor_device_id) -> device_key."""
        result: Dict[Tuple[str, str], str] = {}
        if not pairs or not db.pool:
            return result
        vendors = [p[0] for p in pairs]
        ids = [p[1] for p in pairs]
        rows = await db.fetch(
            """
            SELECT i.vendor, i.vendor_device_id, i.device_key
            FROM device_identities i
            JOIN devices d ON i.device_key = d.device_key
            JOIN (SELECT * FROM unnest($1::text[], $2::text[]) AS t(vendor, vendor_device_id)) q
              ON i.vendor = q.vendor AND i.vendor_device_id = q.vendor_device_id
            """,
            vendors,
            ids,
        )
        for row in rows:
            result[(row["vendor"], row["vendor_device_id"])] = row["device_key"]

        # Same MAC fallback as the single lookup, in one query for the misses.
        misses = [(v, vid) for v, vid in pairs if (v, vid) not in result]
        mac_of = {(v, vid): _normalize_mac(vid) for v, vid in misses}
        by_mac = await self._find_device_keys_by_mac([m for m in mac_of.values() if m])
        for key, mac in mac_of.items():
            device_key = by_mac.get(mac) if mac else None
            if device_key:
                result[key] = device_key
                await self._register_alias(device_key, key[0], key[1])
        return result

    async def _find_site_keys_bulk(
        self,
        pairs: List[Tuple[str, str]],
    ) -> Dict[Tuple[str, str], str]:
        """Bulk lookup (vendor, vendor_site_id) -> site_key."""
        result: Dict[Tuple[str, str], str] = {}
        if not pairs or not db.pool:
            return result
        # Prefer the indexed, unique site_identities table.
        rows = await db.fetch(
            """
            SELECT si.vendor, si.vendor_site_id, si.site_key
            FROM site_identities si
            JOIN (SELECT * FROM unnest($1::text[], $2::text[]) AS t(vendor, vendor_site_id)) q
              ON si.vendor = q.vendor AND si.vendor_site_id = q.vendor_site_id
            """,
            [p[0] for p in pairs],
            [p[1] for p in pairs],
        )
        for row in rows:
            result[(row["vendor"], row["vendor_site_id"])] = row["site_key"]

        remaining = [p for p in pairs if p not in result]
        if not remaining:
            return result

        # Legacy fallback for databases without migration 017.
        conditions: List[str] = []
        params: List[str] = []
        for idx, (vendor, vendor_site_id) in enumerate(remaining):
            conditions.append(f"vendor_ids->>${idx * 2 + 1} = ${idx * 2 + 2}")
            params.extend([vendor, vendor_site_id])
        rows = await db.fetch(
            f"""
            SELECT site_key, vendor_ids
            FROM sites
            WHERE {' OR '.join(conditions)}
            ORDER BY created_at
            """,
            *params,
        )
        for row in rows:
            vendor_ids_raw = row["vendor_ids"]
            if isinstance(vendor_ids_raw, str):
                try:
                    vendor_ids = json.loads(vendor_ids_raw)
                except Exception:
                    vendor_ids = {}
            else:
                vendor_ids = vendor_ids_raw or {}
            for vendor, vendor_site_id in pairs:
                if vendor_ids.get(vendor) == vendor_site_id:
                    result[(vendor, vendor_site_id)] = row["site_key"]
        return result


async def resolve_device_types(device_refs: List[str]) -> Dict[str, str]:
    """Map each device reference to its canonical `devices.device_type`.

    Accepts either spelling a collector may have put on an event: a canonical
    device_key, or a vendor-native id registered in device_identities.

    Collectors hardcode `device_type="ap"` on the events they emit, so a Mist EX
    switch arrives labelled as an access point. The correlation cascade splits
    events into infrastructure and leaf by exactly this field, so without the
    canonical type no event is ever infrastructure and the cascade cannot run.
    """
    result: Dict[str, str] = {}
    wanted = sorted({r for r in device_refs if r})
    if not wanted or not db.pool:
        return result

    rows = await db.fetch(
        """
        SELECT ref, device_type FROM (
            SELECT d.device_key AS ref, d.device_type
              FROM devices d
             WHERE d.device_key = ANY($1::text[])
            UNION ALL
            SELECT di.vendor_device_id AS ref, d.device_type
              FROM device_identities di
              JOIN devices d ON d.device_key = di.device_key
             WHERE di.vendor_device_id = ANY($1::text[])
        ) t
        """,
        wanted,
    )
    for row in rows:
        device_type = (row["device_type"] or "").strip().lower()
        if device_type and device_type != "unknown":
            result[row["ref"]] = device_type
    return result


# Module-level convenience singleton
_resolver: Optional[IdentityResolver] = None


def get_identity_resolver() -> IdentityResolver:
    """Return the module-level identity resolver singleton."""
    global _resolver
    if _resolver is None:
        _resolver = IdentityResolver()
    return _resolver


def reset_identity_resolver() -> None:
    """Reset the module-level singleton (useful in tests)."""
    global _resolver
    _resolver = None


