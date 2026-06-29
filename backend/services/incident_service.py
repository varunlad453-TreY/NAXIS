"""
Incident Service

Business logic layer for incident operations.
Supports two storage backends selected via STORAGE_MODE:
  - memory: in-process dict (default for tests and demos)
  - postgres: persistent PostgreSQL tables
"""

import logging
from typing import Any, Dict, List, Optional

from backend.config.settings import get_settings
from backend.db.base import init_db
from backend.db.models import Incident as IncidentORM
from backend.shared.models.incident import Incident, IncidentStatus

logger = logging.getLogger(__name__)


def _orm_to_incident(orm: IncidentORM) -> Incident:
    """Convert SQLAlchemy Incident row to Pydantic Incident."""
    return Incident(
        incident_id=orm.incident_id,
        title=orm.title,
        severity=orm.severity,
        status=orm.status,
        affected_sites=list(orm.affected_sites or []),
        affected_devices=list(orm.affected_devices or []),
        affected_clients=list(orm.affected_clients or []),
        related_event_ids=list(orm.related_event_ids or []),
        probable_cause=orm.probable_cause or None,
        confidence_score=float(orm.confidence_score or 0.0),
        created_at=orm.created_at,
        updated_at=orm.updated_at,
    )


class IncidentService:
    """Service layer for incident operations."""

    def __init__(self):
        self._settings = get_settings()
        self._memory: Dict[str, Incident] = {}
        self._use_postgres = self._settings.is_postgres_enabled
        logger.info(
            "IncidentService initialized (storage=%s)",
            "postgres" if self._use_postgres else "memory",
        )

    async def _ensure_tables(self) -> None:
        """Create tables if using PostgreSQL (idempotent)."""
        if self._use_postgres:
            await init_db()

    def _incident_to_orm(self, incident: Incident, orm: Optional[IncidentORM] = None) -> IncidentORM:
        """Convert Pydantic Incident to SQLAlchemy Incident row."""
        if orm is None:
            orm = IncidentORM(incident_id=incident.incident_id)
        orm.title = incident.title
        orm.severity = incident.severity.value
        orm.status = incident.status.value
        orm.affected_sites = list(incident.affected_sites)
        orm.affected_devices = list(incident.affected_devices)
        orm.affected_clients = list(incident.affected_clients)
        orm.related_event_ids = list(incident.related_event_ids)
        orm.probable_cause = incident.probable_cause or ""
        orm.confidence_score = float(incident.confidence_score)
        orm.created_at = incident.created_at
        orm.updated_at = incident.updated_at
        return orm

    async def add_incident(self, incident: Incident) -> None:
        """Add or update an incident."""
        await self._ensure_tables()
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                existing = await session.get(IncidentORM, incident.incident_id)
                if existing:
                    self._incident_to_orm(incident, existing)
                else:
                    session.add(self._incident_to_orm(incident))
                await session.commit()
        else:
            self._memory[incident.incident_id] = incident
        logger.info("Added incident: %s | %s", incident.incident_id, incident.severity.value)

    async def add_incidents(self, incidents: List[Incident]) -> None:
        """Bulk add incidents."""
        if not incidents:
            return
        await self._ensure_tables()
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                for incident in incidents:
                    existing = await session.get(IncidentORM, incident.incident_id)
                    if existing:
                        self._incident_to_orm(incident, existing)
                    else:
                        session.add(self._incident_to_orm(incident))
                await session.commit()
        else:
            for incident in incidents:
                self._memory[incident.incident_id] = incident
        logger.info("Bulk added %d incidents", len(incidents))

    async def get_incident(self, incident_id: str) -> Optional[Incident]:
        """Retrieve incident by ID."""
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                orm = await session.get(IncidentORM, incident_id)
                return _orm_to_incident(orm) if orm else None
        return self._memory.get(incident_id)

    async def list_incidents(
        self,
        status_filter: Optional[List[IncidentStatus]] = None,
        severity_filter: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Incident]:
        """List incidents with optional filters."""
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine
            from sqlalchemy import select

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                query = select(IncidentORM).order_by(IncidentORM.created_at.desc())
                if status_filter:
                    query = query.where(
                        IncidentORM.status.in_([s.value for s in status_filter])
                    )
                if severity_filter:
                    query = query.where(IncidentORM.severity.in_(severity_filter))
                result = await session.execute(query.offset(offset).limit(limit))
                return [_orm_to_incident(orm) for orm in result.scalars().all()]

        incidents = list(self._memory.values())
        if status_filter:
            incidents = [i for i in incidents if i.status in status_filter]
        if severity_filter:
            incidents = [i for i in incidents if i.severity.value in severity_filter]
        incidents.sort(key=lambda i: i.created_at, reverse=True)
        return incidents[offset : offset + limit]

    async def get_active_incidents(self) -> List[Incident]:
        """Get incidents that are not yet resolved."""
        active_statuses = [
            IncidentStatus.OPEN,
            IncidentStatus.INVESTIGATING,
            IncidentStatus.MITIGATED,
        ]
        return await self.list_incidents(status_filter=active_statuses)

    async def count_incidents(
        self,
        status_filter: Optional[List[IncidentStatus]] = None,
        severity_filter: Optional[List[str]] = None,
    ) -> int:
        """Count incidents matching filters."""
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine
            from sqlalchemy import func, select

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                query = select(func.count(IncidentORM.incident_id))
                if status_filter:
                    query = query.where(
                        IncidentORM.status.in_([s.value for s in status_filter])
                    )
                if severity_filter:
                    query = query.where(IncidentORM.severity.in_(severity_filter))
                result = await session.execute(query)
                return result.scalar() or 0

        incidents = list(self._memory.values())
        if status_filter:
            incidents = [i for i in incidents if i.status in status_filter]
        if severity_filter:
            incidents = [i for i in incidents if i.severity.value in severity_filter]
        return len(incidents)

    async def clear_all(self) -> None:
        """Clear all incidents from storage (for testing)."""
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine
            from sqlalchemy import delete

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                await session.execute(delete(IncidentORM))
                await session.commit()
        count = len(self._memory)
        self._memory.clear()
        logger.info("Cleared %d incidents from memory storage", count)

    async def get_stats(self) -> Dict[str, Any]:
        """Get incident statistics."""
        incidents = await self.list_incidents(limit=10000)
        stats = {
            "total": len(incidents),
            "by_status": {},
            "by_severity": {},
        }
        for incident in incidents:
            status = incident.status.value
            stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
            severity = incident.severity.value
            stats["by_severity"][severity] = stats["by_severity"].get(severity, 0) + 1
        return stats


# Global singleton instance
incident_service = IncidentService()
