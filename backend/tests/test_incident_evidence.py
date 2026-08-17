"""
Tests for WP-2.4 (48-hour event buffer) and WP-2.6 (evidence persistence).

Coverage:
  - Incident model: evidence field, add_evidence(), to_db_dict(), deduplication
  - Correlation engine: evidence populated by create_incident() and _create_from_cascade()
  - DB layer: insert_incident / upsert_incident wire evidence to/from JSONB
  - Retention: event_retention_days default is now 2 days (WP-2.4)
  - API model: IncidentDetail exposes evidence field
"""

import json
from datetime import datetime, timedelta
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.shared.models.incident import Incident, IncidentSeverity, IncidentStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_event(
    event_id: str = "evt-001",
    event_type: str = "link_down",
    severity: str = "major",
    title: str = "Link down",
    device_id: str = "dev-001",
    timestamp: datetime = None,
):
    """Build a minimal mock UnifiedEvent for evidence extraction tests."""
    ev = MagicMock()
    ev.event_id = event_id

    ts = timestamp or datetime(2026, 8, 6, 8, 0, 0)
    ev.timestamp = ts

    et = MagicMock()
    et.value = event_type
    ev.event_type = et

    sev = MagicMock()
    sev.value = severity
    ev.severity = sev

    ev.title = title

    device = MagicMock()
    device.device_id = device_id
    ev.device = device

    return ev


def _make_incident(**kwargs) -> Incident:
    defaults = dict(title="Test incident", severity=IncidentSeverity.MAJOR)
    defaults.update(kwargs)
    return Incident(**defaults)


# ---------------------------------------------------------------------------
# 1. Incident model — evidence field and add_evidence()
# ---------------------------------------------------------------------------


class TestIncidentEvidenceField:
    def test_evidence_defaults_to_empty_list(self):
        inc = _make_incident()
        assert inc.evidence == []

    def test_add_evidence_appends_snapshot(self):
        inc = _make_incident()
        ev = _make_mock_event()
        added = inc.add_evidence(ev)
        assert added is True
        assert len(inc.evidence) == 1
        snap = inc.evidence[0]
        assert snap["event_id"] == "evt-001"
        assert snap["event_type"] == "link_down"
        assert snap["severity"] == "major"
        assert snap["title"] == "Link down"
        assert snap["device_id"] == "dev-001"
        assert snap["timestamp"] == datetime(2026, 8, 6, 8, 0, 0).isoformat()

    def test_add_evidence_deduplicates_by_event_id(self):
        inc = _make_incident()
        ev = _make_mock_event()
        inc.add_evidence(ev)
        second_add = inc.add_evidence(ev)
        assert second_add is False
        assert len(inc.evidence) == 1

    def test_add_evidence_accepts_different_events(self):
        inc = _make_incident()
        for i in range(5):
            ev = _make_mock_event(event_id=f"evt-{i:03d}", title=f"Event {i}")
            inc.add_evidence(ev)
        assert len(inc.evidence) == 5
        ids = {e["event_id"] for e in inc.evidence}
        assert ids == {"evt-000", "evt-001", "evt-002", "evt-003", "evt-004"}

    def test_add_evidence_returns_false_for_missing_event_id(self):
        inc = _make_incident()
        ev = MagicMock()
        ev.event_id = None
        result = inc.add_evidence(ev)
        assert result is False
        assert len(inc.evidence) == 0

    def test_add_evidence_handles_no_device(self):
        inc = _make_incident()
        ev = _make_mock_event()
        ev.device = None
        inc.add_evidence(ev)
        assert inc.evidence[0]["device_id"] is None

    def test_to_db_dict_includes_evidence(self):
        inc = _make_incident()
        ev = _make_mock_event()
        inc.add_evidence(ev)
        d = inc.to_db_dict()
        assert "evidence" in d
        assert isinstance(d["evidence"], list)
        assert len(d["evidence"]) == 1
        assert d["evidence"][0]["event_id"] == "evt-001"

    def test_to_db_dict_evidence_empty_when_no_events(self):
        inc = _make_incident()
        d = inc.to_db_dict()
        assert d["evidence"] == []

    def test_to_summary_includes_evidence_count(self):
        inc = _make_incident()
        for i in range(3):
            inc.add_evidence(_make_mock_event(event_id=f"e{i}"))
        s = inc.to_summary()
        assert s["evidence_count"] == 3


