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
            confidence_breakdown = json.loads(confidence_breakdown) if isinstance(confidence_breakdown, str) else dict(confidence_breakdown)
        except (TypeError, ValueError):
            confidence_breakdown = None

    raw_evidence = row.get("evidence")
    if isinstance(raw_evidence, str):
        try:
            evidence = json.loads(raw_evidence)
        except (TypeError, ValueError):
            evidence = []
    elif isinstance(raw_evidence, list):
        evidence = list(raw_evidence)
    else:
        evidence = []

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
        inferred_root=bool(row.get("inferred_root") or False),
        related_event_ids=list(row["related_event_ids"] or []),
        probable_cause=row["probable_cause"],
        evidence=evidence,
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
    evidence_json = json.dumps(d.get("evidence", []))
    await db.execute(
        """
        INSERT INTO incidents (
            incident_id, title, severity, status,
            affected_sites, affected_devices, affected_clients,
            root_device_ids, symptom_device_ids, inferred_root,
            related_event_ids, probable_cause, confidence_score,
            confidence_breakdown, evidence,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13,
            $14, $15::jsonb,
            $16, $17
        )
        ON CONFLICT (incident_id) DO NOTHING
        """,
        d["incident_id"], d["title"], d["severity"], d["status"],
        d["affected_sites"], d["affected_devices"], d["affected_clients"],
        d["root_device_ids"], d["symptom_device_ids"], d["inferred_root"],
        d["related_event_ids"], d["probable_cause"], d["confidence_score"],
        confidence_breakdown, evidence_json,
        d["created_at"], d["updated_at"],
    )


async def upsert_incident(incident: Incident) -> None:
    """Insert or update an incident (used by correlation engine).

    On conflict (same incident_id):
      - Arrays (related_event_ids, affected_*, symptom_device_ids) are
        MERGED (union) so evidence accumulates across cycles.
      - evidence JSONB array is MERGED and deduplicated by event_id.
      - severity only escalates — never downgrades.
      - Terminal statuses (resolved/closed/suppressed) are preserved.
      - created_at is preserved — only updated_at moves forward.
      - root_device_ids is REPLACED — current cycle's root-cause is
        authoritative.
      - confidence_score takes the MAX.
      - probable_cause keeps existing if new is NULL.
    """
    d = incident.to_db_dict()
    confidence_breakdown = (
        json.dumps(d["confidence_breakdown"]) if d["confidence_breakdown"] else None
    )
    evidence_json = json.dumps(d.get("evidence", []))
    await db.execute(
        """
        INSERT INTO incidents (
            incident_id, title, severity, status,
            affected_sites, affected_devices, affected_clients,
            root_device_ids, symptom_device_ids, inferred_root,
            related_event_ids, probable_cause, confidence_score,
            confidence_breakdown, evidence,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13,
            $14, $15::jsonb,
            $16, $17
        )
        ON CONFLICT (incident_id) DO UPDATE SET
            title                = EXCLUDED.title,
            severity             = CASE
                                     WHEN incidents.severity = 'critical' THEN 'critical'
                                     WHEN EXCLUDED.severity  = 'critical' THEN 'critical'
                                     WHEN incidents.severity = 'major'    THEN 'major'
                                     WHEN EXCLUDED.severity  = 'major'    THEN 'major'
                                     WHEN incidents.severity = 'minor'    THEN 'minor'
                                     WHEN EXCLUDED.severity  = 'minor'    THEN 'minor'
                                     WHEN incidents.severity = 'warning'  THEN 'warning'
                                     WHEN EXCLUDED.severity  = 'warning'  THEN 'warning'
                                     ELSE EXCLUDED.severity
                                   END,
            status               = CASE
                                     WHEN incidents.status IN ('resolved','closed','suppressed')
                                     THEN incidents.status
                                     ELSE EXCLUDED.status
                                   END,
            affected_sites       = (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(
                                      incidents.affected_sites || EXCLUDED.affected_sites) AS x
                                    WHERE x IS NOT NULL),
            affected_devices     = (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(
                                      incidents.affected_devices || EXCLUDED.affected_devices) AS x
                                    WHERE x IS NOT NULL),
            affected_clients     = (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(
                                      incidents.affected_clients || EXCLUDED.affected_clients) AS x
                                    WHERE x IS NOT NULL),
            root_device_ids      = EXCLUDED.root_device_ids,
            symptom_device_ids   = (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(
                                      incidents.symptom_device_ids || EXCLUDED.symptom_device_ids) AS x
                                    WHERE x IS NOT NULL),
            -- Once the root device reports for itself the root stops being a
            -- deduction, so this only ever goes true -> false.
            inferred_root        = incidents.inferred_root AND EXCLUDED.inferred_root,
            related_event_ids    = (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(
                                      incidents.related_event_ids || EXCLUDED.related_event_ids) AS x
                                    WHERE x IS NOT NULL),
            evidence             = (
                                     SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                                     FROM (
                                         SELECT DISTINCT ON (elem->>'event_id') elem
                                         FROM jsonb_array_elements(incidents.evidence || EXCLUDED.evidence) AS elem
                                     ) sub
                                   ),
            probable_cause       = COALESCE(EXCLUDED.probable_cause, incidents.probable_cause),
            confidence_score     = GREATEST(incidents.confidence_score, EXCLUDED.confidence_score),
            confidence_breakdown = COALESCE(EXCLUDED.confidence_breakdown, incidents.confidence_breakdown),
            updated_at           = EXCLUDED.updated_at
            -- NOTE: created_at intentionally NOT updated — preserves original creation time
        """,
        d["incident_id"], d["title"], d["severity"], d["status"],
        d["affected_sites"], d["affected_devices"], d["affected_clients"],
        d["root_device_ids"], d["symptom_device_ids"], d["inferred_root"],
        d["related_event_ids"], d["probable_cause"], d["confidence_score"],
        confidence_breakdown, evidence_json,
        d["created_at"], d["updated_at"],
    )


