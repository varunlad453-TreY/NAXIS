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
    WHERE recorded_at < $1
"""

_COLLECTOR_LEDGER_CLEANUP = """
    DELETE FROM collector_run_ledger
    WHERE created_at < $1
"""

_HEALTH_SNAPSHOT_CLEANUP = """
    DELETE FROM node_health_snapshots
    WHERE snapshot_at < $1
"""

_EVENTS_CLEANUP = """
    DELETE FROM events
    WHERE timestamp < $1
"""

_INCIDENTS_CLEANUP = """
    DELETE FROM incidents
    WHERE status = 'resolved' AND created_at < $1
"""

_RAW_EVENT_STRIP = """
    UPDATE events
    SET raw_event = NULL
    WHERE raw_event IS NOT NULL AND timestamp < $1
"""


async def run_retention(
    days: int = 7,
    event_days: int = 90,
    incident_days: int = 180,
    raw_event_days: int = 7,
) -> dict:
    """Delete telemetry older than ``days`` days and events older than
    ``event_days`` days. Also prunes resolved incidents older than
    ``incident_days`` and strips raw_event blobs older than
    ``raw_event_days`` (the debug window). Returns counts of removed rows."""
    if not db.pool:
        return {"error": "No database connection"}

    result: dict = {}

    for name, query, cutoff_days in [
        ("correlation_telemetry", _CORRELATION_TELEMETRY_CLEANUP, days),
        ("collector_run_ledger", _COLLECTOR_LEDGER_CLEANUP, days),
        ("health_snapshots", _HEALTH_SNAPSHOT_CLEANUP, days),
        ("events", _EVENTS_CLEANUP, event_days),
        ("incidents", _INCIDENTS_CLEANUP, incident_days),
        ("raw_event_strip", _RAW_EVENT_STRIP, raw_event_days),
    ]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
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
