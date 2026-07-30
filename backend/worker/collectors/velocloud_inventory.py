"""
VeloCloud SD-WAN Inventory Collector

Pulls all SD-WAN edge devices from VeloCloud Orchestrator via the
/portal/rest/ API using JWT Bearer token auth.

Key endpoints used:
  POST /portal/rest/enterprise/getEnterprise     → org/enterprise info
  POST /portal/rest/enterprise/getEnterpriseEdges → all edge devices
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config.settings import get_settings
from shared.database.client import db
from shared.models.collector_outcome import CollectorOutcome

logger = logging.getLogger(__name__)

COLLECTOR_ID = "velocloud-inventory"
SOURCE_SYSTEM = "velocloud"


class VelocloudInventoryCollector:
    def __init__(self):
        settings = get_settings()
        self._base_url = settings.velocloud_url.rstrip("/")
        self._api_key = settings.velocloud_api_key
        self._enabled = settings.velocloud_enabled
        self._verify_ssl = settings.velocloud_verify_ssl
        self._headers = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }

    async def collect(self) -> CollectorOutcome:
        """Fetch all edges and upsert into DB. Returns CollectorOutcome."""
        outcome = CollectorOutcome(
            collector_id=COLLECTOR_ID,
            source_system=SOURCE_SYSTEM,
        )
        if not self._enabled or not self._api_key or not self._base_url:
            outcome.mark_skipped("VeloCloud inventory not configured")
            return outcome

        try:
            async with httpx.AsyncClient(
                headers=self._headers,
                timeout=httpx.Timeout(60.0),
                follow_redirects=True,
                verify=self._verify_ssl,
            ) as client:
                enterprise = await self._fetch_enterprise(client)
                enterprise_id = enterprise.get("id") if enterprise else None
                edges = await self._fetch_edges(client, enterprise_id)

            rows = _build_rows(edges)
            if rows:
                await _upsert_inventory(rows)
            outcome.mark_success(rows_written=len(rows))
            logger.info("VeloCloud inventory: upserted %d edges", len(rows))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("VeloCloud inventory collection failed")
        return outcome

    async def _fetch_enterprise(self, client: httpx.AsyncClient) -> Dict:
        try:
            resp = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterprise",
                json={},
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Failed to fetch VeloCloud enterprise: %s", exc)
            return {}

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def _fetch_edges(
        self, client: httpx.AsyncClient, enterprise_id: Any
    ) -> List[Dict]:
        try:
            payload: Dict[str, Any] = {"with": ["site", "recentLinks"]}
            if enterprise_id is not None:
                payload["enterpriseId"] = enterprise_id

            resp = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterpriseEdges",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []
        except Exception as exc:
            logger.error("Failed to fetch VeloCloud edges: %s", exc)
            return []


def _build_rows(edges: List[Dict]) -> List[Dict[str, Any]]:
    rows = []
    for e in edges:
        edge_id = str(e.get("id", ""))
        logical_id = e.get("logicalId", "") or f"velo-{edge_id}"
        name = e.get("name", "") or logical_id

        # Site/location
        site = e.get("site") or {}
        site_id = str(site.get("id", "")) or edge_id
        site_name = site.get("name", "") or e.get("siteName", "") or f"site-{site_id[:8]}"
        city = site.get("city", "")
        country = site.get("country", "")
        if city and country:
            site_name = f"{site_name} ({city}, {country})"
        elif city:
            site_name = f"{site_name} ({city})"

        # Connectivity
        edge_state = e.get("edgeState", "")  # CONNECTED, OFFLINE, DEGRADED, etc.
        connected = edge_state == "CONNECTED"
        if edge_state == "CONNECTED":
            reachability = "reachable"
        elif edge_state == "DEGRADED":
            reachability = "degraded"
        else:
            reachability = "unreachable"

        # WAN links for primary IP + topology props
        ip_address = ""
        link_list: List[Dict[str, Any]] = []
        recent_links = e.get("recentLinks") or []
        for lnk in recent_links:
            ip_address = ip_address or (lnk.get("ipAddress", "") or "")
            link_list.append({
                "interface": lnk.get("interface", ""),
                "name": lnk.get("displayName", "") or lnk.get("name", ""),
                "isp": lnk.get("displayName", "") or lnk.get("name", ""),
                "public_ip": lnk.get("ipAddress", "") or "",
                "state": lnk.get("state", ""),
                "internal_id": lnk.get("internalId", "") or "",
                "netmask": lnk.get("netmask", "") or "",
                "upstream_mbps": lnk.get("bwUpstreamMbps"),
                "downstream_mbps": lnk.get("bwDownstreamMbps"),
            })

        rows.append({
            "device_id": logical_id,
            "platform": "velocloud",
            "hostname": name,
            "mac": e.get("activationKey", "") or "",
            "serial": e.get("serialNumber", "") or "",
            "model": e.get("modelNumber", "") or e.get("deviceFamily", "") or "",
            "device_type": "edge",
            "ip_address": ip_address,
            "site_id": site_id,
            "site_name": site_name,
            "connected": connected,
            "reachability": reachability,
            "num_clients": 0,
            "uptime_seconds": 0,
            "firmware_version": e.get("buildNumber", "") or e.get("softwareVersion", "") or "",
            "last_seen": datetime.now(timezone.utc),
            "props": {"links": link_list, "velobrain_score": 0.0},
        })
    return rows


async def _upsert_inventory(rows: List[Dict[str, Any]]) -> None:
    query = """
        INSERT INTO inventory (
            device_id, platform, hostname, mac, serial, model, device_type,
            ip_address, site_id, site_name, connected, reachability,
            num_clients, uptime_seconds, firmware_version, last_seen,
            props, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            $13, $14, $15, $16,
            $17::jsonb, NOW()
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
            props            = EXCLUDED.props,
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
            json.dumps(row["props"]),
        )
