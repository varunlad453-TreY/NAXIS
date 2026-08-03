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

# Single source of truth for "active" — shared by the service layer and the
# stats aggregate so KPI definitions can never drift apart.
ACTIVE_STATUS_VALUES = [
    IncidentStatus.OPEN.value,
    IncidentStatus.INVESTIGATING.value,
    IncidentStatus.MITIGATED.value,
]


def _row_to_incident(row) -> Incident:
    """Convert an asyncpg Row to an Incident model."""
    confidence_breakdown = row.get("confidence_breakdown")
    if confidence_breakdown is not None and not isinstance(confidence_breakdown, dict):
        try:
            import json
            confidence_breakdown = json.loads(confidence_breakdown) if isinstance(confidence_breakdown, str) else dict(confidence_breakdown)
        except (TypeError, ValueError):
            confidence_breakdown = None

    return Incident(
        incident_id=row["incident_id"],
        title=row["title"],
        severity=IncidentSeverity(row["severity"]),
        status=IncidentStatus(row["status"]),
        affected_sites=list(row["affected_sites"] or []),
        affected_devices=list(row["affected_devices"] or []),
        affected_clients=list(row["affected_clients"] or []),
        root_device_ids=list(row.get("root_device_ids") or []),
        symptom_device_ids=list(row.get("symptom_device_ids") or []),
        related_event_ids=list(row["related_event_ids"] or []),
        probable_cause=row["probable_cause"],
        confidence_score=float(row["confidence_score"]),
        confidence_breakdown=confidence_breakdown,
        created_at=row["created_at"].replace(tzinfo=None),
        updated_at=row["updated_at"].replace(tzinfo=None),
    )


async def insert_incident(incident: Incident) -> None:
    """Insert a new incident. Ignores if incident_id already exists."""
    d = incident.to_db_dict()
    confidence_breakdown = (
        json.dumps(d["confidence_breakdown"]) if d["confidence_breakdown"] else None
    )
    await db.execute(
        """
        INSERT INTO incidents (
            incident_id, title, severity, status,
            affected_sites, affected_devices, affected_clients,
            root_device_ids, symptom_device_ids,
            related_event_ids, probable_cause, confidence_score,
            confidence_breakdown,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9,
            $10, $11, $12,
            $13,
            $14, $15
        )
        ON CONFLICT (incident_id) DO NOTHING
        """,
        d["incident_id"], d["title"], d["severity"], d["status"],
        d["affected_sites"], d["affected_devices"], d["affected_clients"],
        d["root_device_ids"], d["symptom_device_ids"],
        d["related_event_ids"], d["probable_cause"], d["confidence_score"],
        confidence_breakdown,
        d["created_at"], d["updated_at"],
    )


async def upsert_incident(incident: Incident) -> None:
    """Insert or update an incident (used by correlation engine)."""
    d = incident.to_db_dict()
    confidence_breakdown = (
        json.dumps(d["confidence_breakdown"]) if d["confidence_breakdown"] else None
    )
    await db.execute(
        """
        INSERT INTO incidents (
            incident_id, title, severity, status,
            affected_sites, affected_devices, affected_clients,
            root_device_ids, symptom_device_ids,
            related_event_ids, probable_cause, confidence_score,
            confidence_breakdown,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9,
            $10, $11, $12,
            $13,
            $14, $15
        )
        ON CONFLICT (incident_id) DO UPDATE SET
            title                = EXCLUDED.title,
            severity             = EXCLUDED.severity,
            status               = EXCLUDED.status,
            affected_sites       = EXCLUDED.affected_sites,
            affected_devices     = EXCLUDED.affected_devices,
            affected_clients     = EXCLUDED.affected_clients,
            root_device_ids      = EXCLUDED.root_device_ids,
            symptom_device_ids   = EXCLUDED.symptom_device_ids,
            related_event_ids    = EXCLUDED.related_event_ids,
            probable_cause       = EXCLUDED.probable_cause,
            confidence_score     = EXCLUDED.confidence_score,
            confidence_breakdown = EXCLUDED.confidence_breakdown,
            updated_at           = EXCLUDED.updated_at
        """,
        d["incident_id"], d["title"], d["severity"], d["status"],
        d["affected_sites"], d["affected_devices"], d["affected_clients"],
        d["root_device_ids"], d["symptom_device_ids"],
        d["related_event_ids"], d["probable_cause"], d["confidence_score"],
        confidence_breakdown,
        d["created_at"], d["updated_at"],
    )


async def get_incident(incident_id: str) -> Optional[Incident]:
    """Fetch a single incident by ID. Returns None if not found."""
    row = await db.fetchrow(
        "SELECT * FROM incidents WHERE incident_id = $1",
        incident_id,
    )
    return _row_to_incident(row) if row else None


async def resolve_open_incidents_for_devices(device_ids: List[str]) -> int:
    """
    Resolve OPEN incidents whose root cause is one of the given devices.

    Called by the correlation engine when a DEVICE_REACHABLE recovery
    event arrives.  Only OPEN incidents are auto-resolved — operator-managed
    states (INVESTIGATING, MITIGATED, ...) are left alone.

    Returns the number of incidents resolved.
    """
    rows = await db.fetch(
        """
        UPDATE incidents
        SET status = $1, updated_at = NOW()
        WHERE status = $2
          AND root_device_ids && $3::text[]
        RETURNING incident_id
        """,
        IncidentStatus.RESOLVED.value,
        IncidentStatus.OPEN.value,
        device_ids,
    )
    return len(rows)


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


async def get_incident_stats() -> dict:
    """
    Single-pass SQL aggregates for incident KPIs.

    Returns truthful totals regardless of any page size:
      total           — all incidents
      active          — incidents in an actionable (non-terminal) state
      by_severity     — counts per severity
      distinct_sites  — distinct site_ids across all affected_sites arrays
      distinct_devices— distinct device_ids across all affected_devices arrays
      avg_confidence  — mean confidence_score (0.0 when no incidents)
    """
    row = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                          AS total,
            COUNT(*) FILTER (WHERE status = ANY($1::text[]))  AS active,
            (SELECT COUNT(DISTINCT s)
               FROM incidents AS i2, unnest(i2.affected_sites) AS s)   AS distinct_sites,
            (SELECT COUNT(DISTINCT d)
               FROM incidents AS i2, unnest(i2.affected_devices) AS d) AS distinct_devices,
            COALESCE(AVG(confidence_score), 0.0)              AS avg_confidence
        FROM incidents
        """,
        ACTIVE_STATUS_VALUES,
    )

    severity_rows = await db.fetch(
        "SELECT severity, COUNT(*) AS cnt FROM incidents GROUP BY severity"
    )
    by_severity = {s.value: 0 for s in IncidentSeverity}
    for r in severity_rows:
        by_severity[r["severity"]] = int(r["cnt"])

    return {
        "total": int(row["total"]),
        "active": int(row["active"]),
        "by_severity": by_severity,
        "distinct_sites": int(row["distinct_sites"]),
        "distinct_devices": int(row["distinct_devices"]),
        "avg_confidence": float(row["avg_confidence"]),
    }
