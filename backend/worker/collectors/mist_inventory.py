"""
Mist Inventory Collector

Pulls the full AP inventory from:
  - /api/v1/orgs/{org_id}/inventory          → all APs (model, serial, name, connected)
  - /api/v1/orgs/{org_id}/sites               → site name lookup table
  - /api/v1/sites/{site_id}/stats/devices     → live stats (clients, uptime, IP)

Upserts into the `inventory` table every collection cycle.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config.settings import get_settings
from shared.database.client import db

logger = logging.getLogger(__name__)

_PAGE_LIMIT = 100


class MistInventoryCollector:
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

    async def collect(self) -> int:
        """Fetch full inventory and upsert into DB. Returns number of devices upserted."""
        if not self._enabled or not self._api_key or not self._org_id:
            return 0

        async with httpx.AsyncClient(
            headers=self._headers,
            timeout=httpx.Timeout(60.0),
            follow_redirects=True,
        ) as client:
            site_map = await self._fetch_site_map(client)
            devices = await self._fetch_inventory(client)
            stats_map = await self._fetch_all_stats(client, list(site_map.keys()))

        rows = _build_rows(devices, site_map, stats_map, self._org_id)
        if rows:
            await _upsert_inventory(rows)
        logger.info("Mist inventory: upserted %d devices", len(rows))
        return len(rows)

    async def _fetch_site_map(self, client: httpx.AsyncClient) -> Dict[str, str]:
        """Returns {site_id: site_name}."""
        try:
            resp = await client.get(f"{self._base_url}/api/v1/orgs/{self._org_id}/sites")
            resp.raise_for_status()
            return {s["id"]: s["name"] for s in resp.json()}
        except Exception as exc:
            logger.error("Failed to fetch Mist sites: %s", exc)
            return {}

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_inventory(self, client: httpx.AsyncClient) -> List[Dict]:
        """GET /api/v1/orgs/{org_id}/inventory — returns full list (no pagination)."""
        try:
            resp = await client.get(f"{self._base_url}/api/v1/orgs/{self._org_id}/inventory")
            resp.raise_for_status()
            return resp.json() if isinstance(resp.json(), list) else []
        except Exception as exc:
            logger.error("Failed to fetch Mist inventory: %s", exc)
            return []

    async def _fetch_all_stats(
        self, client: httpx.AsyncClient, site_ids: List[str]
    ) -> Dict[str, Dict]:
        """
        Fetch live device stats for every site. Returns {ap_mac: stats_dict}.
        Runs sites in small concurrent batches to avoid hammering the API.
        """
        import asyncio
        stats_map: Dict[str, Dict] = {}

        async def fetch_site(site_id: str) -> None:
            try:
                resp = await client.get(
                    f"{self._base_url}/api/v1/sites/{site_id}/stats/devices",
                    params={"limit": 200},
                )
                if resp.status_code == 200:
                    for ap in resp.json():
                        mac = ap.get("mac", "")
                        if mac:
                            stats_map[mac] = ap
            except Exception:
                pass  # non-fatal: stats are best-effort

        # Process 10 sites at a time
        batch_size = 10
        for i in range(0, len(site_ids), batch_size):
            batch = site_ids[i : i + batch_size]
            await asyncio.gather(*[fetch_site(sid) for sid in batch])

        logger.info("Mist stats: fetched live data for %d APs", len(stats_map))
        return stats_map


def _build_rows(
    devices: List[Dict],
    site_map: Dict[str, str],
    stats_map: Dict[str, Dict],
    org_id: str,
) -> List[Dict[str, Any]]:
    rows = []
    for d in devices:
        mac = d.get("mac", "")
        ap_id = d.get("id", "") or f"mist-{mac}"
        site_id = d.get("site_id", "") or org_id
        site_name = site_map.get(site_id, f"site-{site_id[:8]}")
        connected = bool(d.get("connected", False))

        stats = stats_map.get(mac, {})
        ip_address = stats.get("ip", "") or ""
        num_clients = _count_clients(stats)
        uptime = int(stats.get("uptime", 0) or 0)
        firmware = d.get("version", "") or stats.get("version", "") or ""

        rows.append({
            "device_id": ap_id,
            "platform": "mist",
            "hostname": d.get("name", "") or mac,
            "mac": mac,
            "serial": d.get("serial", "") or "",
            "model": d.get("model", "") or "",
            "device_type": d.get("type", "ap"),
            "ip_address": ip_address,
            "site_id": site_id,
            "site_name": site_name,
            "connected": connected,
            "reachability": "reachable" if connected else "unreachable",
            "num_clients": num_clients,
            "uptime_seconds": uptime,
            "firmware_version": firmware,
            "last_seen": datetime.now(timezone.utc),
        })
    return rows


def _count_clients(stats: Dict) -> int:
    total = 0
    for band in ("band_24", "band_5", "band_6"):
        rs = stats.get("radio_stat", {})
        if isinstance(rs, dict):
            total += rs.get(band, {}).get("num_clients", 0)
    return total or stats.get("num_clients", 0)


async def _upsert_inventory(rows: List[Dict[str, Any]]) -> None:
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
