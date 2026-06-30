"""
VeloCloud VeloBrain Link Metrics Collector

Fetches per-link quality metrics from VCO and stores them in the
`props` JSONB column of each edge row in the inventory table.

Metrics per link: scoreTx/Rx (0-5), latency ms, jitter ms, loss %,
bandwidth Rx/Tx bps, link state.
"""

import logging
import time
from typing import Any, Dict, List

import httpx

from config.settings import get_settings
from shared.database.client import db

logger = logging.getLogger(__name__)

_HOUR_MS = 3_600_000


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
        """Fetch link metrics and upsert into inventory.props. Returns edge count updated."""
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
            metrics = await self._fetch_link_metrics(client, enterprise_id)

        # Group by edgeLogicalId → list of link dicts
        edge_links: Dict[str, List[Dict[str, Any]]] = {}
        for m in metrics:
            eid = m.get("edgeLogicalId", "")
            if not eid:
                continue
            link = m.get("link") or {}
            edge_links.setdefault(eid, []).append({
                "name": m.get("name", "") or link.get("displayName", ""),
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
            })

        if not edge_links:
            logger.info("VeloBrain: no link metrics returned")
            return 0

        updated = 0
        for edge_logical_id, links in edge_links.items():
            # Compute overall score = min of all link scores (worst determines quality)
            all_scores = [l["score_tx"] for l in links if l["score_tx"] > 0] + \
                         [l["score_rx"] for l in links if l["score_rx"] > 0]
            overall_score = round(min(all_scores), 2) if all_scores else 0.0

            props = {"links": links, "velobrain_score": overall_score}
            import json
            await db.execute(
                "UPDATE inventory SET props = $1::jsonb WHERE device_id = $2",
                json.dumps(props),
                edge_logical_id,
            )
            updated += 1

        logger.info("VeloBrain: updated metrics for %d edges", updated)
        return updated

    async def _fetch_enterprise_id(self, client: httpx.AsyncClient) -> Any:
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
