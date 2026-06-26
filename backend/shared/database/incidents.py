"""
Incidents repository — Postgres CRUD operations.
"""

import json
import logging
from datetime import datetime
from typing import List, Optional

from ..models.incident import Incident, IncidentSeverity, IncidentStatus
from .client import db

logger = logging.getLogger(__name__)


def _row_to_incident(row) -> Incident:
    """Convert an asyncpg Row to an Incident model."""
    return Incident(
        incident_id=row["incident_id"],
        title=row["title"],
        severity=IncidentSeverity(row["severity"]),
        status=IncidentStatus(row["status"]),
        affected_sites=list(row["affected_sites"] or []),
        affected_devices=list(row["affected_devices"] or []),
        affected_clients=list(row["affected_clients"] or []),
        related_event_ids=list(row["related_event_ids"] or []),
        probable_cause=row["probable_cause"],
        confidence_score=float(row["confidence_score"]),
        created_at=row["created_at"].replace(tzinfo=None),
        updated_at=row["updated_at"].replace(tzinfo=None),
    )


async def insert_incident(incident: Incident) -> None:
    """Insert a new incident. Ignores if incident_id already exists."""
    d = incident.to_db_dict()
    await db.execute(
        """
        INSERT INTO incidents (
            incident_id, title, severity, status,
            affected_sites, affected_devices, affected_clients,
            related_event_ids, probable_cause, confidence_score,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12
        )
        ON CONFLICT (incident_id) DO NOTHING
        """,
        d["incident_id"], d["title"], d["severity"], d["status"],
        d["affected_sites"], d["affected_devices"], d["affected_clients"],
        d["related_event_ids"], d["probable_cause"], d["confidence_score"],
        d["created_at"], d["updated_at"],
    )


async def upsert_incident(incident: Incident) -> None:
    """Insert or update an incident (used by correlation engine)."""
    d = incident.to_db_dict()
    await db.execute(
        """
        INSERT INTO incidents (
            incident_id, title, severity, status,
            affected_sites, affected_devices, affected_clients,
            related_event_ids, probable_cause, confidence_score,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12
        )
        ON CONFLICT (incident_id) DO UPDATE SET
            title             = EXCLUDED.title,
            severity          = EXCLUDED.severity,
            status            = EXCLUDED.status,
            affected_sites    = EXCLUDED.affected_sites,
            affected_devices  = EXCLUDED.affected_devices,
            affected_clients  = EXCLUDED.affected_clients,
            related_event_ids = EXCLUDED.related_event_ids,
            probable_cause    = EXCLUDED.probable_cause,
            confidence_score  = EXCLUDED.confidence_score,
            updated_at        = EXCLUDED.updated_at
        """,
        d["incident_id"], d["title"], d["severity"], d["status"],
        d["affected_sites"], d["affected_devices"], d["affected_clients"],
        d["related_event_ids"], d["probable_cause"], d["confidence_score"],
        d["created_at"], d["updated_at"],
    )


async def get_incident(incident_id: str) -> Optional[Incident]:
    """Fetch a single incident by ID. Returns None if not found."""
    row = await db.fetchrow(
        "SELECT * FROM incidents WHERE incident_id = $1",
        incident_id,
    )
    return _row_to_incident(row) if row else None


async def list_incidents(
    status_filter: Optional[List[IncidentStatus]] = None,
    severity_filter: Optional[List[str]] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Incident]:
    """List incidents with optional filters, sorted newest first."""
    conditions = []
    params = []

    if status_filter:
        params.append([s.value for s in status_filter])
        conditions.append(f"status = ANY(${len(params)})")

    if severity_filter:
        params.append(severity_filter)
        conditions.append(f"severity = ANY(${len(params)})")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    params.append(limit)
    params.append(offset)

    rows = await db.fetch(
        f"""
        SELECT * FROM incidents
        {where}
        ORDER BY created_at DESC
        LIMIT ${len(params) - 1} OFFSET ${len(params)}
        """,
        *params,
    )
    return [_row_to_incident(r) for r in rows]


async def count_incidents(
    status_filter: Optional[List[IncidentStatus]] = None,
    severity_filter: Optional[List[str]] = None,
) -> int:
    """Count incidents matching the given filters."""
    conditions = []
    params = []

    if status_filter:
        params.append([s.value for s in status_filter])
        conditions.append(f"status = ANY(${len(params)})")

    if severity_filter:
        params.append(severity_filter)
        conditions.append(f"severity = ANY(${len(params)})")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    row = await db.fetchrow(
        f"SELECT COUNT(*) AS cnt FROM incidents {where}",
        *params,
    )
    return int(row["cnt"])
