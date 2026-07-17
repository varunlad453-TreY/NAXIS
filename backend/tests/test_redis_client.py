"""
Tests for the Redis pub/sub client (shared/database/redis.py).

All Redis interactions are mocked — no real Redis instance required.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.shared.database.redis import RedisClient, get_redis_client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_redis_state():
    """Reset the RedisClient singleton and the module-level cache before
    each test so tests are fully isolated."""
    RedisClient._instance = None
    with patch("backend.shared.database.redis._redis_client", None):
        yield


def _make_settings(**overrides):
    """Return a settings-like object with Redis defaults overridden."""
    base = {
        "redis_url": "redis://localhost:6379/0",
        "redis_enabled": True,
        "redis_max_connections": 10,
    }
    base.update(overrides)
    return type("Settings", (), base)()


def _make_incident_payload(**overrides) -> dict:
    """Return a minimal incident dict for publishing."""
    return {
        "incident_id": "inc-test-001",
        "title": "Test incident",
        "severity": "critical",
        "status": "open",
        "affected_sites": ["site-a"],
        "affected_devices": ["dev-1"],
        "related_event_ids": ["evt-1", "evt-2"],
        "confidence_score": 0.85,
        **overrides,
    }


# ---------------------------------------------------------------------------
# publish_incident
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_incident_publishes_to_channel():
    """publish_incident publishes JSON to the naxis:incidents channel."""
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            payload = _make_incident_payload()

            await client.publish_incident(payload)

            mock_redis.publish.assert_awaited_once()
            channel, raw = mock_redis.publish.call_args[0]
            assert channel == "naxis:incidents"
            assert json.loads(raw) == payload


@pytest.mark.asyncio
async def test_publish_incident_skipped_when_disabled():
    """publish_incident does nothing when redis_enabled is False."""
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings(redis_enabled=False)):
            client = RedisClient()
            await client.publish_incident(_make_incident_payload())
            mock_redis.publish.assert_not_called()


@pytest.mark.asyncio
async def test_publish_incident_handles_connection_failure():
    """publish_incident logs a warning and does not raise on Redis failure."""
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock(side_effect=ConnectionError("Redis unreachable"))

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            # Should not raise
            await client.publish_incident(_make_incident_payload())
            mock_redis.publish.assert_awaited_once()


@pytest.mark.asyncio
async def test_publish_incident_handles_non_serializable_types():
    """publish_incident uses json.dumps(default=str) for non-serializable types."""
    from datetime import datetime

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            payload = _make_incident_payload(created_at=datetime(2026, 7, 17, 10, 0, 0))

            await client.publish_incident(payload)
            mock_redis.publish.assert_awaited_once()
            channel, raw = mock_redis.publish.call_args[0]
            assert channel == "naxis:incidents"
            parsed = json.loads(raw)
            # datetime should have been stringified by default=str
            assert "created_at" in parsed
            assert isinstance(parsed["created_at"], str)


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_returns_true_when_redis_responds():
    """health() returns True when Redis ping succeeds."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            assert await client.health() is True
            mock_redis.ping.assert_awaited_once()


@pytest.mark.asyncio
async def test_health_returns_false_when_redis_fails():
    """health() returns False when Redis ping fails."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=ConnectionError("Redis down"))

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            assert await client.health() is False


# ---------------------------------------------------------------------------
# warm_up
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_warm_up_returns_true_when_healthy():
    """warm_up() returns True when Redis is reachable."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            assert await client.warm_up() is True


@pytest.mark.asyncio
async def test_warm_up_returns_false_when_unreachable():
    """warm_up() returns False and logs warning when Redis is unreachable."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=ConnectionError("Redis down"))

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            assert await client.warm_up() is False


# ---------------------------------------------------------------------------
# get_redis_client singleton
# ---------------------------------------------------------------------------


def test_get_redis_client_returns_singleton():
    """get_redis_client() returns the same instance on repeated calls."""
    with patch("backend.shared.database.redis.get_settings", return_value=_make_settings(redis_enabled=True)):
        c1 = get_redis_client()
        c2 = get_redis_client()
        assert c1 is c2


def test_get_redis_client_no_settings_side_effects():
    """get_redis_client() works without Redis enabled (returns client but
    publish_incident will be a no-op)."""
    with patch("backend.shared.database.redis.get_settings", return_value=_make_settings(redis_enabled=True)):
        client = get_redis_client()
        assert client is not None
        assert client._settings.redis_enabled is True


# ---------------------------------------------------------------------------
# close
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_close_clears_redis_connection():
    """close() closes the underlying connection and sets _redis to None."""
    mock_redis = AsyncMock()
    mock_redis.close = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)

    with patch("backend.shared.database.redis.aioredis.from_url", return_value=mock_redis):
        with patch("backend.shared.database.redis.get_settings", return_value=_make_settings()):
            client = RedisClient()
            await client.health()  # triggers lazy connection
            assert client._redis is not None

            await client.close()
            mock_redis.close.assert_awaited_once()
            assert client._redis is None
