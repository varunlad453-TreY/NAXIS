"""
Tests for the retention job (run_retention).

Verifies every pruned table targets its real timestamp column
(correlation_telemetry.recorded_at was previously referenced as
created_at, which does not exist there) and that events are pruned
with the EVENT_RETENTION_DAYS horizon.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

import backend.shared.database.retention as retention


@pytest.fixture(autouse=True)
def _reset_pool():
    yield
    retention.db.pool = None


@pytest.mark.asyncio
async def test_prunes_all_tables_with_correct_columns():
    retention.db.pool = object()
    execute = AsyncMock(return_value="DELETE 42")
    with patch.object(retention.db, "execute", execute):
        result = await retention.run_retention(days=7, event_days=90)

    assert result == {
        "correlation_telemetry": 42,
        "collector_run_ledger": 42,
        "health_snapshots": 42,
        "events": 42,
    }
    queries = [call.args[0] for call in execute.call_args_list]
    assert "recorded_at" in queries[0], "correlation_telemetry must prune on recorded_at"
    assert "created_at" in queries[1]
    assert "snapshot_at" in queries[2]
    assert "DELETE FROM events" in queries[3]
    assert "timestamp" in queries[3]


@pytest.mark.asyncio
async def test_events_use_event_days_cutoff_and_telemetry_uses_days():
    retention.db.pool = object()
    execute = AsyncMock(return_value="DELETE 0")
    now = datetime.now(timezone.utc)
    with patch.object(retention.db, "execute", execute), \
         patch("backend.shared.database.retention.datetime") as dt_mock:
        dt_mock.now.return_value = now
        dt_mock.side_effect = lambda *a, **k: datetime(*a, **k)
        await retention.run_retention(days=7, event_days=90)

    cutoffs = [call.args[1] for call in execute.call_args_list]
    assert cutoffs[0] == now - timedelta(days=7)
    assert cutoffs[1] == now - timedelta(days=7)
    assert cutoffs[2] == now - timedelta(days=7)
    assert cutoffs[3] == now - timedelta(days=90)


@pytest.mark.asyncio
async def test_no_pool_returns_error():
    retention.db.pool = None
    result = await retention.run_retention()
    assert result == {"error": "No database connection"}


@pytest.mark.asyncio
async def test_failure_is_recorded_per_table():
    retention.db.pool = object()
    execute = AsyncMock(side_effect=RuntimeError("boom"))
    with patch.object(retention.db, "execute", execute):
        result = await retention.run_retention()
    assert all(isinstance(v, str) for v in result.values())