async def get_incident_status(incident_id: str) -> Optional[str]:
    """Fetch only the status of an existing incident (lightweight).

    Used by the correlation engine to check whether an incident is
    in a terminal state before upserting new evidence.  Returns
    None if the incident does not exist.
    """
    row = await db.fetchrow(
        "SELECT status FROM incidents WHERE incident_id = $1",
        incident_id,
    )
    return row["status"] if row else None


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


async def resolve_stale_incidents(stale_hours: int = 48) -> int:
    """
    Resolve OPEN incidents that have received no new evidence for
    ``stale_hours``.

    Auto-close is otherwise purely event-driven: an incident only resolves
    when a recovery event arrives for its root device
    (``resolve_open_incidents_for_devices``). A device that recovered before
    the incident was raised — or whose recovery event has since rolled out of
    the 24-48h event buffer — leaves an incident that can never be closed by
    any future event. Retention only prunes ``resolved`` rows, so those
    incidents accumulate forever.

    Once an incident's evidence has aged past the event buffer there is
    nothing left to re-confirm it against, so it stops being an active claim.

    Only OPEN is swept — operator-managed states are left alone, matching
    ``resolve_open_incidents_for_devices``.

    Returns the number of incidents resolved.
    """
    rows = await db.fetch(
        """
        UPDATE incidents
        SET status = $1, updated_at = NOW()
        WHERE status = $2
          AND updated_at < NOW() - ($3 || ' hours')::interval
        RETURNING incident_id
        """,
        IncidentStatus.RESOLVED.value,
        IncidentStatus.OPEN.value,
        str(stale_hours),
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


async def resolve_display_names(
    site_ids: List[str], root_device_ids: List[str]
) -> tuple:
    """
    Batch-resolve operator-facing display names for a page of incidents (WP-2.7).

    Multi-Tier Resolution Pipeline:
      1. Canonical Identity Tables (`sites`, `devices`, `device_identities`)
      2. Inventory Table (`inventory`)
      3. Events Table Fallback (`events`)

    Guarantees device/site display names resolve permanently even after raw events
    are pruned by the 48-hour WP-2.4 retention policy.
    """
    site_names: Dict[str, str] = {}
    device_names: Dict[str, str] = {}

    site_ids = [s for s in site_ids if s]
    root_device_ids = [d for d in root_device_ids if d]
    if not site_ids and not root_device_ids:
        return site_names, device_names

    # --- Site Resolution ---
    if site_ids:
        unique_sites = list(dict.fromkeys(site_ids))

        # Tier 1a: Canonical sites table by site_key
        try:
            s_rows = await db.fetch(
                """
                SELECT site_key, name FROM sites
                WHERE site_key = ANY($1::text[]) AND name <> ''
                """,
                unique_sites,
            )
            for r in s_rows:
                if r.get("site_key") and r.get("name"):
                    site_names[r["site_key"]] = r["name"]
        except Exception:
            pass

        # Tier 1b: Canonical sites table by vendor_ids JSONB
        unresolved_sites = [s for s in unique_sites if s not in site_names]
        if unresolved_sites:
            try:
                s_rows2 = await db.fetch(
                    """
                    SELECT s.name, v.value AS vendor_site_id
                    FROM sites s, jsonb_each_text(s.vendor_ids) AS v
                    WHERE v.value = ANY($1::text[]) AND s.name <> ''
                    """,
                    unresolved_sites,
                )
                for r in s_rows2:
                    if r.get("vendor_site_id") and r.get("name"):
                        site_names[r["vendor_site_id"]] = r["name"]
            except Exception:
                pass

        # Tier 2: Inventory table
        unresolved_sites = [s for s in unique_sites if s not in site_names]
        if unresolved_sites:
            try:
                inv_rows = await db.fetch(
                    """
                    SELECT DISTINCT site_id, site_name
                    FROM inventory
                    WHERE site_id = ANY($1::text[]) AND site_name <> ''
                    """,
                    unresolved_sites,
                )
                for r in inv_rows:
                    if r.get("site_id") and r.get("site_name"):
                        site_names[r["site_id"]] = r["site_name"]
            except Exception:
                pass

        # Tier 3: Events table fallback
        unresolved_sites = [s for s in unique_sites if s not in site_names]
        if unresolved_sites:
            try:
                ev_rows = await db.fetch(
                    """
                    SELECT DISTINCT ON (site_id) site_id, site_name
                    FROM events
                    WHERE site_id = ANY($1::text[]) AND site_name <> ''
                    ORDER BY site_id, timestamp DESC
                    """,
                    unresolved_sites,
                )
                for r in ev_rows:
                    if r.get("site_id") and r.get("site_name"):
                        site_names[r["site_id"]] = r["site_name"]
            except Exception:
                pass

    # --- Device Display Name Resolution ---
    if root_device_ids:
        unique_devs = list(dict.fromkeys(root_device_ids))

        # Tier 1a: Canonical devices table by device_key
        try:
            d_rows = await db.fetch(
                """
                SELECT device_key, display_name FROM devices
                WHERE device_key = ANY($1::text[]) AND display_name <> ''
                """,
                unique_devs,
            )
            for r in d_rows:
                if r.get("device_key") and r.get("display_name"):
                    device_names[r["device_key"]] = r["display_name"]
        except Exception:
            pass

        # Tier 1b: Canonical device_identities table (vendor_device_id -> display_name)
        unresolved_devs = [d for d in unique_devs if d not in device_names]
        if unresolved_devs:
            try:
                di_rows = await db.fetch(
                    """
                    SELECT di.vendor_device_id, COALESCE(NULLIF(d.display_name, ''), di.vendor_display_name) AS resolved_name
                    FROM device_identities di
                    JOIN devices d ON di.device_key = d.device_key
                    WHERE di.vendor_device_id = ANY($1::text[])
                      AND COALESCE(NULLIF(d.display_name, ''), di.vendor_display_name, '') <> ''
                    """,
                    unresolved_devs,
                )
                for r in di_rows:
                    if r.get("vendor_device_id") and r.get("resolved_name"):
                        device_names[r["vendor_device_id"]] = r["resolved_name"]
            except Exception:
                pass

        # Tier 2: Inventory table
        unresolved_devs = [d for d in unique_devs if d not in device_names]
        if unresolved_devs:
            try:
                inv_dev_rows = await db.fetch(
                    """
                    SELECT device_id, hostname
                    FROM inventory
                    WHERE device_id = ANY($1::text[]) AND hostname <> ''
                    """,
                    unresolved_devs,
                )
                for r in inv_dev_rows:
                    if r.get("device_id") and r.get("hostname"):
                        device_names[r["device_id"]] = r["hostname"]
            except Exception:
                pass

        # Tier 3: Events table fallback
        unresolved_devs = [d for d in unique_devs if d not in device_names]
        if unresolved_devs:
            try:
                ev_dev_rows = await db.fetch(
                    """
                    SELECT DISTINCT ON (device_id) device_id, device_name
                    FROM events
                    WHERE device_id = ANY($1::text[]) AND device_name <> ''
                    ORDER BY device_id, (device_name = device_id) ASC, timestamp DESC
                    """,
                    unresolved_devs,
                )
                for r in ev_dev_rows:
                    if r.get("device_id") and r.get("device_name"):
                        device_names[r["device_id"]] = r["device_name"]
            except Exception:
                pass

    return site_names, device_names


async def get_incident_stats() -> dict:
    """
    Single-pass SQL aggregates for incident KPIs.

    Returns truthful totals regardless of any page size:
      total           — all incidents, every status, all time
      active          — incidents in an actionable (non-terminal) state
      by_severity     — counts per severity, ACTIVE only
      distinct_sites  — distinct site_ids across active affected_sites arrays
      distinct_devices— distinct device_ids across active affected_devices arrays
      avg_confidence  — mean confidence_score across active incidents (0.0 when none)

    Everything except ``total`` is scoped to active incidents. These feed NOC
    KPI tiles that sit next to ``active``, so counting resolved history in them
    renders the panel self-contradictory — it read "Critical 61,749" beside
    "Active 3,652" once the stale-incident sweep began resolving a backlog.
    """
    row = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                          AS total,
            COUNT(*) FILTER (WHERE status = ANY($1::text[]))  AS active,
            (SELECT COUNT(DISTINCT s)
               FROM incidents AS i2, unnest(i2.affected_sites) AS s
              WHERE i2.status = ANY($1::text[]))                       AS distinct_sites,
            (SELECT COUNT(DISTINCT d)
               FROM incidents AS i2, unnest(i2.affected_devices) AS d
              WHERE i2.status = ANY($1::text[]))                       AS distinct_devices,
            COALESCE(AVG(confidence_score) FILTER (WHERE status = ANY($1::text[])), 0.0)
                                                              AS avg_confidence
        FROM incidents
        """,
        ACTIVE_STATUS_VALUES,
    )

    severity_rows = await db.fetch(
        "SELECT severity, COUNT(*) AS cnt FROM incidents WHERE status = ANY($1::text[]) GROUP BY severity",
        ACTIVE_STATUS_VALUES,
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
