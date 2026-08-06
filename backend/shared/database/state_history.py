"""
State History Repository (WP-2.5)

Provides diff-on-write state transition recording for devices and links.
Maintains fast L1 in-memory caches to evaluate diffs in <1ms without DB overhead.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from ..models.state_history import DeviceStateTransition, LinkStateTransition
from .client import db

logger = logging.getLogger(__name__)

# L1 Cache: key -> (current_state, recorded_at_dt)
_latest_device_states: Dict[str, Tuple[str, datetime]] = {}
_latest_link_states: Dict[str, Tuple[str, datetime]] = {}


def clear_state_history_cache() -> None:
    """Clear L1 in-memory caches (useful in tests)."""
    global _latest_device_states, _latest_link_states
    _latest_device_states.clear()
    _latest_link_states.clear()


def _row_to_device_transition(row) -> DeviceStateTransition:
    recorded = row["recorded_at"]
    if hasattr(recorded, "replace"):
        recorded = recorded.replace(tzinfo=None)
    return DeviceStateTransition(
        history_id=row["history_id"],
        device_key=row["device_key"],
        site_key=row.get("site_key"),
        previous_state=row.get("previous_state"),
        new_state=row["new_state"],
        duration_seconds=float(row["duration_seconds"]) if row.get("duration_seconds") is not None else None,
        transition_reason=row.get("transition_reason"),
        event_id=row.get("event_id"),
        recorded_at=recorded,
    )


def _row_to_link_transition(row) -> LinkStateTransition:
    recorded = row["recorded_at"]
    if hasattr(recorded, "replace"):
        recorded = recorded.replace(tzinfo=None)
    return LinkStateTransition(
        history_id=row["history_id"],
        link_key=row["link_key"],
        parent_node_id=row["parent_node_id"],
        child_node_id=row["child_node_id"],
        previous_state=row.get("previous_state"),
        new_state=row["new_state"],
        duration_seconds=float(row["duration_seconds"]) if row.get("duration_seconds") is not None else None,
        transition_reason=row.get("transition_reason"),
        event_id=row.get("event_id"),
        recorded_at=recorded,
    )


async def record_device_state_transition(
    device_key: str,
    new_state: str,
    previous_state: Optional[str] = None,
    transition_reason: Optional[str] = None,
    event_id: Optional[str] = None,
    site_key: Optional[str] = None,
    timestamp: Optional[datetime] = None,
) -> Optional[DeviceStateTransition]:
    """
    Record a device state transition using Diff-on-Write semantics.

    If new_state equals the cached current state, the update is silently
    ignored (returns None) to guarantee ZERO database bloat.
    """
    if not device_key or not new_state:
        return None

    now = timestamp or datetime.now(timezone.utc)

    # 1. Diff-on-Write evaluation via L1 cache
    cached = _latest_device_states.get(device_key)
    if cached is not None:
        curr_state, curr_time = cached
        if curr_state == new_state:
            # State did not change — ignore (diff-on-write)
            return None
        prev_state = curr_state
        duration_sec = max(0.0, (now - curr_time).total_seconds())
    else:
        prev_state = previous_state
        duration_sec = None

    # 2. Update L1 cache immediately
    _latest_device_states[device_key] = (new_state, now)

    # 3. Persist transition row to PostgreSQL
    try:
        rows = await db.fetch(
            """
            INSERT INTO device_state_history (
                device_key, site_key, previous_state, new_state,
                duration_seconds, transition_reason, event_id, recorded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            """,
            device_key,
            site_key,
            prev_state,
            new_state,
            duration_sec,
            transition_reason,
            event_id,
            now,
        )
        if rows:
            return _row_to_device_transition(rows[0])
    except Exception as e:
        logger.error(f"Failed to record device state transition for {device_key}: {e}", exc_info=True)

    return DeviceStateTransition(
        device_key=device_key,
        site_key=site_key,
        previous_state=prev_state,
        new_state=new_state,
        duration_seconds=duration_sec,
        transition_reason=transition_reason,
        event_id=event_id,
        recorded_at=now.replace(tzinfo=None) if hasattr(now, "replace") else now,
    )


async def record_link_state_transition(
    parent_node_id: str,
    child_node_id: str,
    new_state: str,
    link_key: Optional[str] = None,
    previous_state: Optional[str] = None,
    transition_reason: Optional[str] = None,
    event_id: Optional[str] = None,
    timestamp: Optional[datetime] = None,
) -> Optional[LinkStateTransition]:
    """
    Record a topology link state transition using Diff-on-Write semantics.
    """
    if not parent_node_id or not child_node_id or not new_state:
        return None

    resolved_link_key = link_key or f"{parent_node_id}->{child_node_id}"
    now = timestamp or datetime.now(timezone.utc)

    # 1. Diff-on-Write evaluation via L1 cache
    cached = _latest_link_states.get(resolved_link_key)
    if cached is not None:
        curr_state, curr_time = cached
        if curr_state == new_state:
            return None
        prev_state = curr_state
        duration_sec = max(0.0, (now - curr_time).total_seconds())
    else:
        prev_state = previous_state
        duration_sec = None

    # 2. Update L1 cache
    _latest_link_states[resolved_link_key] = (new_state, now)

    # 3. Persist transition row to PostgreSQL
    try:
        rows = await db.fetch(
            """
            INSERT INTO link_state_history (
                link_key, parent_node_id, child_node_id, previous_state, new_state,
                duration_seconds, transition_reason, event_id, recorded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            """,
            resolved_link_key,
            parent_node_id,
            child_node_id,
            prev_state,
            new_state,
            duration_sec,
            transition_reason,
            event_id,
            now,
        )
        if rows:
            return _row_to_link_transition(rows[0])
    except Exception as e:
        logger.error(f"Failed to record link state transition for {resolved_link_key}: {e}", exc_info=True)

    return LinkStateTransition(
        link_key=resolved_link_key,
        parent_node_id=parent_node_id,
        child_node_id=child_node_id,
        previous_state=prev_state,
        new_state=new_state,
        duration_seconds=duration_sec,
        transition_reason=transition_reason,
        event_id=event_id,
        recorded_at=now.replace(tzinfo=None) if hasattr(now, "replace") else now,
    )


async def get_device_state_history(
    device_key: str, limit: int = 100, offset: int = 0
) -> List[DeviceStateTransition]:
    """Retrieve chronological state transition history for a device."""
    try:
        rows = await db.fetch(
            """
            SELECT * FROM device_state_history
            WHERE device_key = $1
            ORDER BY recorded_at DESC
            LIMIT $2 OFFSET $3
            """,
            device_key,
            limit,
            offset,
        )
        return [_row_to_device_transition(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch device state history for {device_key}: {e}", exc_info=True)
        return []


async def get_link_state_history(
    link_key: Optional[str] = None,
    parent_node_id: Optional[str] = None,
    child_node_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[LinkStateTransition]:
    """Retrieve chronological state transition history for a topology link."""
    try:
        if link_key:
            rows = await db.fetch(
                """
                SELECT * FROM link_state_history
                WHERE link_key = $1
                ORDER BY recorded_at DESC
                LIMIT $2 OFFSET $3
                """,
                link_key,
                limit,
                offset,
            )
        elif parent_node_id and child_node_id:
            rows = await db.fetch(
                """
                SELECT * FROM link_state_history
                WHERE parent_node_id = $1 AND child_node_id = $2
                ORDER BY recorded_at DESC
                LIMIT $3 OFFSET $4
                """,
                parent_node_id,
                child_node_id,
                limit,
                offset,
            )
        else:
            rows = await db.fetch(
                """
                SELECT * FROM link_state_history
                ORDER BY recorded_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit,
                offset,
            )
        return [_row_to_link_transition(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to fetch link state history: {e}", exc_info=True)
        return []
