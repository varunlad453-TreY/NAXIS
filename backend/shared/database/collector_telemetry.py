"""
Collector telemetry repository.

Persists worker and collector run outcomes so runtime health is derived from
the live worker rather than static integration labels.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .client import db


TERMINAL_STATUSES = {"success", "error", "skipped"}


@dataclass
class CollectorRunResult:
    collector_id: str
    source_system: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    rows_written: int = 0
    error_text: Optional[str] = None

    @property
    def duration_ms(self) -> Optional[int]:
        if self.finished_at is None:
            return None
        ms = int((self.finished_at - self.started_at).total_seconds() * 1000)
        # Clock skew / tz drift can produce a negative duration; clamp to 0
        # so the telemetry ledger never shows impossible runtimes.
        return max(0, ms)


async def ensure_collector_telemetry_schema() -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS collector_run_ledger (
            run_id          BIGSERIAL PRIMARY KEY,
            collector_id    TEXT        NOT NULL,
            source_system   TEXT        NOT NULL,
            started_at      TIMESTAMPTZ NOT NULL,
            finished_at     TIMESTAMPTZ,
            status          TEXT        NOT NULL,
            duration_ms     INTEGER,
            rows_written    INTEGER     NOT NULL DEFAULT 0,
            error_text      TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_collector_run_ledger_collector_started "
        "ON collector_run_ledger (collector_id, started_at DESC)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_collector_run_ledger_source_started "
        "ON collector_run_ledger (source_system, started_at DESC)"
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS worker_heartbeat (
            worker_id      TEXT        PRIMARY KEY,
            heartbeat_at   TIMESTAMPTZ NOT NULL,
            cycle_status   TEXT        NOT NULL,
            message        TEXT,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


async def record_worker_heartbeat(
    worker_id: str,
    cycle_status: str,
    message: Optional[str] = None,
) -> None:
    await db.execute(
        """
        INSERT INTO worker_heartbeat (worker_id, heartbeat_at, cycle_status, message)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (worker_id) DO UPDATE SET
            heartbeat_at = EXCLUDED.heartbeat_at,
            cycle_status = EXCLUDED.cycle_status,
            message = EXCLUDED.message,
            updated_at = NOW()
        """,
        worker_id,
        datetime.now(timezone.utc),
        cycle_status,
        message,
    )


async def record_collector_run(result: CollectorRunResult) -> None:
    await db.execute(
        """
        INSERT INTO collector_run_ledger (
            collector_id, source_system, started_at, finished_at, status,
            duration_ms, rows_written, error_text
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        result.collector_id,
        result.source_system,
        result.started_at,
        result.finished_at,
        result.status,
        result.duration_ms,
        result.rows_written,
        result.error_text,
    )


async def list_collector_telemetry() -> List[Dict]:
    rows = await db.fetch(
        """
        WITH latest AS (
            SELECT DISTINCT ON (collector_id)
                collector_id, source_system, started_at, finished_at, status,
                duration_ms, rows_written, error_text
            FROM collector_run_ledger
            ORDER BY collector_id, started_at DESC
        ),
        last_success AS (
            SELECT DISTINCT ON (collector_id)
                collector_id, finished_at AS last_success_at
            FROM collector_run_ledger
            WHERE status = 'success'
            ORDER BY collector_id, started_at DESC
        ),
        failures AS (
            SELECT
                collector_id,
                COUNT(*) FILTER (WHERE status = 'error') AS failure_count
            FROM collector_run_ledger
            GROUP BY collector_id
        )
        SELECT
            l.collector_id, l.source_system, l.started_at, l.finished_at,
            l.status, l.duration_ms, l.rows_written, l.error_text,
            s.last_success_at, COALESCE(f.failure_count, 0) AS failure_count
        FROM latest l
        LEFT JOIN last_success s USING (collector_id)
        LEFT JOIN failures f USING (collector_id)
        ORDER BY l.source_system, l.collector_id
        """
    )
    now = datetime.now(timezone.utc)
    telemetry: List[Dict] = []
    for row in rows:
        finished_at = row["finished_at"]
        last_success_at = row["last_success_at"]
        age_seconds = None
        if last_success_at is not None:
            age_seconds = int((now - last_success_at).total_seconds())

        telemetry.append(
            {
                "collector_id": row["collector_id"],
                "source_system": row["source_system"],
                "last_run": row["finished_at"] or row["started_at"],
                "last_success": last_success_at,
                "last_error": row["error_text"],
                "last_status": row["status"],
                "failure_count": int(row["failure_count"] or 0),
                "current_age_seconds": age_seconds,
                "duration_ms": row["duration_ms"],
                "rows_written": row["rows_written"],
            }
        )
    return telemetry

