"""
Tests for collector run telemetry, including the negative-duration guard.
"""

from datetime import datetime, timedelta, timezone

from backend.shared.database.collector_telemetry import CollectorRunResult


def _result(finished_delta: timedelta) -> CollectorRunResult:
    started = datetime.now(timezone.utc)
    return CollectorRunResult(
        collector_id="mist-inventory",
        source_system="mist",
        status="success",
        started_at=started,
        finished_at=started + finished_delta,
    )


def test_positive_duration_kept():
    assert _result(timedelta(seconds=42)).duration_ms == 42000


def test_negative_duration_clamped_to_zero():
    # Clock skew / tz drift previously produced impossible negative runtimes
    # (e.g. -29300 ms in the live ledger).
    assert _result(timedelta(seconds=-30)).duration_ms == 0


def test_zero_duration_is_zero():
    assert _result(timedelta(seconds=0)).duration_ms == 0


def test_finished_at_none_returns_none():
    started = datetime.now(timezone.utc)
    result = CollectorRunResult(
        collector_id="c", source_system="s", status="running", started_at=started
    )
    assert result.duration_ms is None
