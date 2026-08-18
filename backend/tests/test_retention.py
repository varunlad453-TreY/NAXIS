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
        "incidents": 42,
        "raw_event_strip": 42,
    }
    queries = [call.args[0] for call in execute.call_args_list]
    assert "recorded_at" in queries[0], "correlation_telemetry must prune on recorded_at"
    assert "created_at" in queries[1]
    assert "snapshot_at" in queries[2]
    assert "DELETE FROM events" in queries[3]
    assert "timestamp" in queries[3]
    assert "DELETE FROM incidents" in queries[4]
    assert "status = 'resolved'" in queries[4], "open incidents must never be pruned"
    assert "UPDATE events" in queries[5]
    assert "raw_event = NULL" in queries[5]


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
    assert cutoffs[4] == now - timedelta(days=180)
    assert cutoffs[5] == now - timedelta(days=7)


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


@pytest.mark.asyncio
async def test_events_are_deleted_in_batches_until_drained():
    """A backlog larger than one batch must loop, not issue one unbounded DELETE.

    An unbounded DELETE over millions of rows cannot finish inside the worker's
    per-pass watchdog, and cancellation rolls it back — so the backlog never
    shrinks.
    """
    retention.db.pool = object()
    # Two full batches of events, then a partial one; everything else empty.
    responses = {
        "DELETE FROM events": ["DELETE 10", "DELETE 10", "DELETE 3"],
        "UPDATE events": ["UPDATE 10", "UPDATE 2"],
    }

    async def _execute(query, *args):
        for marker, queue in responses.items():
            if marker in query:
                return queue.pop(0) if queue else "DELETE 0"
        return "DELETE 0"

    with patch.object(retention.db, "execute", AsyncMock(side_effect=_execute)):
        result = await retention.run_retention(batch_size=10)

    assert result["events"] == 23
    assert result["raw_event_strip"] == 12
    assert "truncated" not in result


@pytest.mark.asyncio
async def test_batch_budget_stops_work_and_reports_truncation():
    """With the budget exhausted, retention stops and says so instead of
    running until the pass watchdog kills it."""
    retention.db.pool = object()

    async def _always_full(query, *args):
        return "DELETE 10" if "events" in query else "DELETE 0"

    with patch.object(retention.db, "execute", AsyncMock(side_effect=_always_full)):
        result = await retention.run_retention(batch_size=10, max_seconds=0)

    assert result["truncated"] == ["events", "raw_event_strip"]
    assert result["events"] == 10


@pytest.mark.asyncio
async def test_batched_queries_are_bounded_by_limit():
    retention.db.pool = object()
    execute = AsyncMock(return_value="DELETE 0")
    with patch.object(retention.db, "execute", execute):
        await retention.run_retention(batch_size=500)

    queries = {call.args[0]: call.args for call in execute.call_args_list}
    events_q = next(q for q in queries if "DELETE FROM events" in q)
    strip_q = next(q for q in queries if "UPDATE events" in q)
    assert "LIMIT $2" in events_q
    assert "LIMIT $2" in strip_q
    assert queries[events_q][2] == 500
    assert queries[strip_q][2] == 500
