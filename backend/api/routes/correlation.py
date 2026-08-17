"""
Correlation API Routes.

Exposes correlation engine telemetry so operators and the UI can verify
the engine is running and producing incidents. Also provides a Server-Sent
Events endpoint for live incident push via Redis pub/sub.
"""

import asyncio
import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from config.settings import get_settings
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

_settings = get_settings()


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


@router.get(
    "/incidents/stream",
    summary="Server-Sent Events stream for live incident updates",
    description=(
        "Subscribes to the Redis naxis:incidents channel and streams new "
        "incidents as Server-Sent Events. Falls back to a periodic keepalive "
        "if Redis is disabled or unreachable."
    ),
)
async def stream_incidents():
    """SSE endpoint for live incident updates from Redis pub/sub."""

    async def event_generator():
        redis_client = None
        pubsub = None

        if _settings.redis_enabled:
            try:
                import redis.asyncio as aioredis

                redis_client = aioredis.from_url(
                    _settings.redis_url,
                    decode_responses=True,
                    max_connections=_settings.redis_max_connections,
                )
                pubsub = redis_client.pubsub()
                await pubsub.subscribe("naxis:incidents")
                logger.info("SSE: subscribed to Redis naxis:incidents")
            except Exception as exc:
                logger.warning("SSE: Redis subscribe failed — falling back to heartbeat: %s", exc)
                pubsub = None

        # Emit an immediate event so the client confirms the stream is live
        # instead of waiting up to 30s for the first heartbeat/incident.
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"

        try:
            while True:
                if pubsub:
                    try:
                        message = await pubsub.get_message(
                            ignore_subscribe_messages=True, timeout=30.0
                        )
                        if message and message.get("data"):
                            data = message["data"]
                            yield f"data: {data}\n\n"
                            continue
                    except Exception:
                        logger.warning("SSE: Redis pubsub error, falling back to heartbeat", exc_info=True)
                        yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                        await asyncio.sleep(30)
                else:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    await asyncio.sleep(30)
        except asyncio.CancelledError:
            pass
        finally:
            if pubsub:
                await pubsub.unsubscribe("naxis:incidents")
                await pubsub.close()
            if redis_client:
                await redis_client.close()
            logger.info("SSE: client disconnected")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
