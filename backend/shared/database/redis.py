"""
Async Redis client for real-time incident notifications.

Used by the worker to publish newly correlated incidents so a future
SSE/WebSocket endpoint can push live updates to the frontend.
"""

import json
import logging
from typing import Any, Dict, Optional

import redis.asyncio as aioredis

from backend.config.settings import get_settings

logger = logging.getLogger(__name__)


class RedisClient:
    """Async Redis client wrapper with lazy connection."""

    _instance: Optional["RedisClient"] = None

    def __new__(cls) -> "RedisClient":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._settings = get_settings()
        self._redis: Optional[aioredis.Redis] = None
        self._initialized = True

    def _get_redis(self) -> aioredis.Redis:
        """Return existing connection or create one."""
        if self._redis is None:
            self._redis = aioredis.from_url(
                self._settings.redis_url,
                decode_responses=True,
                max_connections=self._settings.redis_max_connections,
            )
        return self._redis

    async def health(self) -> bool:
        """Check Redis connectivity."""
        try:
            return await self._get_redis().ping()
        except Exception as exc:
            logger.warning("Redis health check failed: %s", exc)
            return False

    async def publish_incident(self, incident: Dict[str, Any]) -> None:
        """Publish a new or updated incident to the live feed channel."""
        if not self._settings.redis_enabled:
            return
        try:
            payload = json.dumps(incident, default=str)
            await self._get_redis().publish("naxis:incidents", payload)
            logger.debug("Published incident %s to Redis", incident.get("incident_id"))
        except Exception as exc:
            logger.warning("Failed to publish incident to Redis: %s", exc)

    async def close(self) -> None:
        """Close the Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None


# Convenience singleton accessor
_redis_client: Optional[RedisClient] = None


def get_redis_client() -> RedisClient:
    """Return the global Redis client instance."""
    global _redis_client
    if _redis_client is None:
        _redis_client = RedisClient()
    return _redis_client
