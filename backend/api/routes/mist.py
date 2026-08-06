"""Mist card API — AP lifecycle ledger (Feature 5)."""

import csv
import io
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import StreamingResponse

try:
    from backend.shared.cache import cached_api_route
except ImportError:
    from shared.cache import cached_api_route

from shared.database.client import db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/mist",
    tags=["mist"],
    responses={500: {"description": "Internal server error"}},
)

_TRACKED = ("firmware", "site_id", "hostname", "model", "reachability")

_HISTORY_COLS = [
    "observed_at", "event", "field", "from_value", "to_value",
    "site_name", "hostname", "firmware", "reachability", "uptime_s",
]


async def _fetch_snapshots(serial: str) -> List[Dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT observed_at, mist_ap_id, serial, mac, hostname, model,
               site_id, site_name, firmware, reachability, uptime_s
        FROM mist_ap_history
        WHERE serial = $1
        ORDER BY observed_at ASC
        """,
        serial,
    )
    return [dict(r) for r in rows]


def _derive_events(snapshots: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for i, cur in enumerate(snapshots):
        if i == 0:
            events.append({
                "observed_at": cur["observed_at"],
                "event": "first_seen",
                "field": None,
                "from_value": None,
                "to_value": None,
                "site_name": cur["site_name"],
                "hostname": cur["hostname"],
                "firmware": cur["firmware"],
                "reachability": cur["reachability"],
                "uptime_s": cur["uptime_s"],
            })
            continue

        prev = snapshots[i - 1]
        for f in _TRACKED:
            if (prev.get(f) or "") != (cur.get(f) or ""):
                event_type = {
                    "firmware":     "firmware_change",
                    "site_id":      "site_move",
                    "hostname":     "rename",
                    "model":        "hardware_replaced",
                    "reachability": "reachability",
                }[f]
                from_val = prev.get("site_name") if f == "site_id" else prev.get(f)
                to_val   = cur.get("site_name")  if f == "site_id" else cur.get(f)
                events.append({
                    "observed_at": cur["observed_at"],
                    "event": event_type,
                    "field": f,
                    "from_value": from_val,
                    "to_value":   to_val,
                    "site_name": cur["site_name"],
                    "hostname": cur["hostname"],
                    "firmware": cur["firmware"],
                    "reachability": cur["reachability"],
                    "uptime_s": cur["uptime_s"],
                })

        if cur["uptime_s"] > 0 and cur["uptime_s"] < (prev.get("uptime_s") or 0):
            events.append({
                "observed_at": cur["observed_at"],
                "event": "reboot",
                "field": "uptime_s",
                "from_value": prev.get("uptime_s"),
                "to_value":   cur["uptime_s"],
                "site_name": cur["site_name"],
                "hostname": cur["hostname"],
                "firmware": cur["firmware"],
                "reachability": cur["reachability"],
                "uptime_s": cur["uptime_s"],
            })

    events.sort(key=lambda e: e["observed_at"], reverse=True)
    return events


@router.get("/aps/{serial}/history")
@cached_api_route(ttl_seconds=60, key_prefix="mist_ap_history")
async def get_ap_history(
    serial: str,
    response: Response,
    event: Optional[str] = Query(None, description="Filter by event type"),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
) -> Dict[str, Any]:
    snapshots = await _fetch_snapshots(serial)
    if not snapshots:
        raise HTTPException(status_code=404, detail=f"No history for serial {serial}")

    events = _derive_events(snapshots)
    if event:
        events = [e for e in events if e["event"] == event]
    if since:
        events = [e for e in events if e["observed_at"] >= since]
    if until:
        events = [e for e in events if e["observed_at"] <= until]

    return {
        "serial": serial,
        "count": len(events),
        "events": [
            {**e, "observed_at": e["observed_at"].isoformat()} for e in events
        ],
    }


def _csv_stream(events: List[Dict[str, Any]]):
    def gen():
        buf = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
        writer.writerow(_HISTORY_COLS)
        yield buf.getvalue()
        buf.seek(0); buf.truncate()
        for e in events:
            writer.writerow([
                e["observed_at"].isoformat() if hasattr(e["observed_at"], "isoformat") else e["observed_at"],
                e["event"],
                e.get("field") or "",
                "" if e.get("from_value") is None else e["from_value"],
                "" if e.get("to_value")   is None else e["to_value"],
                e.get("site_name") or "",
                e.get("hostname") or "",
                e.get("firmware") or "",
                e.get("reachability") or "",
                e.get("uptime_s") or 0,
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate()
    return gen()


@router.get("/aps/{serial}/history.csv")
async def get_ap_history_csv(
    serial: str,
    event: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
) -> StreamingResponse:
    snapshots = await _fetch_snapshots(serial)
    if not snapshots:
        raise HTTPException(status_code=404, detail=f"No history for serial {serial}")

    events = _derive_events(snapshots)
    if event:
        events = [e for e in events if e["event"] == event]
    if since:
        events = [e for e in events if e["observed_at"] >= since]
    if until:
        events = [e for e in events if e["observed_at"] <= until]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    filename = f"naxis-mist-ap-history-{serial}-{stamp}.csv"
    return StreamingResponse(
        _csv_stream(events),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
