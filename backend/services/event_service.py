"""
Event Service

Business logic layer for normalized network events.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.config.settings import get_settings
from backend.db.base import init_db
from backend.db.models import Device as DeviceORM
from backend.db.models import Event as EventORM
from backend.db.models import Site as SiteORM
from backend.shared.models.event import UnifiedEvent

logger = logging.getLogger(__name__)


def _event_to_orm(event: UnifiedEvent) -> EventORM:
    """Convert Pydantic UnifiedEvent to SQLAlchemy Event row."""
    return EventORM(
        event_id=event.event_id,
        timestamp=event.timestamp,
        received_at=event.received_at,
        source=event.source.value,
        source_event_id=event.source_event_id,
        severity=event.severity.value,
        category=event.category.value,
        event_type=event.event_type.value,
        title=event.title,
        description=event.description,
        device_id=event.device.device_id if event.device else None,
        site_id=event.device.site_id if event.device else None,
        client_id=event.client.client_id if event.client else None,
        client_mac=event.client.client_mac if event.client else None,
        client_ip=event.client.client_ip if event.client else None,
        interface_name=event.interface.interface_name if event.interface else None,
        tags=list(event.tags),
        incident_id=event.incident_id,
        correlation_key=event.correlation_key,
        event_metadata=dict(event.metadata),
        raw_event=dict(event.raw_event) if event.raw_event else None,
    )


def _orm_to_event_dict(orm: EventORM) -> Dict[str, Any]:
    """Convert SQLAlchemy Event row to a plain dict for API responses."""
    return {
        "event_id": orm.event_id,
        "timestamp": orm.timestamp,
        "received_at": orm.received_at,
        "source": orm.source,
        "source_event_id": orm.source_event_id,
        "severity": orm.severity,
        "category": orm.category,
        "event_type": orm.event_type,
        "title": orm.title,
        "description": orm.description,
        "device_id": orm.device_id,
        "device_name": orm.device.hostname if orm.device else None,
        "site_id": orm.site_id,
        "site_name": orm.site.name if orm.site else None,
        "client_id": orm.client_id,
        "client_mac": orm.client_mac,
        "client_ip": orm.client_ip,
        "interface_name": orm.interface_name,
        "tags": list(orm.tags or []),
        "incident_id": orm.incident_id,
        "correlation_key": orm.correlation_key,
        "metadata": orm.event_metadata,
        "raw_event": orm.raw_event,
    }


class EventService:
    """Service layer for event operations."""

    def __init__(self):
        self._settings = get_settings()
        self._use_postgres = self._settings.is_postgres_enabled
        self._memory: Dict[str, UnifiedEvent] = {}
        logger.info(
            "EventService initialized (storage=%s)",
            "postgres" if self._use_postgres else "memory",
        )

    async def _ensure_tables(self) -> None:
        """Create tables if using PostgreSQL (idempotent)."""
        if self._use_postgres:
            await init_db()

    async def add_event(self, event: UnifiedEvent) -> None:
        """Store a single event."""
        await self._ensure_tables()
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                session.add(_event_to_orm(event))
                await session.commit()
        else:
            self._memory[event.event_id] = event

    async def add_events(self, events: List[UnifiedEvent]) -> int:
        """Store a batch of events."""
        if not events:
            return 0
        await self._ensure_tables()
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                session.add_all([_event_to_orm(e) for e in events])
                await session.commit()
        else:
            for event in events:
                self._memory[event.event_id] = event
        logger.info("Stored %d events", len(events))
        return len(events)

    async def list_events(
        self,
        source: Optional[str] = None,
        severity: Optional[str] = None,
        site_id: Optional[str] = None,
        device_id: Optional[str] = None,
        incident_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List events with optional filters. Returns (rows, total_count)."""
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine
            from sqlalchemy import func, select

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                query = select(EventORM).order_by(EventORM.timestamp.desc())
                count_query = select(func.count(EventORM.event_id))

                if source:
                    query = query.where(EventORM.source == source)
                    count_query = count_query.where(EventORM.source == source)
                if severity:
                    query = query.where(EventORM.severity == severity)
                    count_query = count_query.where(EventORM.severity == severity)
                if site_id:
                    query = query.where(EventORM.site_id == site_id)
                    count_query = count_query.where(EventORM.site_id == site_id)
                if device_id:
                    query = query.where(EventORM.device_id == device_id)
                    count_query = count_query.where(EventORM.device_id == device_id)
                if incident_id:
                    query = query.where(EventORM.incident_id == incident_id)
                    count_query = count_query.where(EventORM.incident_id == incident_id)
                if start_time:
                    query = query.where(EventORM.timestamp >= start_time)
                    count_query = count_query.where(EventORM.timestamp >= start_time)
                if end_time:
                    query = query.where(EventORM.timestamp <= end_time)
                    count_query = count_query.where(EventORM.timestamp <= end_time)

                total_result = await session.execute(count_query)
                total = total_result.scalar() or 0

                result = await session.execute(query.offset(offset).limit(limit))
                rows = [_orm_to_event_dict(orm) for orm in result.scalars().all()]
                return rows, total

        events = list(self._memory.values())
        if source:
            events = [e for e in events if e.source.value == source]
        if severity:
            events = [e for e in events if e.severity.value == severity]
        if site_id:
            events = [e for e in events if e.device and e.device.site_id == site_id]
        if device_id:
            events = [e for e in events if e.device and e.device.device_id == device_id]
        if incident_id:
            events = [e for e in events if e.incident_id == incident_id]
        if start_time:
            events = [e for e in events if e.timestamp >= start_time]
        if end_time:
            events = [e for e in events if e.timestamp <= end_time]
        events.sort(key=lambda e: e.timestamp, reverse=True)
        total = len(events)
        return [e.model_dump() for e in events[offset : offset + limit]], total


# Global singleton instance
event_service = EventService()
