"""
Generalized Caching Framework (WP-3.1).

Asia Enterprise-Scale Architecture:
  1. Dual-Tier Caching:
     - L1 In-Memory Cache (sub-millisecond local LRU)
     - L2 Redis Cache (distributed across multi-node deployment)
  2. Single-Flight Cache Stampede Protection:
     - Async mutex per key prevents thundering herd / 429 vendor rate limits
  3. Telemetry Freshness & Diagnostic Headers:
     - Automatic injection of ISO-8601 `as_of` UTC timestamps
     - Injects `X-As-Of` and `X-Cache-Status` (`HIT-MEMORY`, `HIT-REDIS`, `MISS`) headers
"""

import asyncio
import functools
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Tuple

from fastapi import Response

try:
    from backend.shared.database.redis import get_redis_client
except ImportError:
    from shared.database.redis import get_redis_client

logger = logging.getLogger(__name__)

# Single-flight async locks per cache key to prevent cache stampedes
_SINGLE_FLIGHT_LOCKS: Dict[str, asyncio.Lock] = {}
_LOCKS_GUARD = asyncio.Lock()


async def _get_single_flight_lock(key: str) -> asyncio.Lock:
    """Return an async Lock dedicated to `key`."""
    async with _LOCKS_GUARD:
        if key not in _SINGLE_FLIGHT_LOCKS:
            _SINGLE_FLIGHT_LOCKS[key] = asyncio.Lock()
        return _SINGLE_FLIGHT_LOCKS[key]


class CacheManager:
    """
    Dual-Tier Cache Manager (L1 Memory + L2 Redis).
    """

    def __init__(self, max_l1_items: int = 512):
        self._l1_cache: Dict[str, Tuple[float, Any, str]] = {}  # key -> (expires_at, data, as_of_str)
        self._max_l1_items = max_l1_items
        self._redis_client = get_redis_client()

    def _cleanup_l1(self) -> None:
        """Prune expired items or trim size if over max_l1_items."""
        now = time.time()
        expired = [k for k, v in self._l1_cache.items() if v[0] <= now]
        for k in expired:
            self._l1_cache.pop(k, None)

        if len(self._l1_cache) > self._max_l1_items:
            # Sort by expiration time ascending and drop oldest
            sorted_keys = sorted(self._l1_cache.keys(), key=lambda k: self._l1_cache[k][0])
            to_remove = len(self._l1_cache) - self._max_l1_items
            for k in sorted_keys[:to_remove]:
                self._l1_cache.pop(k, None)

    def get_l1(self, key: str) -> Optional[Tuple[Any, str]]:
        """Get item from L1 in-memory cache if valid."""
        hit = self._l1_cache.get(key)
        if hit:
            expires_at, data, as_of_str = hit
            if time.time() < expires_at:
                return data, as_of_str
            self._l1_cache.pop(key, None)
        return None

    def set_l1(self, key: str, data: Any, as_of_str: str, ttl_seconds: int) -> None:
        """Store item in L1 in-memory cache."""
        self._cleanup_l1()
        expires_at = time.time() + ttl_seconds
        self._l1_cache[key] = (expires_at, data, as_of_str)

    async def get(self, key: str) -> Tuple[Optional[Any], Optional[str], str]:
        """
        Get from Dual-Tier Cache.
        Returns (data, as_of_str, cache_status) where cache_status is:
          - "HIT-MEMORY"
          - "HIT-REDIS"
          - "MISS"
        """
        # 1. L1 Memory Check
        l1_hit = self.get_l1(key)
        if l1_hit:
            return l1_hit[0], l1_hit[1], "HIT-MEMORY"

        # 2. L2 Redis Check
        redis_val = await self._redis_client.get_json(f"cache:{key}")
        if redis_val and isinstance(redis_val, dict) and "__cache_meta__" in redis_val:
            data = redis_val.get("data")
            as_of_str = redis_val["__cache_meta__"].get("as_of", "")
            ttl_remaining = redis_val["__cache_meta__"].get("ttl_remaining", 60)

            # Backfill L1
            if data is not None and as_of_str:
                self.set_l1(key, data, as_of_str, min(ttl_remaining, 60))
            return data, as_of_str, "HIT-REDIS"

        return None, None, "MISS"

    async def set(self, key: str, data: Any, as_of_str: str, ttl_seconds: int = 60) -> None:
        """Store data in both L1 and L2 caches."""
        self.set_l1(key, data, as_of_str, ttl_seconds)

        payload = {
            "data": data,
            "__cache_meta__": {
                "as_of": as_of_str,
                "ttl_remaining": ttl_seconds,
            },
        }
        await self._redis_client.set_json(f"cache:{key}", payload, ttl_seconds=ttl_seconds)

    def clear_l1(self) -> None:
        """Clear L1 memory cache (useful in tests)."""
        self._l1_cache.clear()


