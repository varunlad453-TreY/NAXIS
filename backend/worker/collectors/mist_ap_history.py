"""
Diff-on-write append for the mist_ap_history ledger.

Compares each poll snapshot against the latest history row for the same serial.
Writes a new row only when firmware, site, hostname, model, reachability, or
uptime (decrease = reboot) changes. First sighting always writes.
"""

import json
import logging
from typing import Any, Dict, List

from shared.database.client import db

logger = logging.getLogger(__name__)

_TRACKED_FIELDS = ("firmware", "site_id", "hostname", "model", "reachability")


def _to_snapshot(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "mist_ap_id":   row["device_id"],
        "serial":       row.get("serial", "") or "",
        "mac":          row.get("mac", "") or "",
        "hostname":     row.get("hostname", "") or "",
        "model":        row.get("model", "") or "",
        "site_id":      row.get("site_id", "") or "",
        "site_name":    row.get("site_name", "") or "",
        "firmware":     row.get("firmware_version", "") or "",
        "reachability": row.get("reachability", "unknown"),
        "uptime_s":     int(row.get("uptime_seconds", 0) or 0),
    }


def _has_meaningful_change(prev: Dict[str, Any], cur: Dict[str, Any]) -> bool:
    for f in _TRACKED_FIELDS:
        if (prev.get(f) or "") != (cur.get(f) or ""):
            return True
    if cur["uptime_s"] > 0 and cur["uptime_s"] < (prev.get("uptime_s") or 0):
        return True
    return False


async def record_snapshots(inventory_rows: List[Dict[str, Any]]) -> int:
    """
    For each Mist AP row, append a history row if its state has changed
    versus the last history entry for that serial. Returns rows written.
    """
    if not inventory_rows:
        return 0

    snapshots = [_to_snapshot(r) for r in inventory_rows if r.get("serial")]
    if not snapshots:
        return 0

    serials = [s["serial"] for s in snapshots]
    latest = await db.fetch(
        """
        SELECT DISTINCT ON (serial)
               serial, mist_ap_id, mac, hostname, model, site_id, site_name,
               firmware, reachability, uptime_s
        FROM mist_ap_history
        WHERE serial = ANY($1::text[])
        ORDER BY serial, observed_at DESC
        """,
        serials,
    )
    latest_by_serial: Dict[str, Dict[str, Any]] = {r["serial"]: dict(r) for r in latest}

    to_write: List[Dict[str, Any]] = []
    for cur in snapshots:
        prev = latest_by_serial.get(cur["serial"])
        if prev is None or _has_meaningful_change(prev, cur):
            to_write.append(cur)

    if not to_write:
        return 0

    await db.executemany(
        """
        INSERT INTO mist_ap_history (
            mist_ap_id, serial, mac, hostname, model,
            site_id, site_name, firmware, reachability, uptime_s, raw
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        """,
        [
            (
                s["mist_ap_id"], s["serial"], s["mac"], s["hostname"], s["model"],
                s["site_id"], s["site_name"], s["firmware"], s["reachability"],
                s["uptime_s"], json.dumps(s),
            )
            for s in to_write
        ],
    )
    logger.info("mist_ap_history: appended %d rows", len(to_write))
    return len(to_write)
