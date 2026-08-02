"""
Diff-on-write append for the mist_ap_history ledger.

Compares each poll snapshot against the latest history row for the same
device key (serial, falling back to MAC) and appends a row only when a
meaningful field changed (firmware, site, hostname, model, reachability,
or uptime decrease = reboot). First sighting always writes.

Also computes *reachability transitions*: the ledger is the source of
truth the AP history collector uses to emit events only when a device
actually flips state — reachable -> unreachable (outage) or
unreachable -> reachable (recovery) — instead of emitting a CRITICAL
event for every disconnected AP on every poll.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from shared.database.client import db

logger = logging.getLogger(__name__)

_TRACKED_FIELDS = ("firmware", "site_id", "hostname", "model", "reachability")


def _to_snapshot(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a poll row into the ledger snapshot shape."""
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


def _snapshot_key(snapshot: Dict[str, Any]) -> str:
    """Ledger identity: serial when present, else MAC."""
    return snapshot.get("serial") or snapshot.get("mac") or ""


def _has_meaningful_change(prev: Dict[str, Any], cur: Dict[str, Any]) -> bool:
    for f in _TRACKED_FIELDS:
        if (prev.get(f) or "") != (cur.get(f) or ""):
            return True
    if cur["uptime_s"] > 0 and cur["uptime_s"] < (prev.get("uptime_s") or 0):
        return True
    return False


async def record_snapshots(inventory_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Append changed snapshots to the ledger.

    Args:
        inventory_rows: Poll rows shaped like mist_inventory._build_rows
            (device_id, serial, mac, hostname, model, site_id, site_name,
            firmware_version, reachability, uptime_seconds).

    Returns:
        List of reachability transition records for snapshots whose
        reachability changed versus the last ledger row (or first
        sighting), each shaped as::

            {
                "snapshot": {...},
                "prev_reachability": "reachable" | "unreachable" | None,
                "cur_reachability":  "reachable" | "unreachable",
            }

        The collector turns these into outage / recovery events. Rows
        written to the ledger for non-reachability changes (firmware,
        reboot) are recorded but produce no transition.
    """
    if not inventory_rows:
        return []

    snapshots = [_to_snapshot(r) for r in inventory_rows]
    snapshots = [s for s in snapshots if _snapshot_key(s)]
    if not snapshots:
        return []

    keys = [_snapshot_key(s) for s in snapshots]
    latest = await db.fetch(
        """
        SELECT DISTINCT ON (serial)
               serial, mist_ap_id, mac, hostname, model, site_id, site_name,
               firmware, reachability, uptime_s
        FROM mist_ap_history
        WHERE serial = ANY($1::text[])
        ORDER BY serial, observed_at DESC
        """,
        keys,
    )
    latest_by_key: Dict[str, Dict[str, Any]] = {_snapshot_key(dict(r)): dict(r) for r in latest}

    to_write: List[Dict[str, Any]] = []
    transitions: List[Dict[str, Any]] = []
    for cur in snapshots:
        key = _snapshot_key(cur)
        prev = latest_by_key.get(key)
        prev_reachability = prev.get("reachability") if prev else None

        if prev is None or _has_meaningful_change(prev, cur):
            to_write.append(cur)

        if prev_reachability != cur["reachability"]:
            transitions.append({
                "snapshot": cur,
                "prev_reachability": prev_reachability,
                "cur_reachability": cur["reachability"],
            })

    if not to_write:
        logger.debug("mist_ap_history: no changes across %d devices", len(snapshots))
        return transitions

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
    logger.info(
        "mist_ap_history: appended %d rows, %d reachability transitions",
        len(to_write),
        len(transitions),
    )
    return transitions
