"""
Tests for the correlation telemetry DB layer and API endpoint.

Uses mocked database client to avoid needing a real PostgreSQL connection.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.main import app


# ---------------------------------------------------------------------------
# DB layer tests
# ---------------------------------------------------------------------------

class _MockRow:
    """Minimal asyncpg row mock supporting dict-style access."""

    def __init__(self, **kwargs):
        self._data = dict(kwargs)

    def __getitem__(self, key):
        return self._data[key]

    def get(self, key, default=None):
        return self._data.get(key, default)


@pytest.mark.asyncio
async def test_save_correlation_telemetry():
    """save_correlation_telemetry inserts a row."""
    from shared.database.correlation_telemetry import save_correlation_telemetry

    stats = {
        "cycle_count": 5,
        "total_events_processed": 1200,
        "total_incidents_created": 12,
        "cascade_incidents": 10,
        "residual_incidents": 2,
        "processed_set_size": 150000,
        "last_duration_ms": 234.5,
        "last_cycle_events": 200,
        "last_cycle_incidents": 3,
        "cascade_enabled": True,
    }

    with patch("shared.database.correlation_telemetry.db") as mock_db:
        mock_db.pool = AsyncMock()
        mock_db.execute = AsyncMock(return_value="INSERT 0 1")

        await save_correlation_telemetry(stats, worker_id="worker-test-01")

        mock_db.execute.assert_awaited_once()
        call_args = mock_db.execute.call_args[0]
        assert "INSERT INTO correlation_telemetry" in call_args[0]
        assert call_args[1] == 5  # cycle_count
        assert call_args[2] == 1200  # total_events_processed


@pytest.mark.asyncio
async def test_save_correlation_telemetry_minimal():
    """save_correlation_telemetry works with missing optional fields."""
    from shared.database.correlation_telemetry import save_correlation_telemetry

    stats = {
        "cycle_count": 1,
        "total_events_processed": 10,
        "cascade_incidents": 0,
    }

    with patch("shared.database.correlation_telemetry.db") as mock_db:
        mock_db.pool = AsyncMock()
        mock_db.execute = AsyncMock(return_value="INSERT 0 1")

        await save_correlation_telemetry(stats)

        mock_db.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_load_latest_correlation_telemetry_returns_row():
    """load_latest returns a dict when data exists and is fresh."""
    from shared.database.correlation_telemetry import load_latest_correlation_telemetry

    now = datetime.now(timezone.utc)
    mock_row = _MockRow(
        cycle_count=42,
        total_events_processed=50000,
        total_incidents_created=300,
        cascade_incidents=250,
        residual_incidents=50,
        processed_set_size=180000,
        last_duration_ms=150.0,
        last_cycle_events=500,
        last_cycle_incidents=5,
        cascade_enabled=True,
        worker_id="worker-01",
        recorded_at=now,
    )

    with patch("shared.database.correlation_telemetry.db") as mock_db:
        mock_db.pool = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        result = await load_latest_correlation_telemetry(max_age_seconds=3600)
        assert result is not None
        assert result["cycle_count"] == 42
        assert result["total_events_processed"] == 50000
        assert result["cascade_incidents"] == 250
        assert result["last_cycle_incidents"] == 5
        assert result["worker_id"] == "worker-01"
        assert "recorded_at" in result


@pytest.mark.asyncio
async def test_load_latest_correlation_telemetry_no_data():
    """load_latest returns None when no rows exist."""
    from shared.database.correlation_telemetry import load_latest_correlation_telemetry

    with patch("shared.database.correlation_telemetry.db") as mock_db:
        mock_db.pool = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=None)

        result = await load_latest_correlation_telemetry()
        assert result is None


@pytest.mark.asyncio
async def test_load_latest_correlation_telemetry_stale_data():
    """load_latest returns None when data is older than max_age."""
    from shared.database.correlation_telemetry import load_latest_correlation_telemetry

    stale_time = datetime.now(timezone.utc) - timedelta(hours=2)
    mock_row = _MockRow(
        cycle_count=1,
        total_events_processed=10,
        total_incidents_created=1,
        cascade_incidents=1,
        residual_incidents=0,
        processed_set_size=100,
        last_duration_ms=50.0,
        last_cycle_events=10,
        last_cycle_incidents=1,
        cascade_enabled=False,
        worker_id=None,
        recorded_at=stale_time,
    )

    with patch("shared.database.correlation_telemetry.db") as mock_db:
        mock_db.pool = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        result = await load_latest_correlation_telemetry(max_age_seconds=300)
        assert result is None, "Should return None for stale data"


@pytest.mark.asyncio
async def test_load_latest_no_pool():
    """load_latest returns None when db pool is not connected."""
    from shared.database.correlation_telemetry import load_latest_correlation_telemetry

    with patch("shared.database.correlation_telemetry.db") as mock_db:
        mock_db.pool = None

        result = await load_latest_correlation_telemetry()
        assert result is None


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(app)


@patch("api.routes.correlation.load_latest_correlation_telemetry")
def test_get_correlation_stats_returns_data(mock_load, client):
    """GET /correlation/stats returns telemetry when data exists."""
    now = datetime.now(timezone.utc)
    mock_load.return_value = {
        "cycle_count": 42,
        "total_events_processed": 50000,
        "total_incidents_created": 300,
        "cascade_incidents": 250,
        "residual_incidents": 50,
        "processed_set_size": 180000,
        "last_duration_ms": 150.0,
        "last_cycle_events": 500,
        "last_cycle_incidents": 5,
        "cascade_enabled": True,
        "worker_id": "worker-01",
        "recorded_at": now.isoformat(),
    }

    resp = client.get("/correlation/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "active"
    assert data["stats"]["cycle_count"] == 42
    assert data["stats"]["last_cycle_incidents"] == 5
    assert data["stats"]["worker_id"] == "worker-01"


@patch("api.routes.correlation.load_latest_correlation_telemetry")
def test_get_correlation_stats_no_data(mock_load, client):
    """GET /correlation/stats returns no_data status when no telemetry exists."""
    mock_load.return_value = None

    resp = client.get("/correlation/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "no_data"
    assert "message" in data


@patch("api.routes.correlation.load_latest_correlation_telemetry")
def test_get_correlation_stats_inactive(mock_load, client):
    """GET /correlation/stats returns inactive when cycle_count is 0."""
    mock_load.return_value = {
        "cycle_count": 0,
        "total_events_processed": 0,
        "total_incidents_created": 0,
        "cascade_incidents": 0,
        "residual_incidents": 0,
        "processed_set_size": 0,
        "last_duration_ms": 0.0,
        "last_cycle_events": 0,
        "last_cycle_incidents": 0,
        "cascade_enabled": False,
        "worker_id": None,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }

    resp = client.get("/correlation/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "inactive"
