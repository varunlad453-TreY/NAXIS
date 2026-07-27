"""
Data Retention Policies

Scheduled cleanup of old telemetry data to prevent unbounded table growth.
Called by the worker periodically.
"""

import logging
from datetime import datetime, timedelta, timezone

from shared.database.client import db

logger = logging.getLogger(__name__)

_CORRELATION_TELEMETRY_CLEANUP = """
    DELETE FROM correlation_telemetry
    WHERE created_at < $1
"""

_COLLECTOR_LEDGER_CLEANUP = """
    DELETE FROM collector_run_ledger
    WHERE created_at < $1
"""

_HEALTH_SNAPSHOT_CLEANUP = """
    DELETE FROM node_health_snapshots
    WHERE snapshot_at < $1
"""


async def run_retention(days: int = 7) -> dict:
    """Delete telemetry data older than ``days`` days. Returns counts of removed rows."""
    if not db.pool:
        return {"error": "No database connection"}

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result: dict = {}

    for name, query in [
        ("correlation_telemetry", _CORRELATION_TELEMETRY_CLEANUP),
        ("collector_run_ledger", _COLLECTOR_LEDGER_CLEANUP),
        ("health_snapshots", _HEALTH_SNAPSHOT_CLEANUP),
    ]:
        try:
            r = await db.execute(query, cutoff)
            count = int(r.split()[-1]) if r else 0
            result[name] = count
            if count:
                logger.info("Retention: deleted %d rows from %s (cutoff=%s)", count, name, cutoff.date())
        except Exception as exc:
            logger.warning("Retention cleanup failed for %s: %s", name, exc)
            result[name] = str(exc)

    return result
