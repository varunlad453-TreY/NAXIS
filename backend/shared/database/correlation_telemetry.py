"""
Correlation engine telemetry repository.

Persists engine stats after each correlation cycle so the API can expose
them without sharing process memory with the worker daemon.

Schema: schemas/postgres/006_correlation_telemetry.sql
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .client import db


async def ensure_correlation_telemetry_schema() -> None:
    """Create the correlation_telemetry table if it does not exist."""
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS correlation_telemetry (
            id                      BIGSERIAL   PRIMARY KEY,
            cycle_count             INTEGER     NOT NULL,
            total_events_processed  INTEGER     NOT NULL,
            total_incidents_created INTEGER     NOT NULL,
            cascade_incidents       INTEGER     NOT NULL,
            residual_incidents      INTEGER     NOT NULL,
            processed_set_size      INTEGER     NOT NULL,
            last_duration_ms        REAL        NOT NULL DEFAULT 0,
            last_cycle_events       INTEGER     NOT NULL DEFAULT 0,
            last_cycle_incidents    INTEGER     NOT NULL DEFAULT 0,
            cascade_enabled         BOOLEAN     NOT NULL DEFAULT FALSE,
            worker_id               TEXT,
            recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_correlation_telemetry_recorded "
        "ON correlation_telemetry (recorded_at DESC)"
    )


async def save_correlation_telemetry(
    stats: Dict[str, Any],
    worker_id: Optional[str] = None,
) -> None:
    """Insert a new telemetry row for a correlation cycle.

    Args:
        stats: Output of CorrelationEngine.get_stats().
        worker_id: Optional worker identity string.
    """
    await db.execute(
        """
        INSERT INTO correlation_telemetry (
            cycle_count, total_events_processed, total_incidents_created,
            cascade_incidents, residual_incidents, processed_set_size,
            last_duration_ms, last_cycle_events, last_cycle_incidents,
            cascade_enabled, worker_id, recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        """,
        stats.get("cycle_count", 0),
        stats.get("total_events_processed", 0),
        stats.get("total_incidents_created", 0),
        stats.get("cascade_incidents", 0),
        stats.get("residual_incidents", 0),
        stats.get("processed_set_size", 0),
        float(stats.get("last_duration_ms", 0)),
        int(stats.get("last_cycle_events", 0)),
        int(stats.get("last_cycle_incidents", 0)),
        bool(stats.get("cascade_enabled", False)),
        worker_id,
        datetime.now(timezone.utc),
    )


async def load_latest_correlation_telemetry(
    max_age_seconds: int = 300,
) -> Optional[Dict[str, Any]]:
    """Return the most recent telemetry row, or None if no data exists.

    Args:
        max_age_seconds: Maximum age in seconds; rows older than this
                         are considered stale and return None.

    Returns:
        A dict with the same keys as CorrelationEngine.get_stats() plus
        ``recorded_at`` and ``worker_id``, or None.
    """
    if not db.pool:
        return None

    row = await db.fetchrow(
        """
        SELECT
            cycle_count, total_events_processed, total_incidents_created,
            cascade_incidents, residual_incidents, processed_set_size,
            last_duration_ms, last_cycle_events, last_cycle_incidents,
            cascade_enabled, worker_id, recorded_at
        FROM correlation_telemetry
        ORDER BY recorded_at DESC
        LIMIT 1
        """
    )
    if row is None:
        return None

    recorded_at = row["recorded_at"]
    age = (datetime.now(timezone.utc) - recorded_at).total_seconds()
    if age > max_age_seconds:
        return None

    return {
        "cycle_count": row["cycle_count"],
        "total_events_processed": row["total_events_processed"],
        "total_incidents_created": row["total_incidents_created"],
        "cascade_incidents": row["cascade_incidents"],
        "residual_incidents": row["residual_incidents"],
        "processed_set_size": row["processed_set_size"],
        "last_duration_ms": float(row["last_duration_ms"]),
        "last_cycle_events": row["last_cycle_events"],
        "last_cycle_incidents": row["last_cycle_incidents"],
        "cascade_enabled": row["cascade_enabled"],
        "worker_id": row["worker_id"],
        "recorded_at": recorded_at.isoformat(),
    }
