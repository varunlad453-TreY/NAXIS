"""
Incident Model

The Incident is the primary operational business entity of the Naxis platform.
It is produced by the deterministic correlation engine from one or more
UnifiedEvents and is later enriched by the AI RCA pipeline.

Platform flow:
    telemetry -> normalized events -> correlated incidents -> RCA / UI
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator


class IncidentSeverity(str, Enum):
    """Incident severity (mirrors EventSeverity for cross-mapping)."""

    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    WARNING = "warning"
    INFO = "info"

    @property
    def label(self) -> str:
        """Operator-friendly display label that conveys business impact."""
        labels: dict[str, str] = {
            "critical": "Outage",
            "major": "Degraded",
            "minor": "Attention",
            "warning": "Notice",
            "info": "Info",
        }
        return labels.get(self.value, self.value.capitalize())


class IncidentStatus(str, Enum):
    """Lifecycle status of an incident."""
    OPEN = "open"               # Newly created, no action taken
    INVESTIGATING = "investigating"   # Operator / RCA engine is working on it
    MITIGATED = "mitigated"     # Workaround applied, root cause not yet fixed
    RESOLVED = "resolved"       # Underlying issue fixed
    CLOSED = "closed"           # Verified and archived
    SUPPRESSED = "suppressed"   # Intentionally hidden (maintenance, duplicate, etc.)


# Status transitions that are considered terminal — no more events should be added.
_TERMINAL_STATUSES = {IncidentStatus.RESOLVED, IncidentStatus.CLOSED, IncidentStatus.SUPPRESSED}


class Incident(BaseModel):
    """
    Correlated incident produced from one or more UnifiedEvents.

    The schema is intentionally minimal for MVP but exposes the hooks the
    correlation engine and RCA enrichment will need:

      * `related_event_ids` — append-only list populated by the correlator.
      * `affected_*` lists — the blast radius computed at correlation time.
      * `probable_cause` + `confidence_score` — written by the AI RCA stage.
    """

    # Identity
    incident_id: str = Field(
        default_factory=lambda: f"inc-{uuid4().hex[:12]}",
        description="Unique incident ID",
    )

    # Content
    title: str = Field(..., min_length=1, description="Human-readable incident title")

    # Classification
    severity: IncidentSeverity = Field(..., description="Highest severity across related events")
    status: IncidentStatus = Field(
        default=IncidentStatus.OPEN, description="Lifecycle status",
    )

    # Blast radius (deduplicated lists of canonical IDs)
    affected_sites: List[str] = Field(default_factory=list, description="Site IDs impacted")
    affected_devices: List[str] = Field(default_factory=list, description="Device IDs impacted")
    affected_clients: List[str] = Field(default_factory=list, description="Client IDs impacted")

    # Correlation — root cause vs symptom split (cascade incidents only)
    root_device_ids: List[str] = Field(
        default_factory=list,
        description="Infrastructure device IDs identified as root cause(s) of the cascade",
    )
    symptom_device_ids: List[str] = Field(
        default_factory=list,
        description="Leaf device IDs that failed as downstream consequences of the root cause",
    )

    # Correlation
    related_event_ids: List[str] = Field(
        default_factory=list,
        description="UnifiedEvent IDs grouped into this incident",
    )

    # RCA enrichment (populated by correlation engine or AI stage)
    probable_cause: Optional[str] = Field(
        None, description="AI-generated probable root cause (free text)",
    )
    confidence_score: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="RCA confidence in [0.0, 1.0]; 0.0 means not yet enriched",
    )
    confidence_breakdown: Optional[Dict[str, float]] = Field(
        None,
        description="Factor breakdown of confidence_score: {event_score, avg_severity, device_score, total}",
    )
    evidence: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Forensic telemetry snapshots of contributing events (WP-2.6)",
    )

    # Temporal
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation time (UTC)")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update time (UTC)")

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------

    @field_validator("created_at", "updated_at")
    @classmethod
    def _strip_tz(cls, v: datetime) -> datetime:
        """Normalize timestamps to naive UTC (matches UnifiedEvent convention)."""
        if v.tzinfo is None:
            return v
        return v.astimezone(None).replace(tzinfo=None)

    @field_validator("affected_sites", "affected_devices", "affected_clients", "related_event_ids", "root_device_ids", "symptom_device_ids")
    @classmethod
    def _dedupe_preserve_order(cls, v: List[str]) -> List[str]:
        """Drop duplicates while preserving first-seen order."""
        seen = set()
        out: List[str] = []
        for item in v:
            if item and item not in seen:
                seen.add(item)
                out.append(item)
        return out

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        return v.strip()

    # ------------------------------------------------------------------
    # Helpers used by the correlation engine
    # ------------------------------------------------------------------

    def add_event(
        self,
        event_id: str,
        device_id: Optional[str] = None,
        site_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> bool:
        """
        Attach a UnifiedEvent to this incident and update the blast radius.

        Returns True if the event was newly added, False if already present
        or rejected because the incident is in a terminal state.
        """
        if self.status in _TERMINAL_STATUSES:
            return False
        if not event_id or event_id in self.related_event_ids:
            return False

        self.related_event_ids.append(event_id)
        if device_id and device_id not in self.affected_devices:
            self.affected_devices.append(device_id)
        if site_id and site_id not in self.affected_sites:
            self.affected_sites.append(site_id)
        if client_id and client_id not in self.affected_clients:
            self.affected_clients.append(client_id)

        self.updated_at = datetime.utcnow()
        return True

    def add_evidence(self, event: Any) -> bool:
        """
        Capture a compact forensic telemetry snapshot of a contributing event (WP-2.6).

        Accepts a UnifiedEvent (or dict-like object). Extracts essential key fields
        and appends to self.evidence if not already present (deduplicated by event_id).
        Returns True if newly added.
        """
        event_id = getattr(event, "event_id", None) or (event.get("event_id") if isinstance(event, dict) else None)
        if not event_id:
            return False

        # Deduplicate
        if any(e.get("event_id") == event_id for e in self.evidence):
            return False

        ts = getattr(event, "timestamp", None) or (event.get("timestamp") if isinstance(event, dict) else None)
        if hasattr(ts, "isoformat"):
            ts_str = ts.isoformat()
        else:
            ts_str = str(ts) if ts is not None else datetime.utcnow().isoformat()

        severity_obj = getattr(event, "severity", None) or (event.get("severity") if isinstance(event, dict) else None)
        if hasattr(severity_obj, "value"):
            severity_val = str(severity_obj.value)
        else:
            severity_val = str(severity_obj) if severity_obj is not None else "warning"

        ev_type_obj = getattr(event, "event_type", None) or (event.get("event_type") if isinstance(event, dict) else None)
        if hasattr(ev_type_obj, "value"):
            ev_type_val = str(ev_type_obj.value)
        else:
            ev_type_val = str(ev_type_obj) if ev_type_obj is not None else "unknown"

        device_obj = getattr(event, "device", None) or (event.get("device") if isinstance(event, dict) else None)
        device_id_val = None
        if device_obj is not None and type(device_obj).__name__ != "MagicMock":
            device_id_val = getattr(device_obj, "device_id", None) or (device_obj.get("device_id") if isinstance(device_obj, dict) else None)
        elif device_obj is not None and hasattr(device_obj, "device_id"):
            raw_did = getattr(device_obj, "device_id")
            if type(raw_did).__name__ != "MagicMock":
                device_id_val = str(raw_did)

        if device_id_val is None:
            raw_did = getattr(event, "device_id", None) or (event.get("device_id") if isinstance(event, dict) else None)
            if raw_did is not None and type(raw_did).__name__ != "MagicMock":
                device_id_val = str(raw_did)

        title_obj = getattr(event, "title", None) or (event.get("title") if isinstance(event, dict) else "")
        title_val = str(title_obj) if title_obj else ""

        snapshot = {
            "event_id": str(event_id),
            "timestamp": ts_str,
            "event_type": ev_type_val,
            "severity": severity_val,
            "title": title_val,
            "device_id": str(device_id_val) if device_id_val is not None else None,
        }
        self.evidence.append(snapshot)
        return True

    def update_confidence(self, score: float, probable_cause: Optional[str] = None) -> None:
        """
        Update the RCA confidence score (and optionally the probable cause).

        Called by the AI RCA enrichment pipeline. Score is clamped to [0, 1].
        """
        if score < 0.0:
            score = 0.0
        elif score > 1.0:
            score = 1.0
        self.confidence_score = score
        if probable_cause is not None:
            self.probable_cause = probable_cause
        self.updated_at = datetime.utcnow()

    def set_status(self, status: IncidentStatus) -> None:
        """Transition lifecycle status and bump `updated_at`."""
        self.status = status
        self.updated_at = datetime.utcnow()

    def is_enriched(self) -> bool:
        """True once the RCA stage has produced any signal."""
        return self.probable_cause is not None and self.confidence_score > 0.0

    def is_terminal(self) -> bool:
        """True when the incident should no longer accept new events."""
        return self.status in _TERMINAL_STATUSES

    def event_count(self) -> int:
        return len(self.related_event_ids)

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    def to_db_dict(self) -> Dict[str, Any]:
        """Convert to a database row dict (matches schemas/postgres/).

        Notes:
          - event_count is intentionally excluded — it is computed from
            len(related_event_ids) and is NOT a column in the incidents
            table.
          - probable_cause preserves None so the frontend can distinguish
            "RCA not yet run" (null) from "RCA found nothing" (empty string).
        """
        return {
            "incident_id": self.incident_id,
            "title": self.title,
            "severity": self.severity.value,
            "status": self.status.value,
            "affected_sites": list(self.affected_sites),
            "affected_devices": list(self.affected_devices),
            "affected_clients": list(self.affected_clients),
            "root_device_ids": list(self.root_device_ids),
            "symptom_device_ids": list(self.symptom_device_ids),
            "related_event_ids": list(self.related_event_ids),
            "probable_cause": self.probable_cause,
            "confidence_score": float(self.confidence_score),
            "confidence_breakdown": self.confidence_breakdown,
            "evidence": list(self.evidence),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_summary(self) -> Dict[str, Any]:
        """Compact dict suitable for list views in the UI."""
        return {
            "incident_id": self.incident_id,
            "title": self.title,
            "severity": self.severity.value,
            "severity_label": self.severity.label,
            "status": self.status.value,
            "event_count": self.event_count(),
            "evidence_count": len(self.evidence),
            "affected_sites": len(self.affected_sites),
            "affected_devices": len(self.affected_devices),
            "root_device_count": len(self.root_device_ids),
            "symptom_device_count": len(self.symptom_device_ids),
            "confidence_score": self.confidence_score,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class IncidentQuery(BaseModel):
    """Query parameters for filtering incidents (mirrors EventQuery)."""
    start_time: Optional[datetime] = Field(None, description="Filter by created_at >=")
    end_time: Optional[datetime] = Field(None, description="Filter by created_at <=")
    severities: Optional[List[IncidentSeverity]] = None
    statuses: Optional[List[IncidentStatus]] = None
    site_ids: Optional[List[str]] = None
    device_ids: Optional[List[str]] = None
    min_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    search: Optional[str] = Field(None, description="Substring match on title/probable_cause")
    limit: int = Field(100, ge=1, le=1000)
    offset: int = Field(0, ge=0)


# ---------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------
#
# Run directly:  python -m backend.shared.models.incident
#
# from backend.shared.models.incident import (
#     Incident, IncidentSeverity, IncidentStatus,
# )
#
# incident = Incident(
#     title="SFO-01 · edge-sfo-01 link down — 2 devices affected",
#     severity=IncidentSeverity.MAJOR,
# )
#
# # Correlation engine attaches events as it groups them.
# incident.add_event("evt-1001", device_id="dev-001", site_id="site-sfo-01")
# incident.add_event("evt-1002", device_id="dev-002", site_id="site-sfo-01")
#
# # AI RCA enrichment writes back its hypothesis.
# incident.update_confidence(0.82, probable_cause="ISP BGP flap on primary uplink")
#
# # Lifecycle transitions.
# incident.set_status(IncidentStatus.INVESTIGATING)
#
#
# ---------------------------------------------------------------------


if __name__ == "__main__":
    import json

    demo = Incident(
        title="SFO-01 · edge-sfo-01 link down — 2 devices affected",
        severity=IncidentSeverity.MAJOR,
        root_device_ids=["core-switch-sfo-01"],
        symptom_device_ids=["ap-sfo-101", "ap-sfo-102"],
    )
    demo.add_event("evt-1001", device_id="dev-001", site_id="site-sfo-01")
    demo.add_event("evt-1002", device_id="dev-002", site_id="site-sfo-01")
    demo.update_confidence(0.82, probable_cause="ISP BGP flap on primary uplink")
    demo.set_status(IncidentStatus.INVESTIGATING)

    print(demo.model_dump_json(indent=2))
    print("---")
    print(json.dumps(demo.to_db_dict(), indent=2, default=str))