# Global Singleton
_global_cache_manager: Optional[CacheManager] = None


def get_cache_manager() -> CacheManager:
    global _global_cache_manager
    if _global_cache_manager is None:
        _global_cache_manager = CacheManager()
    return _global_cache_manager


def _format_as_of_now() -> str:
    """ISO-8601 UTC timestamp format."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _inject_as_of_metadata(data: Any, as_of_str: str, cache_status: str) -> Any:
    """Inject as_of, cache_hit, and cache_tier fields into dict responses."""
    if isinstance(data, dict):
        data["as_of"] = as_of_str
        data["cache_hit"] = cache_status != "MISS"
        data["cache_tier"] = "redis" if cache_status == "HIT-REDIS" else ("memory" if cache_status == "HIT-MEMORY" else "miss")
    return data


def cached_api_route(ttl_seconds: int = 60, key_prefix: str = "route"):
    """
    Decorator for FastAPI route handlers and async functions.

    - Single-Flight mutex protection against cache stampedes.
    - Dual-tier L1 Memory + L2 Redis caching.
    - Injects `as_of` metadata into JSON dict payloads.
    - Sets `X-As-Of` and `X-Cache-Status` HTTP headers when a Response parameter is provided.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract FastAPI Response if passed in kwargs
            response_obj: Optional[Response] = kwargs.get("response")
            if not response_obj:
                for arg in args:
                    if isinstance(arg, Response):
                        response_obj = arg
                        break

            # Build cache key from function name + args + kwargs
            raw_key_parts = [key_prefix, func.__name__]
            for a in args:
                if not isinstance(a, Response):
                    raw_key_parts.append(str(a))
            for k, v in sorted(kwargs.items()):
                if not isinstance(v, Response) and k != "response":
                    raw_key_parts.append(f"{k}:{v}")
            cache_key = ":".join(raw_key_parts)

            cache_mgr = get_cache_manager()

            # Fast path check
            cached_data, as_of_str, status = await cache_mgr.get(cache_key)
            if cached_data is not None and as_of_str:
                if response_obj:
                    response_obj.headers["X-As-Of"] = as_of_str
                    response_obj.headers["X-Cache-Status"] = status
                    response_obj.headers["X-Cache-TTL"] = str(ttl_seconds)
                return _inject_as_of_metadata(cached_data, as_of_str, status)

            # Single-Flight lock to prevent stampede
            lock = await _get_single_flight_lock(cache_key)
            async with lock:
                # Double-check after acquiring lock
                cached_data, as_of_str, status = await cache_mgr.get(cache_key)
                if cached_data is not None and as_of_str:
                    if response_obj:
                        response_obj.headers["X-As-Of"] = as_of_str
                        response_obj.headers["X-Cache-Status"] = status
                        response_obj.headers["X-Cache-TTL"] = str(ttl_seconds)
                    return _inject_as_of_metadata(cached_data, as_of_str, status)

                # Execute original route function
                result = await func(*args, **kwargs)
                as_of_str = _format_as_of_now()

                # Store in cache
                await cache_mgr.set(cache_key, result, as_of_str, ttl_seconds=ttl_seconds)

                if response_obj:
                    response_obj.headers["X-As-Of"] = as_of_str
                    response_obj.headers["X-Cache-Status"] = "MISS"
                    response_obj.headers["X-Cache-TTL"] = str(ttl_seconds)

                return _inject_as_of_metadata(result, as_of_str, "MISS")

        return wrapper
    return decorator