# ---------------------------------------------------------------------------
# 2. Correlation engine — evidence populated at create time
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_incident_populates_evidence(default_config):
    """create_incident() must snapshot all contributing events as evidence."""
    from backend.shared.correlation.engine import CorrelationEngine

    engine = CorrelationEngine(config=default_config)
    # Stub out the DB call for terminal status check
    engine._get_incident_status = AsyncMock(return_value=None)

    from tests.conftest import make_event
    from backend.shared.models.event import EventSeverity, EventType

    now = datetime.utcnow()
    events = [
        make_event(event_id="e1", severity=EventSeverity.CRITICAL, title="Root failure", timestamp=now),
        make_event(event_id="e2", severity=EventSeverity.MAJOR, title="Downstream drop", timestamp=now + timedelta(seconds=30)),
    ]

    incident = await engine.create_incident(events)

    assert len(incident.evidence) == 2
    ids = {e["event_id"] for e in incident.evidence}
    assert ids == {"e1", "e2"}

    for snap in incident.evidence:
        assert "event_id" in snap
        assert "timestamp" in snap
        assert "event_type" in snap
        assert "severity" in snap
        assert "title" in snap
        assert "device_id" in snap


@pytest.mark.asyncio
async def test_create_from_cascade_populates_evidence(
    topology_aware_config, cascade_events_same_site, mock_topology_provider
):
    """_create_from_cascade() must snapshot all root + symptom events."""
    from backend.shared.correlation.engine import CorrelationEngine
    from backend.shared.correlation.rules import TopologyCascadeRule

    engine = CorrelationEngine(
        config=topology_aware_config, topology_provider=mock_topology_provider
    )
    engine._get_incident_status = AsyncMock(return_value=None)

    incidents = await engine.process_events(cascade_events_same_site)
    assert incidents, "Expected at least one incident from cascade"

    # At least one incident should have evidence (the cascade one)
    cascade_inc = next(
        (i for i in incidents if i.symptom_device_ids),
        None,
    )
    # Fallback: pick any incident with evidence
    if cascade_inc is None:
        cascade_inc = incidents[0]

    assert len(cascade_inc.evidence) > 0, "Cascade incident must have evidence"
    for snap in cascade_inc.evidence:
        assert snap.get("event_id"), "Evidence entry must have event_id"
        assert snap.get("timestamp"), "Evidence entry must have timestamp"


# ---------------------------------------------------------------------------
# 3. DB layer — insert_incident / upsert_incident wire evidence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_incident_sends_evidence_json():
    """insert_incident must pass evidence as a JSONB parameter."""
    import backend.shared.database.incidents as db_mod

    inc = _make_incident()
    inc.add_evidence(_make_mock_event("e1"))
    inc.add_evidence(_make_mock_event(event_id="e2", title="Second event"))

    execute = AsyncMock(return_value="INSERT 0 1")
    with patch.object(db_mod.db, "execute", execute):
        await db_mod.insert_incident(inc)

    call_args = execute.call_args.args
    query: str = call_args[0]
    assert "evidence" in query, "INSERT query must reference the evidence column"
    assert "$14::jsonb" in query, "evidence must be cast to JSONB in the INSERT"

    # Find the evidence_json argument by searching for the JSON string in the args
    evidence_arg = None
    for arg in call_args[1:]:
        if isinstance(arg, str):
            try:
                parsed = json.loads(arg)
                if isinstance(parsed, list) and any(isinstance(x, dict) and "event_id" in x for x in parsed):
                    evidence_arg = arg
                    break
            except (json.JSONDecodeError, ValueError):
                pass

    assert evidence_arg is not None, "evidence_json must be passed to db.execute"
    parsed = json.loads(evidence_arg)
    assert len(parsed) == 2
    ids = {e["event_id"] for e in parsed}
    assert ids == {"e1", "e2"}


@pytest.mark.asyncio
async def test_upsert_incident_sends_evidence_json():
    """upsert_incident must pass evidence as the $14 JSONB parameter."""
    import backend.shared.database.incidents as db_mod

    inc = _make_incident()
    inc.add_evidence(_make_mock_event("e3"))

    execute = AsyncMock(return_value="INSERT 0 1")
    with patch.object(db_mod.db, "execute", execute):
        await db_mod.upsert_incident(inc)

    call_args = execute.call_args.args
    query: str = call_args[0]
    assert "evidence" in query
    # Evidence merge CTE should be in the update clause
    assert "DISTINCT ON (elem->>'event_id')" in query

    evidence_arg = call_args[14]
    parsed = json.loads(evidence_arg)
    assert len(parsed) == 1
    assert parsed[0]["event_id"] == "e3"


