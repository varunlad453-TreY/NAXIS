# Session 34 Handoff — WP-2.4 (48h Event Retention) & WP-2.6 (Evidence Persistence)

**Date:** 2026-08-06  
**Work Packages Completed:** 
- **WP-2.4**: Shrink events to a 24–48h alarm buffer
- **WP-2.6**: Evidence persistence denormalized inside incident records
**Status:** 100% DONE (All tests passing: 454/454)

---

## 1. What Was Accomplished

### Problem Addressed
1. **WP-2.4**: Raw network events were previously configured to persist for 90 days. For an enterprise network generating tens of thousands of telemetry events per hour, keeping 90 days of raw events would result in tens of millions of database rows (>100 GB), causing severe query degradation and table bloat.
2. **WP-2.6**: Pruning raw events after 48 hours would cause an operational blind spot: if an operator opens an incident 5 days later, the underlying raw events would be pruned, displaying an empty timeline.

### Key Solves Implemented

1. **WP-2.4 — 48-Hour Event Retention Window (`backend/config/settings.py`)**:
   - Set `event_retention_days = 2` (48 hours) as the platform default.
   - Set `raw_event_debug_days = 0` to strip heavy raw debug blobs immediately, keeping only clean structured fields.

2. **WP-2.6 — Schema Migration (`schemas/postgres/010_incident_evidence.sql`)**:
   - Added `evidence JSONB NOT NULL DEFAULT '[]'` column to the `incidents` table.
   - Added a GIN index `idx_incidents_evidence` for fast JSONB querying.

3. **WP-2.6 — Model & Correlation Engine Integration (`backend/shared/models/incident.py`, `backend/shared/correlation/engine.py`)**:
   - Added `evidence: List[Dict[str, Any]]` field to the `Incident` Pydantic model.
   - Implemented `add_evidence(event)` snapshot helper to extract 6 essential telemetry keys (`event_id`, `timestamp`, `event_type`, `severity`, `title`, `device_id`) (~200 bytes per event) with in-memory deduplication by `event_id`.
   - Wired `engine.create_incident()` and `engine._create_from_cascade()` to snapshot evidence for every contributing event at creation time.

4. **WP-2.6 — Database Access Layer (`backend/shared/database/incidents.py`)**:
   - Updated `_row_to_incident()` to deserialize JSON string/list evidence data cleanly.
   - Updated `insert_incident()` and `upsert_incident()` to pass `$14::jsonb`.
   - Implemented atomic PostgreSQL evidence array merging on upsert using `jsonb_array_elements` and `DISTINCT ON (elem->>'event_id')`, ensuring evidence accumulates across engine cycles without duplicate entries.

5. **WP-2.6 — API Models & Endpoints (`backend/api/models/incident_models.py`, `backend/api/routes/incidents.py`)**:
   - Updated `IncidentDetail` API model to expose `evidence: List[Dict[str, Any]]`.
   - Updated `_incident_to_detail()` route mapper.
   - Added `GET /incidents/{incident_id}/evidence` endpoint returning the chronological timeline of telemetry snapshots for an incident.

6. **Ponytail Integration (`.agents/skills/ponytail/SKILL.md`, `.agents/AGENTS.md`)**:
   - Installed Ponytail workspace skill and configured project rules in `AGENTS.md` enforcing **Ponytail (Full)** on 100% of messages and code changes.

---

## 2. Test Verification

- **New Test Suite (`backend/tests/test_incident_evidence.py`)**:
  - 20 unit/integration tests covering model methods, deduplication, engine evidence population, DB JSONB serialization/upsert merging, settings defaults, and API detail models.
  - Result: **20/20 passed**.
- **Full Backend Regression**:
  - Ran full test suite across all modules.
  - Result: **454 passed, 0 failed** in 32.76s.

---

## 3. Files Created & Modified

### New Files
- `schemas/postgres/010_incident_evidence.sql`
- `backend/tests/test_incident_evidence.py`
- `.agents/skills/ponytail/SKILL.md`
- `.agents/AGENTS.md`
- `docs/handoff docs/34_handoff.md`

### Modified Files
- `backend/shared/models/incident.py`
- `backend/shared/correlation/engine.py`
- `backend/shared/database/incidents.py`
- `backend/config/settings.py`
- `backend/api/models/incident_models.py`
- `backend/api/routes/incidents.py`
- `docs/strategy/PLAN_GAP.md`

---

## 4. Roadmap Status

- **WP-2.3**: Truncate garbage incidents — **DONE**
- **WP-2.4**: 48h event retention buffer — **DONE**
- **WP-2.6**: Evidence persistence — **DONE**

### Next Steps:
- **WP-2.5**: State history tables (`device_state_history`, `link_state_history`).
- **WP-2.7**: Enrichment migration (move device name lookup from `events.device_name` to `devices` table).
- **WP-2.8**: Suppression & auto-close enhancement (recursive-CTE traversal).
