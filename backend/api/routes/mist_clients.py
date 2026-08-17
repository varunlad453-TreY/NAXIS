"""Mist card API — client 1:1 timeline (Feature 8, live pass-through)."""

import asyncio
import csv
import io
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import StreamingResponse

try:
    from backend.shared.cache import cached_api_route
except ImportError:
    from shared.cache import cached_api_route

from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mist/clients", tags=["mist"])

_MAC_RE = re.compile(r"^[0-9a-fA-F]{12}$")
_MIST_CONCURRENCY = 8
_CACHE_TTL_S = 60
_MAX_WINDOW_S = 7 * 24 * 3600

_cache: Dict[Tuple[str, int, int], Tuple[float, Dict[str, Any]]] = {}


def _normalize_mac(mac: str) -> str:
    clean = re.sub(r"[^0-9a-fA-F]", "", mac).lower()
    if not _MAC_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"Invalid MAC: {mac}")
    return clean


def _to_epoch(dt: Optional[datetime]) -> Optional[int]:
    return int(dt.timestamp()) if dt else None


def _resolve_window(since: Optional[datetime], until: Optional[datetime]) -> Tuple[int, int]:
    now = int(time.time())
    end = _to_epoch(until) or now
    start = _to_epoch(since) or (end - 24 * 3600)
    if end <= start:
        raise HTTPException(status_code=400, detail="until must be after since")
    if end - start > _MAX_WINDOW_S:
        raise HTTPException(status_code=400, detail=f"window exceeds {_MAX_WINDOW_S // 3600}h limit")
    return start, end


class MistClient:
    def __init__(self):
        s = get_settings()
        self._org_id = s.mist_org_id
        self._base = s.mist_base_url.rstrip("/")
        self._headers = {"Authorization": f"Token {s.mist_api_key}"}
        self._enabled = s.mist_enabled and bool(s.mist_api_key) and bool(s.mist_org_id)
        self._sem = asyncio.Semaphore(_MIST_CONCURRENCY)

    def enabled(self) -> bool:
        return self._enabled

    async def _get(self, client: httpx.AsyncClient, path: str, params: Optional[Dict] = None) -> Any:
        async with self._sem:
            resp = await client.get(f"{self._base}{path}", params=params or {})
            if resp.status_code == 429:
                raise HTTPException(status_code=429, detail="Mist rate limit hit — retry shortly")
            resp.raise_for_status()
            return resp.json()

    async def org_sites_for_mac(self, client: httpx.AsyncClient, mac: str, start: int, end: int) -> List[str]:
        """Find every site that saw this MAC — union of sessions, events, current."""
        seen: set[str] = set()

        async def collect(path: str, params: Dict) -> None:
            try:
                data = await self._get(client, path, params)
            except Exception as e:
                logger.debug("%s failed: %s", path, e)
                return
            results = data if isinstance(data, list) else (data.get("results", []) or [])
            for r in results:
                for sid in (r.get("site_ids") or []) or ([r.get("site_id")] if r.get("site_id") else []):
                    if sid:
                        seen.add(sid)

        await asyncio.gather(
            collect(
                f"/api/v1/orgs/{self._org_id}/clients/sessions/search",
                {"mac": mac, "start": start, "end": end, "limit": 1000},
            ),
            collect(
                f"/api/v1/orgs/{self._org_id}/clients/events/search",
                {"mac": mac, "start": start, "end": end, "limit": 1000},
            ),
            collect(
                f"/api/v1/orgs/{self._org_id}/clients/search",
                {"mac": mac, "start": start, "end": end, "limit": 1000},
            ),
        )
        return sorted(seen)

    async def site_meta(self, client: httpx.AsyncClient) -> Dict[str, str]:
        try:
            data = await self._get(client, f"/api/v1/orgs/{self._org_id}/sites")
            return {s["id"]: s["name"] for s in data}
        except Exception as e:
            logger.warning("Mist sites fetch failed: %s", e)
            return {}

    async def site_events(self, client: httpx.AsyncClient, site_id: str, mac: str, start: int, end: int) -> List[Dict]:
        try:
            data = await self._get(
                client,
                f"/api/v1/sites/{site_id}/clients/events/search",
                {"mac": mac, "start": start, "end": end, "limit": 1000},
            )
            return data if isinstance(data, list) else data.get("results", []) or []
        except Exception as e:
            logger.debug("events failed site=%s mac=%s: %s", site_id, mac, e)
            return []

    async def site_sessions(self, client: httpx.AsyncClient, site_id: str, mac: str, start: int, end: int) -> List[Dict]:
        try:
            data = await self._get(
                client,
                f"/api/v1/sites/{site_id}/clients/sessions/search",
                {"mac": mac, "start": start, "end": end, "limit": 1000},
            )
            return data if isinstance(data, list) else data.get("results", []) or []
        except Exception as e:
            logger.debug("sessions failed site=%s mac=%s: %s", site_id, mac, e)
            return []

    async def site_current(self, client: httpx.AsyncClient, site_id: str, mac: str) -> Optional[Dict]:
        try:
            data = await self._get(
                client,
                f"/api/v1/sites/{site_id}/clients/search",
                {"mac": mac, "limit": 1},
            )
            results = data.get("results", []) if isinstance(data, dict) else []
            return results[0] if results else None
        except Exception:
            return None


