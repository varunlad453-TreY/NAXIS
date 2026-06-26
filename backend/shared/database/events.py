"""
Events repository — Postgres CRUD operations.
"""

import logging
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
        metadata=dict(row["metadata"]) if row["metadata"] else {},
        raw_event=dict(row["raw_event"]) if row["raw_event"] else None,
    )


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


async def insert_events(events: List[UnifiedEvent]) -> None:
    """Bulk insert a list of events."""
    for event in events:
        await insert_event(event)


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
