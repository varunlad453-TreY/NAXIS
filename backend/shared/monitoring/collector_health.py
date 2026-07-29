"""
Collector Health Alerting

Checks collector run history for failure patterns and logs actionable
alerts. Designed as a lightweight first step — no external dependencies,
can be extended with webhook/email/pager later.

Called by the worker after each collection cycle.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from shared.database.client import db

logger = logging.getLogger(__name__)

_RECENT_FAILURES_QUERY = """
    SELECT collector_id, source_system, COUNT(*) AS failure_count,
           MAX(finished_at) AS last_failure
    FROM collector_run_ledger
    WHERE status = 'error'
      AND finished_at > $1
    GROUP BY collector_id, source_system
    ORDER BY failure_count DESC
"""

_RECENT_SKIPS_QUERY = """
    SELECT collector_id, source_system, COUNT(*) AS skip_count,
           MAX(finished_at) AS last_skip
    FROM collector_run_ledger
    WHERE status = 'skipped'
      AND finished_at > $1
    GROUP BY collector_id, source_system
    ORDER BY skip_count DESC
"""


async def check_collector_health(window_minutes: int = 30) -> List[Dict[str, Any]]:
    """Check recent collector health and return alerts for failures/skips."""
    if not db.pool:
        return []

    from config.settings import get_settings
    settings = get_settings()

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    alerts: List[Dict[str, Any]] = []

    failure_rows = await db.fetch(_RECENT_FAILURES_QUERY, cutoff)
    for row in failure_rows:
        if int(row["failure_count"]) >= settings.notification_min_failures:
            alerts.append({
                "type": "repeated_failure",
                "collector_id": row["collector_id"],
                "source_system": row["source_system"],
                "count": int(row["failure_count"]),
                "last_at": row["last_failure"],
                "severity": "critical",
                "message": (
                    f"{row['collector_id']} has failed {row['failure_count']} "
                    f"times in the last {window_minutes} minutes"
                ),
            })

    skip_rows = await db.fetch(_RECENT_SKIPS_QUERY, cutoff)
    for row in skip_rows:
        if int(row["skip_count"]) >= settings.notification_min_skips:
            alerts.append({
                "type": "repeated_skip",
                "collector_id": row["collector_id"],
                "source_system": row["source_system"],
                "count": int(row["skip_count"]),
                "last_at": row["last_skip"],
                "severity": "warning",
                "message": (
                    f"{row['collector_id']} has been skipped {row['skip_count']} "
                    f"times in the last {window_minutes} minutes"
                ),
            })

    for alert in alerts:
        log_fn = logger.warning if alert["severity"] == "warning" else logger.error
        log_fn("Collector health alert: %s", alert["message"])

    if alerts:
        logger.info("Collector health: %d alert(s) in last %d min", len(alerts), window_minutes)

    return alerts
