"""Mist SLE Anomaly Ranking — Feature 9 (live pass-through)."""

import csv
import io
import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mist/sle", tags=["mist"])

_CACHE_TTL_S = 300
_cache: Dict[Tuple[int, int], Tuple[float, List[Dict[str, Any]]]] = {}

_SLE_KEYS = [
    "successful-connect",
    "throughput",
    "coverage",
    "capacity",
    "roaming",
    "time-to-connect",
    "ap-health",
    "ap-redundancy",
]

_CSV_COLS = [
    "site_id", "site_name", "sle", "current", "org_mean",
    "org_sd", "z_score", "delta_pct", "num_aps", "num_clients",
]


class _MistSLE:
    def __init__(self):
        s = get_settings()
        self._org_id = s.mist_org_id
        self._base = s.mist_base_url.rstrip("/")
        self._headers = {"Authorization": f"Token {s.mist_api_key}"}
        self._enabled = s.mist_enabled and bool(s.mist_api_key) and bool(s.mist_org_id)

    def enabled(self) -> bool:
        return self._enabled

    async def fetch_sites_sle(self, client: httpx.AsyncClient, start: int, end: int) -> List[Dict]:
        resp = await client.get(
            f"{self._base}/api/v1/orgs/{self._org_id}/insights/sites-sle",
            params={"page": 1, "limit": 1000, "start": start, "end": end},
        )
        if resp.status_code == 429:
            raise HTTPException(status_code=429, detail="Mist rate limit — retry shortly")
        resp.raise_for_status()
        return resp.json().get("results", [])

    async def fetch_site_map(self, client: httpx.AsyncClient) -> Dict[str, str]:
        try:
            resp = await client.get(f"{self._base}/api/v1/orgs/{self._org_id}/sites")
            resp.raise_for_status()
            return {s["id"]: s["name"] for s in resp.json()}
        except Exception as e:
            logger.warning("site map fetch failed: %s", e)
            return {}


def _z_scores(rows: List[Dict], sle_key: str) -> List[Dict[str, Any]]:
    """Compute z-score for one SLE key across all sites."""
    vals = [r[sle_key] for r in rows if sle_key in r]
    if len(vals) < 2:
        return []
    mean = sum(vals) / len(vals)
    variance = sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)
    sd = math.sqrt(variance) if variance > 0 else 0.0

    out = []
    for r in rows:
        if sle_key not in r:
            continue
        cur = r[sle_key]
        z = (cur - mean) / sd if sd > 0 else 0.0
        out.append({
            "site_id":    r["site_id"],
            "sle":        sle_key,
            "current":    cur,
            "org_mean":   mean,
            "org_sd":     sd,
            "z_score":    z,
            "delta_pct":  round((cur - mean) * 100, 1),
            "num_aps":    r.get("num_aps", 0),
            "num_clients": r.get("num_clients", 0),
        })
    return out


async def _build_anomalies(start: int, end: int, limit: int) -> List[Dict[str, Any]]:
    mc = _MistSLE()
    if not mc.enabled():
        raise HTTPException(status_code=503, detail="Mist integration not configured")

    async with httpx.AsyncClient(headers=mc._headers, timeout=httpx.Timeout(30.0)) as client:
        import asyncio
        rows, site_map = await asyncio.gather(
            mc.fetch_sites_sle(client, start, end),
            mc.fetch_site_map(client),
        )

    all_entries: List[Dict[str, Any]] = []
    for sle_key in _SLE_KEYS:
        for entry in _z_scores(rows, sle_key):
            entry["site_name"] = site_map.get(entry["site_id"], entry["site_id"][:8])
            all_entries.append(entry)

    all_entries.sort(key=lambda e: e["z_score"])
    return all_entries[:limit]


async def _get_cached(start: int, end: int, limit: int) -> List[Dict[str, Any]]:
    key = (start, end)
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < _CACHE_TTL_S:
        data = hit[1]
    else:
        data = await _build_anomalies(start, end, 1000)
        _cache[key] = (now, data)
        if len(_cache) > 64:
            for k in [k for k, v in _cache.items() if now - v[0] > _CACHE_TTL_S]:
                _cache.pop(k, None)
    return data[:limit]


def _window(hours: int) -> Tuple[int, int]:
    end = int(time.time())
    return end - hours * 3600, end


@router.get("/anomalies")
async def get_sle_anomalies(
    window: int = Query(default=24, description="Look-back window in hours (1–168)"),
    limit: int = Query(default=20, ge=1, le=200),
    sle: Optional[str] = Query(default=None, description="Filter to one SLE key"),
    z_threshold: float = Query(default=-1.0, description="Only return entries with z_score <= this"),
) -> Dict[str, Any]:
    if window < 1 or window > 168:
        raise HTTPException(status_code=400, detail="window must be 1–168 hours")
    start, end = _window(window)
    data = await _get_cached(start, end, limit * 10)
    if sle:
        data = [d for d in data if d["sle"] == sle]
    data = [d for d in data if d["z_score"] <= z_threshold]
    return {
        "window_hours": window,
        "count": len(data[:limit]),
        "anomalies": data[:limit],
    }


@router.get("/anomalies.csv")
async def get_sle_anomalies_csv(
    window: int = Query(default=24),
    limit: int = Query(default=200, ge=1, le=1000),
    sle: Optional[str] = Query(default=None),
    z_threshold: float = Query(default=-1.0),
) -> StreamingResponse:
    if window < 1 or window > 168:
        raise HTTPException(status_code=400, detail="window must be 1–168 hours")
    start, end = _window(window)
    data = await _get_cached(start, end, limit * 10)
    if sle:
        data = [d for d in data if d["sle"] == sle]
    data = [d for d in data if d["z_score"] <= z_threshold][:limit]

    def gen():
        buf = io.StringIO()
        w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
        w.writerow(_CSV_COLS)
        yield buf.getvalue(); buf.seek(0); buf.truncate()
        for e in data:
            w.writerow([
                e["site_id"], e["site_name"], e["sle"],
                f"{e['current']:.4f}", f"{e['org_mean']:.4f}",
                f"{e['org_sd']:.4f}", f"{e['z_score']:.3f}",
                e["delta_pct"], e["num_aps"], e["num_clients"],
            ])
            yield buf.getvalue(); buf.seek(0); buf.truncate()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        gen(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="naxis-mist-sle-{stamp}.csv"'},
    )
