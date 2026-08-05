"""
Health Snapshot Collector

Periodically records per-node health status snapshots to the
node_health_snapshots table so the UI can render health history timelines.

Runs alongside the existing collector fleet (every 5 min).
Only writes a new row when the health status actually changes from the
last known snapshot, or if it's been >24h since the last write (heartbeat).
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from shared.database.client import db
from shared.database.health_history import (
    get_latest_snapshot,
    record_health_snapshots_batch,
)
from shared.health import (
    compute_node_health,
)

logger = logging.getLogger(__name__)

_CANONICAL_KEYS_QUERY = """
    SELECT node_id, COALESCE(NULLIF(canonical_key, ''), node_id) AS canonical_key
    FROM topology_nodes
    WHERE node_id = ANY($1::text[])
"""

_HEALTH_EVENTS_QUERY = """
    SELECT e.device_id, e.severity, MAX(e.timestamp) AS latest_at
    FROM events e
    JOIN topology_nodes tn ON tn.canonical_key = e.device_id
    WHERE tn.node_id = ANY($1::text[])
      AND e.timestamp > NOW() - INTERVAL '15 minutes'
      AND e.severity IN ('critical', 'major')
    GROUP BY e.device_id, e.severity
    ORDER BY e.device_id, e.severity DESC
"""

_HEALTH_INVENTORY_QUERY = """
    SELECT tn.node_id, i.reachability
    FROM inventory i
    JOIN topology_nodes tn ON tn.canonical_key = i.device_id
    WHERE tn.node_id = ANY($1::text[])
"""

_HEALTH_NODE_PROPS_QUERY = """
    SELECT node_id, props->>'reachability' AS reachability,
           (props->>'connected')::boolean AS connected
    FROM topology_nodes
    WHERE node_id = ANY($1::text[])
      AND props IS NOT NULL
      AND props != '{}'::jsonb
"""

_NODES_QUERY = """
    SELECT node_id, name, node_type
    FROM topology_nodes
    ORDER BY node_id
"""


async def collect_health_snapshots() -> Dict[str, Any]:
    """
    Main entry point. Computes health for all topology nodes and records
    snapshots for any node where health has changed or heartbeat is due.

    Returns a summary dict with counts of nodes checked, changed, etc.
    """
    if not db.pool:
        return {"error": "No database connection", "checked": 0, "changed": 0}

    try:
        node_rows = await db.fetch(_NODES_QUERY)
        if not node_rows:
            return {"checked": 0, "changed": 0, "message": "No topology nodes found"}

        all_node_ids = [r["node_id"] for r in node_rows]

        # Resolve canonical keys from topology_nodes so we look up events and
        # inventory by the canonical device_key — not a heuristic prefix strip.
        # This fixes SNMP nodes where the raw node_id ("snmp-x-x-x-x") has no
        # relationship to the canonical UUID stored in events.device_id.
        canonical_rows = await db.fetch(_CANONICAL_KEYS_QUERY, all_node_ids)
        device_map: Dict[str, str] = {
            row["node_id"]: row["canonical_key"] for row in canonical_rows
        }
        unique_node_ids = list({r["node_id"] for r in canonical_rows})
        if not unique_node_ids:
            return {"checked": len(all_node_ids), "changed": 0, "message": "No device IDs to query"}

        # Fetch health signals using node_id (resolved to canonical key via join above)
        event_rows = await db.fetch(_HEALTH_EVENTS_QUERY, unique_node_ids)
        worst_severity: Dict[str, str] = {}
        for row in event_rows:
            can_key = row["device_id"]
            sev = row["severity"]
            existing = worst_severity.get(can_key)
            if existing is None or (sev == "critical" and existing != "critical"):
                worst_severity[can_key] = sev

        inventory_rows = await db.fetch(_HEALTH_INVENTORY_QUERY, unique_node_ids)
        inv_reachability: Dict[str, str] = {}
        for row in inventory_rows:
            inv_reachability[row["node_id"]] = row["reachability"]

        props_rows = await db.fetch(_HEALTH_NODE_PROPS_QUERY, all_node_ids)
        props_reachability: Dict[str, Optional[str]] = {}
        props_connected: Dict[str, Optional[bool]] = {}
        for row in props_rows:
            props_reachability[row["node_id"]] = row["reachability"]
            props_connected[row["node_id"]] = row["connected"]

        now = datetime.utcnow()
        snapshots_to_write: List[Dict[str, Any]] = []

        for node_row in node_rows:
            nid = node_row["node_id"]
            dev_id = device_map.get(nid, nid)

            status, label, derived = compute_node_health(
                node_id=nid,
                device_id=dev_id,
                worst_event_severity=worst_severity.get(dev_id),
                inventory_reachability=inv_reachability.get(nid),
                props_reachability=props_reachability.get(nid),
                props_connected=props_connected.get(nid),
            )

            # Check if we should write a snapshot
            latest = await get_latest_snapshot(nid)
            should_write = False

            if latest is None:
                # First snapshot
                should_write = True
            elif latest["health_status"] != status:
                # Health changed
                should_write = True
            elif (now - latest["snapshot_at"].replace(tzinfo=None)) > timedelta(hours=24):
                # Heartbeat due (no change but >24h since last write)
                should_write = True

            if should_write:
                snapshots_to_write.append({
                    "node_id": nid,
                    "health_status": status,
                    "health_label": label,
                    "derived_from": derived,
                })

        if snapshots_to_write:
            await record_health_snapshots_batch(snapshots_to_write)
            logger.info(
                "Health snapshot: %d nodes checked, %d changes recorded",
                len(all_node_ids),
                len(snapshots_to_write),
            )

        return {
            "checked": len(all_node_ids),
            "changed": len(snapshots_to_write),
            "nodes": all_node_ids,
        }

    except Exception as exc:
        logger.error("Health snapshot collection failed: %s", exc, exc_info=True)
        return {"error": str(exc), "checked": 0, "changed": 0}


if __name__ == "__main__":
    import asyncio
    from shared.database.client import db

    async def run():
        await db.connect()
        result = await collect_health_snapshots()
        print(f"Result: {result}")
        await db.disconnect()

    asyncio.run(run())
