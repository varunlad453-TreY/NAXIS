"""
VeloCloud VeloBrain Link Metrics Collector

Fetches per-link quality metrics from VCO and stores them in the
`props` JSONB column of each edge row in the inventory table.

Metrics per link: scoreTx/Rx (0-5), latency ms, jitter ms, loss %,
bandwidth Rx/Tx bps, link state, plus provisioned capacity from
edge/getEdgeConfigurationStack (upstreamMbps, downstreamMbps, isp).
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

import httpx

from config.settings import get_settings
from shared.database.client import db

logger = logging.getLogger(__name__)

_HOUR_MS = 3_600_000
_CAP_CONCURRENCY = 10  # max parallel config-stack calls


class VelocloudMetricsCollector:
    def __init__(self):
        settings = get_settings()
        self._base_url = settings.velocloud_url.rstrip("/")
        self._api_key = settings.velocloud_api_key
        self._enabled = settings.velocloud_enabled
        self._headers = {
            "Authorization": f"Token {self._api_key}",
            "Content-Type": "application/json",
        }

    async def collect(self) -> int:
        """Fetch link metrics + provisioned capacity, upsert into inventory.props."""
        if not self._enabled or not self._api_key or not self._base_url:
            return 0

        async with httpx.AsyncClient(
            headers=self._headers,
            timeout=httpx.Timeout(60.0),
            follow_redirects=True,
            verify=False,
        ) as client:
            enterprise_id = await self._fetch_enterprise_id(client)
            if not enterprise_id:
                return 0
            metrics, edges = await asyncio.gather(
                self._fetch_link_metrics(client, enterprise_id),
                self._fetch_edges(client),
            )

            if not metrics:
                logger.info("VeloBrain: no link metrics returned")
                return 0

            # Build per-edge recentLinks lookup: logicalId → interface → cap dict
            # recentLinks.internalId joins to WAN config internalId for capacity data
            edge_iface_cap: Dict[str, Dict[str, Dict]] = {}
            for e in edges:
                lid = e.get("logicalId", "")
                if not lid:
                    continue
                iface_map: Dict[str, Dict] = {}
                for lnk in e.get("recentLinks") or []:
                    iface = lnk.get("interface", "")
                    if iface:
                        iface_map[iface] = {
                            "display_name": lnk.get("displayName") or iface,
                            "internal_id": lnk.get("internalId", ""),
                            "isp": lnk.get("isp", "") or "",
                            "public_ip": lnk.get("ipAddress", "") or "",
                        }
                edge_iface_cap[lid] = iface_map

            # Build logicalId → numeric edgeId map (for config-stack calls)
            logical_to_numeric = {
                e["logicalId"]: e["id"]
                for e in edges
                if e.get("logicalId") and e.get("id")
            }

            # Fetch provisioned capacity (by internalId) concurrently for all edges
            cap_by_internal_id = await self._fetch_all_capacity(
                client, enterprise_id, logical_to_numeric
            )

            # Group metrics by edgeLogicalId → list of link dicts
            edge_links: Dict[str, List[Dict[str, Any]]] = {}
            for m in metrics:
                eid = m.get("edgeLogicalId", "")
                if not eid:
                    continue
                iface = m.get("name", "")
                iface_info = edge_iface_cap.get(eid, {}).get(iface, {})
                internal_id = iface_info.get("internal_id", "")
                cap = cap_by_internal_id.get(internal_id, {}) if internal_id else {}

                display_name = iface_info.get("display_name") or iface
                edge_links.setdefault(eid, []).append({
                    "name": display_name,
                    "interface": iface,
                    "state": m.get("state", ""),
                    "score_tx": round(float(m.get("scoreTx") or 0), 2),
                    "score_rx": round(float(m.get("scoreRx") or 0), 2),
                    "latency_ms_rx": round(float(m.get("bestLatencyMsRx") or 0), 1),
                    "latency_ms_tx": round(float(m.get("bestLatencyMsTx") or 0), 1),
                    "jitter_ms_rx": round(float(m.get("bestJitterMsRx") or 0), 1),
                    "jitter_ms_tx": round(float(m.get("bestJitterMsTx") or 0), 1),
                    "loss_pct_rx": round(float(m.get("bestLossPctRx") or 0), 2),
                    "loss_pct_tx": round(float(m.get("bestLossPctTx") or 0), 2),
                    "bps_rx": int(m.get("bpsOfBestPathRx") or 0),
                    "bps_tx": int(m.get("bpsOfBestPathTx") or 0),
                    "avg_mbps_rx": round((int(m.get("bytesRx") or 0) * 8) / 3_600_000_000, 2),
                    "avg_mbps_tx": round((int(m.get("bytesTx") or 0) * 8) / 3_600_000_000, 2),
                    "upstream_mbps": cap.get("upstream_mbps"),
                    "downstream_mbps": cap.get("downstream_mbps"),
                    "isp": cap.get("isp") or iface_info.get("isp", "") or "",
                    "public_ip": iface_info.get("public_ip", "") or "",
                })

        updated = 0
        for edge_logical_id, links in edge_links.items():
            all_scores = [l["score_tx"] for l in links if l["score_tx"] > 0] + \
                         [l["score_rx"] for l in links if l["score_rx"] > 0]
            overall_score = round(min(all_scores), 2) if all_scores else 0.0
            props = {"links": links, "velobrain_score": overall_score}
            await db.execute(
                "UPDATE inventory SET props = $1::jsonb WHERE device_id = $2",
                json.dumps(props),
                edge_logical_id,
            )
            updated += 1

        logger.info("VeloBrain: updated metrics for %d edges (with capacity)", updated)
        return updated

    # ── VCO helpers ────────────────────────────────────────────────────────────

    async def _fetch_enterprise_id(self, client: httpx.AsyncClient) -> Optional[Any]:
        try:
            r = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterprise", json={}
            )
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                logger.error("VeloBrain enterprise error: %s", data["error"])
                return None
            return data.get("id")
        except Exception as exc:
            logger.error("VeloBrain: failed to get enterprise: %s", exc)
            return None

    async def _fetch_edges(self, client: httpx.AsyncClient) -> List[Dict]:
        try:
            r = await client.post(
                f"{self._base_url}/portal/rest/enterprise/getEnterpriseEdges",
                json={"with": ["recentLinks"]},
            )
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("VeloBrain: failed to fetch edges list: %s", exc)
            return []

    async def _fetch_link_metrics(
        self, client: httpx.AsyncClient, enterprise_id: Any
    ) -> List[Dict]:
        try:
            now_ms = int(time.time() * 1000)
            r = await client.post(
                f"{self._base_url}/portal/rest/monitoring/getAggregateEdgeLinkMetrics",
                json={
                    "enterpriseId": enterprise_id,
                    "interval": {"start": now_ms - _HOUR_MS, "end": now_ms},
                },
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and "error" in data:
                logger.error("VeloBrain metrics error: %s", data["error"])
                return []
            return data if isinstance(data, list) else []
        except Exception as exc:
            logger.error("VeloBrain: failed to fetch link metrics: %s", exc)
            return []

    async def _fetch_all_capacity(
        self,
        client: httpx.AsyncClient,
        enterprise_id: Any,
        logical_to_numeric: Dict[str, int],
    ) -> Dict[str, Dict]:
        """Fetch WAN capacity concurrently. Returns internalId → {upstream_mbps, downstream_mbps, isp}."""
        if not logical_to_numeric:
            return {}

        all_caps: Dict[str, Dict] = {}
        sem = asyncio.Semaphore(_CAP_CONCURRENCY)

        async def fetch_one(edge_id: int) -> None:
            async with sem:
                try:
                    r = await client.post(
                        f"{self._base_url}/portal/rest/edge/getEdgeConfigurationStack",
                        json={"enterpriseId": enterprise_id, "edgeId": edge_id},
                    )
                    r.raise_for_status()
                    for cfg in r.json():
                        for mod in cfg.get("modules", []):
                            if mod.get("name") == "WAN":
                                for lnk in (mod.get("data") or {}).get("links", []):
                                    internal_id = lnk.get("internalId", "")
                                    if not internal_id or internal_id in all_caps:
                                        continue
                                    upstream = lnk.get("upstreamMbps")
                                    downstream = lnk.get("downstreamMbps")
                                    all_caps[internal_id] = {
                                        "upstream_mbps": float(upstream) if upstream else None,
                                        "downstream_mbps": float(downstream) if downstream else None,
                                        "isp": lnk.get("isp", "") or "",
                                    }
                except Exception as exc:
                    logger.debug("Capacity fetch skipped for edge %s: %s", edge_id, exc)

        await asyncio.gather(*[fetch_one(eid) for eid in logical_to_numeric.values()])
        logger.info("VeloBrain: fetched capacity for %d WAN links across all edges", len(all_caps))
        return all_caps
