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
from typing import Any, Dict, List, Optional, Tuple
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

        for vendor, vendor_id, hints in pairs:
            if not vendor or not vendor_id:
                continue
            vendor = vendor.lower()
            key = (vendor, vendor_id)
            cached = self._device_cache.get(key)
            if cached:
                result[key] = cached
            else:
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

        for vendor_site_id, site_name, vendor, parent_key in site_specs:
            if not vendor_site_id:
                continue
            vendor = (vendor or "unknown").lower()
            key = (vendor, vendor_site_id)
            cache_key = _site_key(vendor_site_id, vendor)
            cached = self._site_cache.get(cache_key)
            if cached:
                result[key] = cached
            else:
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
            SELECT device_key
            FROM device_identities
            WHERE vendor = $1 AND vendor_device_id = $2
            """,
            vendor,
            vendor_device_id,
        )
        return row["device_key"] if row else None

    async def _find_site_key(self, vendor_site_id: str, vendor: str) -> Optional[str]:
        if not db.pool:
            return None
        # vendor_ids is a JSONB object like {"mist": "<uuid>", "velocloud": "123"}
        row = await db.fetchrow(
            """
            SELECT site_key
            FROM sites
            WHERE vendor_ids->>$1 = $2
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

        # Generate keys and prepare rows
        device_rows: List[Tuple[str, str, str, str, str, str, Optional[str], str, str, str]] = []
        identity_rows: List[Tuple[str, str, str, str]] = []
        for vendor, vendor_device_id, hints in items:
            device_key = str(uuid4())
            result[(vendor, vendor_device_id)] = device_key
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
            device_rows.append(
                (device_key, display_name, device_type, role, model, vendor, site_key, serial, mac, ip_address)
            )
            identity_rows.append((device_key, vendor, vendor_device_id, vendor_display_name))

        # Bulk insert devices
        await db.executemany(
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
            device_rows,
        )

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
            JOIN (SELECT * FROM unnest($1::text[], $2::text[]) AS t(vendor, vendor_device_id)) q
              ON i.vendor = q.vendor AND i.vendor_device_id = q.vendor_device_id
            """,
            vendors,
            ids,
        )
        for row in rows:
            result[(row["vendor"], row["vendor_device_id"])] = row["device_key"]
        return result

    async def _find_site_keys_bulk(
        self,
        pairs: List[Tuple[str, str]],
    ) -> Dict[Tuple[str, str], str]:
        """Bulk lookup (vendor, vendor_site_id) -> site_key."""
        result: Dict[Tuple[str, str], str] = {}
        if not pairs or not db.pool:
            return result
        # Build an OR query over vendor_ids JSONB lookups. Scales with the
        # number of pairs but sites are small (hundreds), so this is fine.
        conditions: List[str] = []
        params: List[str] = []
        for idx, (vendor, vendor_site_id) in enumerate(pairs):
            conditions.append(f"vendor_ids->>${idx * 2 + 1} = ${idx * 2 + 2}")
            params.extend([vendor, vendor_site_id])
        rows = await db.fetch(
            f"""
            SELECT site_key, vendor_ids
            FROM sites
            WHERE {' OR '.join(conditions)}
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


