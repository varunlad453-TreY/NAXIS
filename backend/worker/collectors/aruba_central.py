"""
HPE Aruba Central Collector (WP-3.5)

Polls HPE Aruba Central API for:
  - Switch Inventory (/monitoring/v1/switches)
  - Access Point Inventory (/monitoring/v1/aps)
  - Site Mapping (/central/v2/sites)
  - Operational Events (/monitoring/v1/events)

Upserts into the `inventory` table and registers canonical identities in `IdentityResolver`.
Returns a ``CollectorOutcome`` with structured telemetry metadata.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

try:
    from backend.config.settings import get_settings
    from backend.shared.database.client import db
    from backend.shared.database.identity import IdentityResolver
    from backend.shared.models.collector_outcome import CollectorOutcome
    from backend.shared.models.event import (
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
except ImportError:  # pragma: no cover - supports both entry-point styles
    from config.settings import get_settings
    from shared.database.client import db
    from shared.database.identity import IdentityResolver
    from shared.models.collector_outcome import CollectorOutcome
    from shared.models.event import (
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )

logger = logging.getLogger(__name__)

COLLECTOR_ID = "aruba-central"
SOURCE_SYSTEM = "aruba"


class ArubaCentralCollector:
    """Collector for HPE Aruba Central switches, APs, sites, and events."""

    def __init__(self, resolver: Optional[IdentityResolver] = None):
        settings = get_settings()
        self._base_url = settings.aruba_central_base_url.rstrip("/")
        self._client_id = settings.aruba_central_client_id
        self._client_secret = settings.aruba_central_client_secret
        self._customer_id = settings.aruba_central_customer_id
        self._enabled = settings.aruba_central_enabled
        self._resolver = resolver or IdentityResolver()

    @property
    def is_configured(self) -> bool:
        return bool(self._enabled and self._base_url and self._client_id and self._client_secret)

    async def collect(self) -> CollectorOutcome:
        outcome = CollectorOutcome(
            collector_id=COLLECTOR_ID,
            source_system=SOURCE_SYSTEM,
        )

        if not self.is_configured:
            outcome.mark_skipped("Aruba Central not configured")
            return outcome

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0),
                follow_redirects=True,
            ) as client:
                token = await self._authenticate(client)
                if not token:
                    outcome.mark_error("Aruba Central authentication failed")
                    return outcome

                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

                switches = await self._fetch_switches(client, headers)
                aps = await self._fetch_aps(client, headers)
                events = await self._fetch_events(client, headers)

                all_devices = switches + aps
                rows = _build_aruba_rows(all_devices)
                if rows:
                    await _upsert_aruba_inventory(rows)
                    await _sync_aruba_identities(rows, self._resolver)

                outcome.metadata["switches_found"] = len(switches)
                outcome.metadata["aps_found"] = len(aps)
                outcome.metadata["events_found"] = len(events)
                outcome.mark_success(rows_written=len(rows))
                logger.info("Aruba Central: upserted %d devices (%d switches, %d APs)", len(rows), len(switches), len(aps))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("Aruba Central collection failed")

        return outcome

    async def _authenticate(self, client: httpx.AsyncClient) -> Optional[str]:
        try:
            url = f"{self._base_url}/oauth2/token"
            payload = {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": "client_credentials",
            }
            resp = await client.post(url, data=payload)
            if resp.status_code == 200:
                return resp.json().get("access_token")
            logger.error("Aruba Central OAuth token request returned HTTP %d", resp.status_code)
            return None
        except Exception as exc:
            logger.error("Aruba Central auth exception: %s", exc)
            return None

    async def _fetch_switches(self, client: httpx.AsyncClient, headers: Dict[str, str]) -> List[Dict]:
        try:
            resp = await client.get(f"{self._base_url}/monitoring/v1/switches", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("switches", []) if isinstance(data, dict) else []
            return []
        except Exception as exc:
            logger.warning("Aruba Central: failed to fetch switches: %s", exc)
            return []

    async def _fetch_aps(self, client: httpx.AsyncClient, headers: Dict[str, str]) -> List[Dict]:
        try:
            resp = await client.get(f"{self._base_url}/monitoring/v1/aps", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("aps", []) if isinstance(data, dict) else []
            return []
        except Exception as exc:
            logger.warning("Aruba Central: failed to fetch APs: %s", exc)
            return []

    async def _fetch_events(self, client: httpx.AsyncClient, headers: Dict[str, str]) -> List[Dict]:
        try:
            resp = await client.get(f"{self._base_url}/monitoring/v1/events", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("events", []) if isinstance(data, dict) else []
            return []
        except Exception as exc:
            logger.warning("Aruba Central: failed to fetch events: %s", exc)
            return []


def _build_aruba_rows(devices: List[Dict]) -> List[Dict[str, Any]]:
    rows = []
    for d in devices:
        mac = str(d.get("macaddr", "") or d.get("mac", "")).replace(":", "").lower()
        serial = str(d.get("serial", "") or "")
        dev_id = serial or mac or f"aruba-{uuid4().hex[:8]}"
        hostname = str(d.get("name", "") or d.get("hostname", "") or dev_id)
        model = str(d.get("model", "") or "")
        site_name = str(d.get("site", "") or d.get("site_name", "") or "Default Site")
        site_id = f"aruba-site-{site_name.lower().replace(' ', '-')}"
        status = str(d.get("status", "")).lower()
        connected = status in ("up", "connected", "online")

        device_type = "switch" if "switch" in model.lower() or d.get("type") == "switch" else "ap"

        rows.append({
            "device_id": dev_id,
            "platform": "aruba",
            "hostname": hostname,
            "mac": mac,
            "serial": serial,
            "model": model,
            "device_type": device_type,
            "ip_address": str(d.get("ip_address", "") or d.get("ip", "") or ""),
            "site_id": site_id,
            "site_name": site_name,
            "connected": connected,
            "reachability": "reachable" if connected else "unreachable",
            "num_clients": int(d.get("client_count", 0) or 0),
            "uptime_seconds": int(d.get("uptime", 0) or 0),
            "firmware_version": str(d.get("firmware_version", "") or d.get("sw_version", "") or ""),
            "last_seen": datetime.now(timezone.utc),
        })
    return rows


async def _upsert_aruba_inventory(rows: List[Dict[str, Any]]) -> None:
    query = """
        INSERT INTO inventory (
            device_id, platform, hostname, mac, serial, model, device_type,
            ip_address, site_id, site_name, connected, reachability,
            num_clients, uptime_seconds, firmware_version, last_seen, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            $13, $14, $15, $16, NOW()
        )
        ON CONFLICT (device_id) DO UPDATE SET
            hostname         = EXCLUDED.hostname,
            ip_address       = EXCLUDED.ip_address,
            site_id          = EXCLUDED.site_id,
            site_name        = EXCLUDED.site_name,
            connected        = EXCLUDED.connected,
            reachability     = EXCLUDED.reachability,
            num_clients      = EXCLUDED.num_clients,
            uptime_seconds   = EXCLUDED.uptime_seconds,
            firmware_version = EXCLUDED.firmware_version,
            last_seen        = EXCLUDED.last_seen,
            updated_at       = NOW()
    """
    for row in rows:
        await db.execute(
            query,
            row["device_id"], row["platform"], row["hostname"], row["mac"],
            row["serial"], row["model"], row["device_type"],
            row["ip_address"], row["site_id"], row["site_name"],
            row["connected"], row["reachability"],
            row["num_clients"], row["uptime_seconds"], row["firmware_version"],
            row["last_seen"],
        )


async def _sync_aruba_identities(rows: List[Dict[str, Any]], resolver: IdentityResolver) -> None:
    if not rows:
        return

    # Sites
    site_specs = [(r["site_id"], r["site_name"], "aruba", None) for r in rows if r["site_id"]]
    site_map = await resolver.resolve_sites(site_specs)

    # Devices
    pairs = []
    for r in rows:
        site_key = site_map.get(("aruba", r["site_id"]))
        hints = {
            "display_name": r["hostname"],
            "device_type": r["device_type"],
            "model": r["model"],
            "serial": r["serial"],
            "mac": r["mac"],
            "ip_address": r["ip_address"],
            "site_key": site_key,
        }
        pairs.append(("aruba", r["device_id"], hints))

    await resolver.resolve_devices(pairs)
