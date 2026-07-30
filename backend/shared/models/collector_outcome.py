"""
Collector Outcome Model

Structured result returned by every collector on each run.  The worker uses
this to:
  1. Persist the collected events to Postgres
  2. Record a row in the ``collector_run_ledger`` for live telemetry
  3. Derive runtime health for the Integration UI

Every collector must return a ``CollectorOutcome`` — never swallow errors
silently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from .event import UnifiedEvent


@dataclass
class CollectorOutcome:
    """
    Structured result of a single collector run.

    Attributes:
        collector_id:  Unique collector identifier (e.g. ``mist-events``).
        source_system: Vendor slug (``mist``, ``dnac``, ``velocloud``, …).
        status:        ``success`` | ``error`` | ``skipped``.
        started_at:    UTC timestamp when the collector began.
        finished_at:   UTC timestamp when the collector finished (None if still running).
        events:        Normalised ``UnifiedEvent`` objects produced this run.
        rows_written:  Number of events actually persisted (may differ from
                        ``len(events)`` if duplicates were skipped).
        error_text:    Human-readable error message when ``status == "error"``.
        metadata:      Arbitrary per-collector extra data (e.g. page count, API
                        calls made).
    """

    collector_id: str
    source_system: str
    status: str = "success"
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: Optional[datetime] = None
    events: List[UnifiedEvent] = field(default_factory=list)
    rows_written: int = 0
    error_text: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def mark_success(self, rows_written: int) -> None:
        """Mark the run as successful."""
        self.status = "success"
        self.rows_written = rows_written
        self.finished_at = datetime.now(timezone.utc)

    def mark_error(self, error_text: str) -> None:
        """Mark the run as failed."""
        self.status = "error"
        self.error_text = error_text
        self.finished_at = datetime.now(timezone.utc)

    def mark_skipped(self, reason: str = "not configured") -> None:
        """Mark the run as skipped (e.g. collector disabled)."""
        self.status = "skipped"
        self.error_text = reason
        self.finished_at = datetime.now(timezone.utc)

    @property
    def duration_ms(self) -> Optional[int]:
        """Wall-clock duration in milliseconds (None if not yet finished)."""
        if self.finished_at is None:
            return None
        return int((self.finished_at - self.started_at).total_seconds() * 1000)

    @property
    def event_count(self) -> int:
        return len(self.events)

    def to_ledger_row(self) -> dict:
        """Convert to a dict matching the ``collector_run_ledger`` schema."""
        return {
            "collector_id": self.collector_id,
            "source_system": self.source_system,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "rows_written": self.rows_written,
            "error_text": self.error_text,
        }
