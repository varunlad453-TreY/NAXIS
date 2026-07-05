"""
Telemetry API Routes.

Exposes live collector health, worker heartbeats, and staleness alerts.
The UI consumes this endpoint to show real operational state instead of
static integration labels.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter

from shared.database.collector_telemetry import list_collector_telemetry

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/telemetry",
    tags=["telemetry"],
    responses={500: {"description": "Internal server error"}},
)

# ---------------------------------------------------------------------------
# Freshness thresholds (seconds)
# ---------------------------------------------------------------------------
# These determine when a collector is considered "stale" or "critical".
_STALE_THRESHOLD = 300   # 5 minutes without a successful run
_CRITICAL_THRESHOLD = 900  # 15 minutes
_MAX_FAILURES = 3        # consecutive failures before alerting


def _derive_status(entry: Dict[str, Any]) -> str:
    """Derive a runtime status from telemetry data instead of static labels."""
    status = entry.get("last_status", "")
    age = entry.get("current_age_seconds")
    failures = entry.get("failure_count", 0)

    if status == "skipped":
        return "not_configured"
    if status == "error" and failures >= _MAX_FAILURES:
        return "error"
    if age is not None and age > _CRITICAL_THRESHOLD:
        return "stale"
    if age is not None and age > _STALE_THRESHOLD:
        return "degraded"
    if status == "success":
        return "healthy"
    if status == "error":
        return "warning"
    return "unknown"


def _build_alerts(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate alerts for stale collectors, repeated failures, and data gaps."""
    alerts: List[Dict[str, Any]] = []

    for entry in entries:
        collector_id = entry.get("collector_id", "")
        source = entry.get("source_system", "")
        age = entry.get("current_age_seconds")
        failures = entry.get("failure_count", 0)
        last_status = entry.get("last_status", "")

        # Repeated failures
        if failures >= _MAX_FAILURES and last_status == "error":
            alerts.append({
                "severity": "critical" if failures >= _MAX_FAILURES * 2 else "warning",
                "type": "repeated_failure",
                "collector_id": collector_id,
                "source_system": source,
                "message": f"{collector_id} has failed {failures} times",
                "failure_count": failures,
            })

        # Stale data
        if age is not None and age > _CRITICAL_THRESHOLD:
            alerts.append({
                "severity": "critical",
                "type": "stale_data",
                "collector_id": collector_id,
                "source_system": source,
                "message": f"{collector_id} data is {age // 60}m old (>{_CRITICAL_THRESHOLD // 60}m threshold)",
                "age_seconds": age,
            })
        elif age is not None and age > _STALE_THRESHOLD:
            alerts.append({
                "severity": "warning",
                "type": "stale_data",
                "collector_id": collector_id,
                "source_system": source,
                "message": f"{collector_id} data is {age // 60}m old (>{_STALE_THRESHOLD // 60}m threshold)",
                "age_seconds": age,
            })

        # Data gap: last run was an error but there were previous successes
        last_success = entry.get("last_success")
        if last_status == "error" and last_success is not None:
            gap = entry.get("current_age_seconds")
            if gap is not None and gap > _STALE_THRESHOLD:
                alerts.append({
                    "severity": "warning",
                    "type": "data_gap",
                    "collector_id": collector_id,
                    "source_system": source,
                    "message": f"{collector_id} last succeeded {gap // 60}m ago — data may be incomplete",
                    "age_seconds": gap,
                })

    return alerts


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", summary="Live collector telemetry")
async def get_telemetry() -> Dict[str, Any]:
    """
    Returns live telemetry for every collector: last run, last success,
    last error, failure count, current data age, and derived status.

    Also returns alerts for stale collectors, repeated failures, and data gaps.
    """
    entries = await list_collector_telemetry()

    enriched: List[Dict[str, Any]] = []
    for entry in entries:
        enriched.append({
            **entry,
            "derived_status": _derive_status(entry),
        })

    alerts = _build_alerts(entries)

    # Summary stats
    healthy = sum(1 for e in enriched if e["derived_status"] == "healthy")
    total = len(enriched)

    return {
        "collectors": enriched,
        "alerts": alerts,
        "summary": {
            "total_collectors": total,
            "healthy": healthy,
            "degraded": sum(1 for e in enriched if e["derived_status"] == "degraded"),
            "stale": sum(1 for e in enriched if e["derived_status"] == "stale"),
            "error": sum(1 for e in enriched if e["derived_status"] in ("error", "warning")),
            "not_configured": sum(1 for e in enriched if e["derived_status"] == "not_configured"),
            "alert_count": len(alerts),
        },
    }


@router.get("/alerts", summary="Active telemetry alerts")
async def get_alerts() -> Dict[str, Any]:
    """Returns only the active alerts (stale, failures, data gaps)."""
    entries = await list_collector_telemetry()
    alerts = _build_alerts(entries)
    return {"alerts": alerts, "count": len(alerts)}
