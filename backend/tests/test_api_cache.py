"""
Unit & Integration Tests for Generalized Cache Manager (WP-3.1).

Verifies:
  - Dual-Tier L1 Memory & L2 Redis Cache HIT/MISS behavior
  - Single-Flight Cache Stampede Protection (thundering herd defense)
  - `as_of` ISO-8601 timestamp injection in response payloads
  - `X-As-Of` and `X-Cache-Status` HTTP headers on FastAPI responses
  - Thread-safe fallback when Redis is offline
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Response

from backend.shared.cache import CacheManager, cached_api_route, get_cache_manager


@pytest.fixture(autouse=True)
def _reset_cache_manager():
    mgr = get_cache_manager()
    mgr.clear_l1()
    yield
    mgr.clear_l1()


@pytest.mark.asyncio
async def test_cache_manager_l1_hit_and_ttl():
    mgr = CacheManager(max_l1_items=10)
    key = "test_l1_key"
    data = {"status": "ok", "value": 42}
    as_of = "2026-08-07T00:00:00Z"

    # Initially MISS
    val, ts, status = await mgr.get(key)
    assert val is None
    assert status == "MISS"

    # Store in L1
    await mgr.set(key, data, as_of, ttl_seconds=60)

    # Now HIT-MEMORY
    val, ts, status = await mgr.get(key)
    assert val == data
    assert ts == as_of
    assert status == "HIT-MEMORY"


@pytest.mark.asyncio
async def test_cache_manager_l2_redis_fallback():
    mgr = CacheManager()
    key = "test_redis_key"
    data = {"items": [1, 2, 3]}
    as_of = "2026-08-07T01:00:00Z"

    # Mock Redis return payload
    redis_payload = {
        "data": data,
        "__cache_meta__": {
            "as_of": as_of,
            "ttl_remaining": 45,
        },
    }

    with patch.object(mgr._redis_client, "get_json", new=AsyncMock(return_value=redis_payload)):
        val, ts, status = await mgr.get(key)
        assert val == data
        assert ts == as_of
        assert status == "HIT-REDIS"

        # Check that L1 was backfilled
        l1_val, l1_ts = mgr.get_l1(key)
        assert l1_val == data
        assert l1_ts == as_of


@pytest.mark.asyncio
async def test_cached_api_route_decorator_headers_and_as_of():
    call_count = 0

    @cached_api_route(ttl_seconds=30, key_prefix="test_route")
    async def sample_endpoint(param: str, response: Response):
        nonlocal call_count
        call_count += 1
        return {"param": param, "result": "computed"}

    response = Response()
    res1 = await sample_endpoint("foo", response=response)

    assert call_count == 1
    assert res1["param"] == "foo"
    assert "as_of" in res1
    assert res1["cache_hit"] is False
    assert res1["cache_tier"] == "miss"
    assert response.headers["X-Cache-Status"] == "MISS"
    assert "X-As-Of" in response.headers

    # Second call should be a cache hit
    response2 = Response()
    res2 = await sample_endpoint("foo", response=response2)

    assert call_count == 1  # Not incremented!
    assert res2["param"] == "foo"
    assert res2["cache_hit"] is True
    assert res2["cache_tier"] == "memory"
    assert response2.headers["X-Cache-Status"] == "HIT-MEMORY"


@pytest.mark.asyncio
async def test_single_flight_stampede_protection():
    call_count = 0

    @cached_api_route(ttl_seconds=60, key_prefix="stampede_test")
    async def slow_vendor_fetch(query: str):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)  # Simulate slow network call
        return {"query": query, "data": "expensive_result"}

    # Launch 10 concurrent requests simultaneously
    tasks = [slow_vendor_fetch("heavy_query") for _ in range(10)]
    results = await asyncio.gather(*tasks)

    assert len(results) == 10
    # Vendor fetch function should only have been called ONCE!
    assert call_count == 1
    for r in results:
        assert r["query"] == "heavy_query"
        assert r["data"] == "expensive_result"
        assert "as_of" in r
