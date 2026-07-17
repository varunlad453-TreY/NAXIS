"""
Correlation API Routes.

Exposes correlation engine telemetry so operators and the UI can verify
the engine is running and producing incidents.
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter

from shared.database.correlation_telemetry import (
    ensure_correlation_telemetry_schema,
    load_latest_correlation_telemetry,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/correlation",
    tags=["correlation"],
    responses={500: {"description": "Internal server error"}},
)


@router.get(
    "/stats",
    summary="Latest correlation engine telemetry",
    description=(
        "Returns telemetry from the most recent correlation cycle. "
        "Data is persisted to the database by the worker after each cycle. "
        "Returns 404 if no telemetry data exists yet or the latest data "
        "is older than 5 minutes."
    ),
)
async def get_correlation_stats() -> Dict[str, Any]:
    """Return the most recent correlation engine telemetry."""
    stats = await load_latest_correlation_telemetry()
    if stats is None:
        return {"status": "no_data", "message": "No correlation telemetry available yet"}

    # Derive a human-readable status
    cycle_count = stats.get("cycle_count", 0)
    last_incidents = stats.get("last_cycle_incidents", 0)
    if cycle_count > 0:
        status = "active" if last_incidents >= 0 else "idle"
    else:
        status = "inactive"

    return {
        "status": status,
        "stats": stats,
    }
