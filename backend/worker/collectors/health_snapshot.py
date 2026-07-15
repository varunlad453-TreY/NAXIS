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
    extract_event_device_id,
)

logger = logging.getLogger(__name__)

_HEALTH_EVENTS_QUERY = """
    SELECT device_id, severity, MAX(timestamp) AS latest_at
    FROM events
    WHERE device_id = ANY($1::text[])
      AND timestamp > NOW() - INTERVAL '15 minutes'
      AND severity IN ('critical', 'major')
    GROUP BY device_id, severity
    ORDER BY device_id, severity DESC
"""

_HEALTH_INVENTORY_QUERY = """
    SELECT device_id, reachability
    FROM inventory
    WHERE device_id = ANY($1::text[])
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
        device_map = {nid: extract_event_device_id(nid) for nid in all_node_ids}
        unique_device_ids = list(set(device_map.values()))

        if not unique_device_ids:
            return {"checked": len(all_node_ids), "changed": 0, "message": "No device IDs to query"}

        # Fetch health signals
        event_rows = await db.fetch(_HEALTH_EVENTS_QUERY, unique_device_ids)
        worst_severity: Dict[str, str] = {}
        for row in event_rows:
            dev_id = row["device_id"]
            sev = row["severity"]
            existing = worst_severity.get(dev_id)
            if existing is None or (sev == "critical" and existing != "critical"):
                worst_severity[dev_id] = sev

        inventory_rows = await db.fetch(_HEALTH_INVENTORY_QUERY, unique_device_ids)
        inv_reachability: Dict[str, str] = {}
        for row in inventory_rows:
            inv_reachability[row["device_id"]] = row["reachability"]

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
                inventory_reachability=inv_reachability.get(dev_id),
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
