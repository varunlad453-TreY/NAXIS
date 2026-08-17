# Session 35 Handoff — WP-2.5 (Device & Link State History)

**Date:** 2026-08-06  
**Work Package Completed:** WP-2.5 (Add device/link state history with Diff-on-Write)  
**Status:** 100% DONE (All tests passing: 461/461)

---

## 1. What Was Accomplished

### Problem Addressed
With raw telemetry events configured to prune after 48 hours (WP-2.4) to keep the database fast, all long-term visibility into device uptime, link stability, and SLA availability would be lost once events roll off. However, saving every raw status ping would result in millions of duplicate rows.

### Key Solves Implemented

1. **Schema Migration (`schemas/postgres/011_state_history.sql`)**:
   - Created `device_state_history` and `link_state_history` tables.
   - Added `duration_seconds` tracking column to allow single-query SLA availability & MTTR calculations.
   - Added indexes on device/link keys, sites, and timestamps (`recorded_at`).

2. **Pydantic Models (`backend/shared/models/state_history.py`)**:
   - Defined `DeviceStateTransition`, `LinkStateTransition`, and `StateHistoryQuery`.

3. **Repository & L1 In-Memory Diff-on-Write Cache (`backend/shared/database/state_history.py`)**:
   - Maintained in-memory caches (`_latest_device_states`, `_latest_link_states`).
   - Diff-on-write check evaluates in **<1ms in memory**. If `new_state == previous_state`, identical updates are ignored (0 bloat).
   - Automatically calculates `duration_seconds` from the previous transition timestamp.

4. **Pipeline Ingestion Hooks (`backend/shared/database/events.py`)**:
   - Wired `_record_state_history_for_event()` inside `insert_event()`.
   - Automatically emits device state changes (`DEVICE_UNREACHABLE`, `DEVICE_REACHABLE`) and link state changes (`LINK_DOWN`, `LINK_UP`, `BGP_DOWN`, `BGP_UP`, `TUNNEL_DOWN`, `TUNNEL_UP`).

5. **REST API Endpoints (`backend/api/routes/devices.py` & `backend/api/routes/topology.py`)**:
   - Added `GET /devices/{device_id}/history` returning chronological device state transitions.
   - Added `GET /topology/links/history` returning paginated topology link state transitions.

6. **Tests (`backend/tests/test_state_history.py`)**:
   - 7 unit/integration tests verifying first-time recording, diff-on-write duplicate suppression, duration calculation, link transitions, DB queries, and event ingestion hooks.

---

## 2. Test Verification

- **New Test Suite (`backend/tests/test_state_history.py`)**: 7/7 passed.
- **Full Backend Regression**: 461 passed, 0 failed in 29.84s.

---

## 3. Files Created & Modified

### New Files
- `schemas/postgres/011_state_history.sql`
- `backend/shared/models/state_history.py`
- `backend/shared/database/state_history.py`
- `backend/tests/test_state_history.py`
- `docs/handoff docs/35_handoff.md`

### Modified Files
- `backend/shared/database/events.py`
- `backend/api/routes/devices.py`
- `backend/api/routes/topology.py`
- `docs/strategy/PLAN_GAP.md`
- `walkthrough.md`

---

## 4. Roadmap Status

- **WP-2.3**: Truncate garbage incidents — **DONE**
- **WP-2.4**: 48h event retention buffer — **DONE**
- **WP-2.5**: State history tables (`device_state_history`, `link_state_history`) — **DONE**
- **WP-2.6**: Evidence persistence — **DONE**

### Next Steps:
- **WP-2.7**: Enrichment migration (move device name lookup from `events.device_name` to `devices` table).
- **WP-2.8**: Suppression & auto-close enhancement (recursive-CTE traversal).