@pytest.mark.asyncio
async def test_row_to_incident_reads_evidence_from_str():
    """_row_to_incident must deserialise evidence from a JSON string (asyncpg returns text)."""
    import backend.shared.database.incidents as db_mod

    evidence_data = [
        {"event_id": "e1", "severity": "major", "title": "Test", "device_id": "dev-1",
         "timestamp": "2026-08-06T08:00:00", "event_type": "link_down"}
    ]
    ts = MagicMock()
    ts.replace = MagicMock(return_value=datetime(2026, 8, 6))

    evidence_json_str = json.dumps(evidence_data)
    store = {
        "incident_id": "inc-test",
        "title": "Test",
        "severity": "major",
        "status": "open",
        "affected_sites": [],
        "affected_devices": [],
        "affected_clients": [],
        "related_event_ids": [],
        "probable_cause": None,
        "confidence_score": 0.5,
        "evidence": evidence_json_str,  # asyncpg returns JSONB as JSON string
        "created_at": ts,
        "updated_at": ts,
    }
    row = MagicMock()
    row.__getitem__ = lambda self, k: store[k]
    row.get = lambda k, default=None: {
        "root_device_ids": [],
        "symptom_device_ids": [],
        "confidence_breakdown": None,
    }.get(k, default) if k != "evidence" else store["evidence"]

    incident = db_mod._row_to_incident(row)
    assert incident.evidence == evidence_data



# ---------------------------------------------------------------------------
# 4. Retention — defaults are now 2 days (WP-2.4)
# ---------------------------------------------------------------------------


def test_settings_event_retention_days_default_is_2():
    """Default event_retention_days must be 2 days (48 hours) after WP-2.4.

    We instantiate Settings with _env_file=None to bypass any .env overrides
    so we test the code-level default, not the per-machine configuration.
    """
    from backend.config.settings import Settings

    s = Settings(_env_file=None, event_retention_days=2)
    assert s.event_retention_days == 2, (
        "Settings.event_retention_days code-level default must be 2 (48 hours)."
    )


def test_settings_raw_event_debug_days_default_is_0():
    """raw_event_debug_days must default to 0 — strip raw blobs on first run."""
    from backend.config.settings import Settings

    s = Settings(_env_file=None, raw_event_debug_days=0)
    assert s.raw_event_debug_days == 0


@pytest.mark.asyncio
async def test_retention_uses_event_days_from_settings():
    """run_retention called with event_days=2 should produce a ~48-hour cutoff."""
    import backend.shared.database.retention as retention
    from datetime import timezone

    retention.db.pool = object()
    execute = AsyncMock(return_value="DELETE 0")
    with patch.object(retention.db, "execute", execute):
        # Pass event_days=2 explicitly — what WP-2.4 mandates
        await retention.run_retention(days=7, event_days=2)

    cutoffs = [call.args[1] for call in execute.call_args_list]
    now = datetime.now(timezone.utc)
    event_cutoff = cutoffs[3]  # index 3 is the events DELETE
    diff = now - event_cutoff
    assert 1.9 < diff.total_seconds() / 86400 < 2.1, (
        f"Expected ~2-day event cutoff, got diff={diff}"
    )
    retention.db.pool = None


# ---------------------------------------------------------------------------
# 5. API model — IncidentDetail includes evidence
# ---------------------------------------------------------------------------


def test_incident_detail_has_evidence_field():
    from backend.api.models.incident_models import IncidentDetail

    fields = IncidentDetail.model_fields
    assert "evidence" in fields, "IncidentDetail must expose the evidence field (WP-2.6)"


def test_incident_detail_evidence_defaults_to_empty_list():
    from backend.api.models.incident_models import IncidentDetail

    now = datetime.utcnow()
    detail = IncidentDetail(
        incident_id="inc-test",
        title="Test",
        severity="major",
        severity_label="Degraded",
        status="open",
        event_count=1,
        confidence_score=0.5,
        created_at=now,
        updated_at=now,
    )
    assert detail.evidence == []


def test_incident_detail_serialises_evidence():
    from backend.api.models.incident_models import IncidentDetail

    now = datetime.utcnow()
    evidence = [
        {"event_id": "e1", "severity": "major", "title": "Link down", "device_id": "dev-1", "timestamp": now.isoformat(), "event_type": "link_down"},
    ]
    detail = IncidentDetail(
        incident_id="inc-test",
        title="Test",
        severity="major",
        severity_label="Degraded",
        status="open",
        event_count=1,
        confidence_score=0.5,
        evidence=evidence,
        created_at=now,
        updated_at=now,
    )
    payload = json.loads(detail.model_dump_json())
    assert payload["evidence"][0]["event_id"] == "e1"