def _epoch_to_iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    try:
        f = float(v)
        if f > 1e12:  # ms
            f /= 1000
        return datetime.fromtimestamp(f, tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _shape_current(raw: Optional[Dict], site_name: str = "") -> Optional[Dict]:
    if not raw:
        return None
    return {
        "site_id":         raw.get("site_id"),
        "site_name":       site_name,
        "ap":              raw.get("ap_mac") or raw.get("ap") or raw.get("last_ap"),
        "ssid":            raw.get("ssid"),
        "band":            raw.get("band"),
        "connected_since": _epoch_to_iso(
            raw.get("since") or raw.get("assoc_time") or raw.get("last_seen")
        ),
        "rssi":            raw.get("rssi"),
        "hostname":        raw.get("hostname"),
        "ip":              raw.get("ip"),
    }


def _shape_session(raw: Dict, site_name: str) -> Dict:
    dur = raw.get("duration")
    start = raw.get("connect") or raw.get("start") or raw.get("timestamp")
    end = raw.get("disconnect") or raw.get("end")
    if dur is None and start and end:
        try:
            dur = int(float(end) - float(start))
        except (TypeError, ValueError):
            dur = None
    return {
        "site_id":            raw.get("site_id"),
        "site_name":          site_name,
        "ap":                 raw.get("ap_mac") or raw.get("ap"),
        "ssid":               raw.get("ssid"),
        "band":               raw.get("band"),
        "started":            _epoch_to_iso(start),
        "ended":              _epoch_to_iso(end),
        "duration_s":         dur,
        "disconnect_reason":  raw.get("termination_reason") or raw.get("disconnect_reason"),
    }


def _shape_event(raw: Dict, site_name: str) -> Dict:
    return {
        "ts":        _epoch_to_iso(raw.get("timestamp") or raw.get("time")),
        "site_id":   raw.get("site_id"),
        "site_name": site_name,
        "ap":        raw.get("ap_mac") or raw.get("ap"),
        "type":      raw.get("type") or raw.get("event_type"),
        "ssid":      raw.get("ssid"),
        "band":      raw.get("band"),
        "detail":    raw.get("text") or raw.get("reason") or raw.get("detail"),
    }


async def _build_timeline(mac: str, start: int, end: int) -> Dict[str, Any]:
    mc = MistClient()
    if not mc.enabled():
        raise HTTPException(status_code=503, detail="Mist integration not configured")

    async with httpx.AsyncClient(headers=mc._headers, timeout=httpx.Timeout(30.0)) as client:
        sites, site_map = await asyncio.gather(
            mc.org_sites_for_mac(client, mac, start, end),
            mc.site_meta(client),
        )
        if not sites:
            return {
                "mac": mac,
                "window": {"since": _epoch_to_iso(start), "until": _epoch_to_iso(end)},
                "current": None,
                "sessions": [],
                "events": [],
                "sites_seen": [],
            }

        async def per_site(site_id: str) -> Tuple[str, List[Dict], List[Dict], Optional[Dict]]:
            events, sessions, current = await asyncio.gather(
                mc.site_events(client, site_id, mac, start, end),
                mc.site_sessions(client, site_id, mac, start, end),
                mc.site_current(client, site_id, mac),
            )
            return site_id, events, sessions, current

        per_site_results = await asyncio.gather(*[per_site(sid) for sid in sites])

    all_events: List[Dict] = []
    all_sessions: List[Dict] = []
    sites_seen: List[Dict] = []
    current: Optional[Dict] = None
    current_ts: float = -1

    for site_id, events, sessions, cur in per_site_results:
        name = site_map.get(site_id, site_id[:8])
        shaped_events = [_shape_event(e, name) | {"site_id": site_id} for e in events]
        shaped_sessions = [_shape_session(s, name) | {"site_id": site_id} for s in sessions]
        all_events.extend(shaped_events)
        all_sessions.extend(shaped_sessions)

        timestamps = [
            t for t in (
                [e.get("ts") for e in shaped_events]
                + [s.get("started") for s in shaped_sessions]
                + [s.get("ended") for s in shaped_sessions]
            ) if t
        ]
        if timestamps:
            sites_seen.append({
                "site_id":    site_id,
                "site_name":  name,
                "first_seen": min(timestamps),
                "last_seen":  max(timestamps),
            })

        if cur:
            assoc = cur.get("last_seen") or cur.get("since") or cur.get("assoc_time") or 0
            try:
                assoc_f = float(assoc)
            except (TypeError, ValueError):
                assoc_f = 0
            if assoc_f > current_ts:
                current = _shape_current(cur | {"site_id": site_id}, name)
                current_ts = assoc_f
                if not any(s["site_id"] == site_id for s in sites_seen):
                    iso = _epoch_to_iso(assoc_f) or ""
                    if iso:
                        sites_seen.append({
                            "site_id": site_id,
                            "site_name": name,
                            "first_seen": iso,
                            "last_seen": iso,
                        })

    all_events.sort(key=lambda e: e.get("ts") or "", reverse=True)
    all_sessions.sort(key=lambda s: s.get("started") or "", reverse=True)
    sites_seen.sort(key=lambda s: s["last_seen"], reverse=True)

    return {
        "mac": mac,
        "window": {"since": _epoch_to_iso(start), "until": _epoch_to_iso(end)},
        "current": current,
        "sessions": all_sessions,
        "events": all_events,
        "sites_seen": sites_seen,
    }


@router.get("/{mac}/timeline")
@cached_api_route(ttl_seconds=_CACHE_TTL_S, key_prefix="mist_client_timeline")
async def get_client_timeline(
    mac: str,
    response: Response,
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
) -> Dict[str, Any]:
    normalized = _normalize_mac(mac)
    start, end = _resolve_window(since, until)
    return await _build_timeline(normalized, start, end)


_CSV_COLS = ["ts", "kind", "site_name", "ap", "ssid", "band", "detail", "duration_s", "ended"]


def _csv_stream(timeline: Dict[str, Any]):
    def gen():
        buf = io.StringIO()
        w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
        w.writerow(_CSV_COLS)
        yield buf.getvalue(); buf.seek(0); buf.truncate()

        for s in timeline.get("sessions", []):
            w.writerow([
                s.get("started") or "",
                "session",
                s.get("site_name") or "",
                s.get("ap") or "",
                s.get("ssid") or "",
                s.get("band") or "",
                s.get("disconnect_reason") or "",
                s.get("duration_s") or "",
                s.get("ended") or "",
            ])
            yield buf.getvalue(); buf.seek(0); buf.truncate()

        for e in timeline.get("events", []):
            w.writerow([
                e.get("ts") or "",
                f"event:{e.get('type') or ''}",
                e.get("site_name") or "",
                e.get("ap") or "",
                e.get("ssid") or "",
                e.get("band") or "",
                e.get("detail") or "",
                "",
                "",
            ])
            yield buf.getvalue(); buf.seek(0); buf.truncate()
    return gen()


@router.get("/{mac}/timeline.csv")
async def get_client_timeline_csv(
    mac: str,
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
) -> StreamingResponse:
    normalized = _normalize_mac(mac)
    start, end = _resolve_window(since, until)
    data = await _get_timeline_cached(normalized, start, end)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    filename = f"naxis-mist-client-{normalized}-{stamp}.csv"
    return StreamingResponse(
        _csv_stream(data),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
