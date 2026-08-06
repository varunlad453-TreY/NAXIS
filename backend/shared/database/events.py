"""
Events repository — Postgres CRUD operations.
"""

import logging
import json
from datetime import datetime
from typing import List, Optional

from ..models.event import (
    EventCategory,
    EventSource,
    EventSeverity,
    EventType,
    UnifiedEvent,
    DeviceInfo,
    ClientInfo,
    InterfaceInfo,
)
from .client import db

logger = logging.getLogger(__name__)


def _as_json(value):
    """asyncpg returns jsonb as str; tests may pass dicts."""
    if value is None:
        return None
    return json.loads(value) if isinstance(value, str) else value


def _row_to_event(row) -> UnifiedEvent:
    """Convert an asyncpg Row to a UnifiedEvent model."""
    device = None
    if row["device_id"]:
        device = DeviceInfo(
            device_id=row["device_id"],
            device_name=row["device_name"] or None,
            device_ip=row["device_ip"] or None,
            device_type=row["device_type"] or None,
            site_id=row["site_id"] or None,
            site_name=row["site_name"] or None,
        )

    client = None
    if row["client_id"]:
        client = ClientInfo(
            client_id=row["client_id"],
            client_mac=row["client_mac"] or None,
            client_ip=row["client_ip"] or None,
        )

    interface = None
    if row["interface_name"]:
        interface = InterfaceInfo(interface_name=row["interface_name"])

    return UnifiedEvent(
        event_id=row["event_id"],
        timestamp=row["timestamp"].replace(tzinfo=None),
        received_at=row["received_at"].replace(tzinfo=None),
        source=EventSource(row["source"]),
        source_event_id=row["source_event_id"] or None,
        severity=EventSeverity(row["severity"]),
        category=EventCategory(row["category"]),
        event_type=EventType(row["event_type"]),
        title=row["title"],
        description=row["description"],
        device=device,
        client=client,
        interface=interface,
        tags=list(row["tags"] or []),
        incident_id=row["incident_id"] or None,
        correlation_key=row["correlation_key"] or None,
        metadata=_as_json(row["metadata"]) or {},
        raw_event=_as_json(row["raw_event"]),
    )


async def _record_state_history_for_event(event: UnifiedEvent) -> None:
    """Hook to record device or link state history transitions if applicable."""
    try:
        ev_type = event.event_type.value if hasattr(event.event_type, "value") else str(event.event_type)
        if ev_type in (EventType.DEVICE_UNREACHABLE.value, EventType.DEVICE_REACHABLE.value):
            if event.device and event.device.device_id:
                new_state = "offline" if ev_type == EventType.DEVICE_UNREACHABLE.value else "online"
                from .state_history import record_device_state_transition
                await record_device_state_transition(
                    device_key=event.device.device_id,
                    new_state=new_state,
                    transition_reason=ev_type,
                    event_id=event.event_id,
                    site_key=event.device.site_id if event.device else None,
                    timestamp=event.timestamp,
                )
        elif ev_type in (
            EventType.LINK_DOWN.value, EventType.LINK_UP.value,
            EventType.INTERFACE_DOWN.value, EventType.INTERFACE_UP.value,
            EventType.BGP_DOWN.value, EventType.BGP_UP.value,
            EventType.TUNNEL_DOWN.value, EventType.TUNNEL_UP.value,
        ):
            if event.device and event.device.device_id:
                new_state = "down" if "down" in ev_type else "up"
                parent_id = event.device.device_id
                child_id = (event.interface.interface_name if event.interface else None) or "interface"
                from .state_history import record_link_state_transition
                await record_link_state_transition(
                    parent_node_id=parent_id,
                    child_node_id=child_id,
                    new_state=new_state,
                    transition_reason=ev_type,
                    event_id=event.event_id,
                    timestamp=event.timestamp,
                )
    except Exception as e:
        logger.warning(f"Error recording state history for event {event.event_id}: {e}", exc_info=True)


