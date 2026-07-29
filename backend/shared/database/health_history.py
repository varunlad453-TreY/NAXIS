"""
Health history repository — node_health_snapshots CRUD operations.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from .client import db

logger = logging.getLogger(__name__)


async def record_health_snapshot(
    node_id: str,
    health_status: str,
    health_label: str,
    derived_from: str = "events",
) -> None:
    """Record a single health snapshot."""
    await db.execute(
        """
        INSERT INTO node_health_snapshots (node_id, health_status, health_label, derived_from)
        VALUES ($1, $2, $3, $4)
        """,
        node_id, health_status, health_label, derived_from,
    )


async def record_health_snapshots_batch(
    snapshots: List[Dict[str, Any]],
) -> None:
    """Bulk-insert health snapshots."""
    if not snapshots:
        return
    values = []
    params = []
    i = 1
    placeholders = []
    for snap in snapshots:
        placeholders.append(f"($${i}, $${i+1}, $${i+2}, $${i+3})")
        params.extend([
            snap["node_id"],
            snap["health_status"],
            snap.get("health_label", ""),
            snap.get("derived_from", "events"),
        ])
        i += 4

    sql = f"""
        INSERT INTO node_health_snapshots (node_id, health_status, health_label, derived_from)
        VALUES {', '.join(placeholders)}
    """
    await db.execute(sql, *params)


async def get_latest_snapshot(node_id: str) -> Optional[Dict[str, Any]]:
    """Get the most recent snapshot for a node. Returns None if no snapshots exist."""
    row = await db.fetchrow(
        """
        SELECT id, node_id, health_status, health_label, snapshot_at, derived_from
        FROM node_health_snapshots
        WHERE node_id = $1
        ORDER BY snapshot_at DESC
        LIMIT 1
        """,
        node_id,
    )
    if not row:
        return None
    return {
        "id": row["id"],
        "node_id": row["node_id"],
        "health_status": row["health_status"],
        "health_label": row["health_label"],
        "snapshot_at": row["snapshot_at"],
        "derived_from": row["derived_from"],
    }


async def get_health_history(
    node_id: str,
    hours_back: int = 24,
    limit: int = 500,
) -> List[Dict[str, Any]]:
    """Get health history for a node, newest first."""
    since = datetime.utcnow() - timedelta(hours=hours_back)
    rows = await db.fetch(
        """
        SELECT id, node_id, health_status, health_label, snapshot_at, derived_from
        FROM node_health_snapshots
        WHERE node_id = $1 AND snapshot_at >= $2
        ORDER BY snapshot_at DESC
        LIMIT $3
        """,
        node_id,
        since,
        limit,
    )
    return [
        {
            "snapshot_at": r["snapshot_at"],
            "health_status": r["health_status"],
            "health_label": r["health_label"],
            "derived_from": r["derived_from"],
        }
        for r in rows
    ]


async def get_health_summary(
    node_id: str,
    hours_back: int = 24,
) -> Dict[str, int]:
    """Get a count breakdown of health statuses over a time range."""
    since = datetime.utcnow() - timedelta(hours=hours_back)
    rows = await db.fetch(
        """
        SELECT health_status, COUNT(*) AS cnt
        FROM node_health_snapshots
        WHERE node_id = $1 AND snapshot_at >= $2
        GROUP BY health_status
        """,
        node_id,
        since,
    )
    summary: Dict[str, int] = {"healthy": 0, "warning": 0, "critical": 0, "unknown": 0}
    for r in rows:
        status = r["health_status"]
        if status in summary:
            summary[status] = int(r["cnt"])
    return summary


async def prune_old_snapshots(retention_days: int = 30) -> int:
    """Delete snapshots older than retention_days. Returns count of deleted rows."""
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    result = await db.execute(
        "DELETE FROM node_health_snapshots WHERE snapshot_at < $1",
        cutoff,
    )
    if hasattr(result, "count"):
        return result.count
    return 0
