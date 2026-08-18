"""
Data Retention Policies

Scheduled cleanup of old telemetry data to prevent unbounded table growth.
Called by the worker periodically.

The events table is pruned in batches. A single unbounded `DELETE`/`UPDATE`
over a multi-million-row backlog cannot finish inside the worker's per-pass
watchdog, and being cancelled mid-statement rolls the whole thing back — so
the backlog never shrinks and every subsequent pass retries it forever.
Batching plus a wall-clock budget makes progress monotonic instead.
"""

import logging
import time
from datetime import datetime, timedelta, timezone

from shared.database.client import db

logger = logging.getLogger(__name__)

# Rows per statement for the batched event passes, and the wall-clock ceiling
# for the whole retention run. The budget must stay well under the worker's
# RUN_ONCE_TIMEOUT so a large backlog is chipped away over several cycles
# rather than cancelling the pass.
BATCH_SIZE = 20_000
DEFAULT_MAX_SECONDS = 120.0

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

_INCIDENTS_CLEANUP = """
    DELETE FROM incidents
    WHERE status = 'resolved' AND created_at < $1
"""

# Batched: bound each statement by primary key so the planner deletes exactly
# $2 rows and the transaction stays short.
_EVENTS_CLEANUP = """
    DELETE FROM events
    WHERE event_id IN (
        SELECT event_id FROM events
        WHERE timestamp < $1
        LIMIT $2
    )
"""

_RAW_EVENT_STRIP = """
    UPDATE events
    SET raw_event = NULL
    WHERE event_id IN (
        SELECT event_id FROM events
        WHERE raw_event IS NOT NULL AND timestamp < $1
        LIMIT $2
    )
"""


def _affected(status: str) -> int:
    """Parse the row count out of an asyncpg command tag ('DELETE 42')."""
    try:
        return int(status.split()[-1]) if status else 0
    except (ValueError, AttributeError):
        return 0


async def run_retention(
    days: int = 7,
    event_days: int = 90,
    incident_days: int = 180,
    raw_event_days: int = 7,
    max_seconds: float = DEFAULT_MAX_SECONDS,
    batch_size: int = BATCH_SIZE,
) -> dict:
    """Delete telemetry older than ``days`` days and events older than
    ``event_days`` days. Also prunes resolved incidents older than
    ``incident_days`` and strips raw_event blobs older than
    ``raw_event_days`` (the debug window). Returns counts of removed rows.

    The two event passes are batched and share ``max_seconds``; if the budget
    runs out with work left, the result carries ``truncated`` and the next
    run picks up where this one stopped."""
    if not db.pool:
        return {"error": "No database connection"}

    result: dict = {}
    deadline = time.monotonic() + max_seconds
    truncated: list[str] = []

    # Small tables: single statement each.
    for name, query, cutoff_days in [
        ("correlation_telemetry", _CORRELATION_TELEMETRY_CLEANUP, days),
        ("collector_run_ledger", _COLLECTOR_LEDGER_CLEANUP, days),
        ("health_snapshots", _HEALTH_SNAPSHOT_CLEANUP, days),
    ]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
        try:
            count = _affected(await db.execute(query, cutoff))
            result[name] = count
            if count:
                logger.info("Retention: deleted %d rows from %s (cutoff=%s)", count, name, cutoff.date())
        except Exception as exc:
            logger.warning("Retention cleanup failed for %s: %s", name, exc)
            result[name] = str(exc)

    # events: batched delete.
    cutoff = datetime.now(timezone.utc) - timedelta(days=event_days)
    try:
        total = 0
        while True:
            count = _affected(await db.execute(_EVENTS_CLEANUP, cutoff, batch_size))
            total += count
            if count < batch_size:
                break
            if time.monotonic() >= deadline:
                truncated.append("events")
                break
        result["events"] = total
        if total:
            logger.info("Retention: deleted %d rows from events (cutoff=%s)", total, cutoff.date())
    except Exception as exc:
        logger.warning("Retention cleanup failed for events: %s", exc)
        result["events"] = str(exc)

    # Resolved incidents only — open incidents are never pruned.
    cutoff = datetime.now(timezone.utc) - timedelta(days=incident_days)
    try:
        count = _affected(await db.execute(_INCIDENTS_CLEANUP, cutoff))
        result["incidents"] = count
        if count:
            logger.info("Retention: deleted %d rows from incidents (cutoff=%s)", count, cutoff.date())
    except Exception as exc:
        logger.warning("Retention cleanup failed for incidents: %s", exc)
        result["incidents"] = str(exc)

    # raw_event debug window: batched update.
    cutoff = datetime.now(timezone.utc) - timedelta(days=raw_event_days)
    try:
        total = 0
        while True:
            count = _affected(await db.execute(_RAW_EVENT_STRIP, cutoff, batch_size))
            total += count
            if count < batch_size:
                break
            if time.monotonic() >= deadline:
                truncated.append("raw_event_strip")
                break
        result["raw_event_strip"] = total
        if total:
            logger.info("Retention: stripped raw_event from %d rows (cutoff=%s)", total, cutoff.date())
    except Exception as exc:
        logger.warning("Retention cleanup failed for raw_event_strip: %s", exc)
        result["raw_event_strip"] = str(exc)

    if truncated:
        result["truncated"] = truncated
        logger.info(
            "Retention: %.0fs budget exhausted with work remaining in %s — resuming next run",
            max_seconds, ", ".join(truncated),
        )

    return result