async def insert_event(event: UnifiedEvent) -> None:
    """Insert a normalized event. Ignores if event_id already exists."""
    d = event.to_db_row()
    await db.execute(
        """
        INSERT INTO events (
            event_id, timestamp, received_at,
            source, source_event_id,
            severity, category, event_type,
            title, description,
            device_id, device_name, device_ip, device_type, site_id, site_name,
            client_id, client_mac, client_ip,
            interface_name,
            tags, incident_id, correlation_key,
            metadata, raw_event
        ) VALUES (
            $1, $2, $3,
            $4, $5,
            $6, $7, $8,
            $9, $10,
            $11, $12, $13, $14, $15, $16,
            $17, $18, $19,
            $20,
            $21, $22, $23,
            $24, $25
        )
        ON CONFLICT (event_id) DO NOTHING
        """,
        d["event_id"], d["timestamp"], d["received_at"],
        d["source"], d["source_event_id"] or None,
        d["severity"], d["category"], d["event_type"],
        d["title"], d["description"],
        d["device_id"] or None, d["device_name"] or None,
        d["device_ip"] or None, d["device_type"] or None,
        d["site_id"] or None, d["site_name"] or None,
        d["client_id"] or None, d["client_mac"] or None, d["client_ip"] or None,
        d["interface_name"] or None,
        d["tags"], d["incident_id"] or None, d["correlation_key"] or None,
        d["metadata"], d["raw_event"],
    )
    await _record_state_history_for_event(event)


async def insert_events(events: List[UnifiedEvent]) -> None:
    """Bulk insert a list of events."""
    for event in events:
        await insert_event(event)


async def latest_event_states(source_event_ids: List[str]) -> dict:
    """Return the most recent event per stable ``source_event_id``.

    Polled-state collectors use this to emit events only when the state
    actually changed (diff-on-write): the returned mapping is
    ``{source_event_id: {"event_type": ..., "metadata": {...}}}`` for the
    newest event of each id. Collectors compare it against the current
    poll and skip identical steady states.
    """
    ids = [sid for sid in (source_event_ids or []) if sid]
    if not ids:
        return {}
    rows = await db.fetch(
        """
        SELECT DISTINCT ON (source_event_id)
               source_event_id, event_type, metadata
        FROM events
        WHERE source_event_id = ANY($1::text[])
        ORDER BY source_event_id, timestamp DESC
        """,
        ids,
    )
    return {
        r["source_event_id"]: {
            "event_type": r["event_type"],
            "metadata": _as_json(r["metadata"]) or {},
        }
        for r in rows
    }


async def get_event(event_id: str) -> Optional[UnifiedEvent]:
    """Fetch a single event by ID."""
    row = await db.fetchrow(
        "SELECT * FROM events WHERE event_id = $1",
        event_id,
    )
    return _row_to_event(row) if row else None


async def list_events_for_incident(incident_id: str) -> List[UnifiedEvent]:
    """Fetch all events linked to a given incident."""
    rows = await db.fetch(
        "SELECT * FROM events WHERE incident_id = $1 ORDER BY timestamp DESC",
        incident_id,
    )
    return [_row_to_event(r) for r in rows]


async def get_recent_events(
    since: datetime,
    site_id: Optional[str] = None,
    device_id: Optional[str] = None,
    limit: int = 500,
) -> List[UnifiedEvent]:
    """Fetch recent unprocessed events for the correlation engine."""
    conditions = ["timestamp >= $1"]
    params: list = [since]

    if site_id:
        params.append(site_id)
        conditions.append(f"site_id = ${len(params)}")

    if device_id:
        params.append(device_id)
        conditions.append(f"device_id = ${len(params)}")

    params.append(limit)
    where = " AND ".join(conditions)

    rows = await db.fetch(
        f"""
        SELECT * FROM events
        WHERE {where}
        ORDER BY timestamp ASC
        LIMIT ${len(params)}
        """,
        *params,
    )
    return [_row_to_event(r) for r in rows]


async def link_events_to_incident(event_ids: List[str], incident_id: str) -> None:
    """Update incident_id on a batch of events."""
    await db.execute(
        "UPDATE events SET incident_id = $1 WHERE event_id = ANY($2)",
        incident_id,
        event_ids,
    )
