# Session 22 Handoff — Correlation Noise Fix: Root-Cause Merge + Recovery Resolution

> **Handoff Date:** Aug 2, 2026
> **Session Goal:** Kill the incident flood from per-poll telemetry by (Phase 1) emitting mist AP reachability events only on state transitions, and (Phase 2) merging recurring events for the same root failure into one incident, then auto-resolving incidents when the device recovers.
> **Status:** Phase 1 + Phase 2 delivered, live-verified. Tests 364 passed / 10 pre-existing failures (velocloud×8, redis publish, topology backbone).

---

## 1. Executive Summary

The correlation engine built one incident per incoming event batch. When a device stayed down across polls it re-fired the same event repeatedly, and recurring VeloCloud `link_down` floods (942 events/cycle across 69 devices) kept inflating the incident table every cycle. Phase 1 removed the per-poll reachability flood at the collector; Phase 2 made incidents self-deduplicating and self-resolving at the engine.

---

## 2. Completed Items

### 2.1 Phase 1 — Mist AP reachability flood kill (`mist_ap_history.py`)

Reachability events are only emitted when the observed field actually changes vs. the ledger (first sight always writes). Live result: after initial fill, **zero** mist-history events and zero ledger writes on steady state.

Also unblocked the incident pipeline with two latent bugs:
- `events.py: _as_json()` — jsonb `decode("utf-8")` on bytes (asyncpg) → fixed
- `incidents.py` — `json.dumps(confidence_breakdown)` on BOTH insert and upsert → 315 incidents persist breakdown

### 2.2 Phase 2 — Root-cause dedup + recovery resolution

- **`_compute_incident_id()`** is now a root-cause key `SHA256(site_id | root_device_id | issue_category)` instead of a hash of the event IDs. Recurring events for the same failure merge into one incident row via `ON CONFLICT DO UPDATE`. Flat incident id also includes the primary device (highest severity device). Logged: incident rows stay flat through repeated link_down floods.
- **`_resolve_recovered_devices()` / `resolve_open_incidents_for_devices()`** in `engine.py`/`incidents.py`: when a `DEVICE_REACHABLE` event arrives for a device that was the root of an incident, the incident is auto-resolved (`UPDATE ... SET status='resolved' WHERE status='open' AND root_device_ids && $1`). Only OPEN is auto-resolved — operator states are untouched.
- **`_primary_device_id(events)`** severity rank: CRITICAL 5, MAJOR 4, MINOR 3, WARNING 2, INFO 1, DEBUG 0.
- Backfilled legacy open incidents (`root_device_ids = ARRAY[affected_devices[1]]`, 7,909 rows) so pre-Phase-2 incidents can be resolved by recovery events.

### 2.3 Live verification

- Recurring VeloCloud link_down floods merged; first-new-cycle incident count stayed flat at **8,844–8,845** across cycles (previously would grow with each poll).
- 88 affected devices → 78 incidents (14 merged from the unlink+link pairs); multi-location incidents rebuilt each cycle.
- Incident status split: **~8,844 total, ~3,870 open / ~4,975 resolved** and stable; recovery events continuously resolving.

### 2.4 Files Changed

| File | What |
|------|------|
| `backend/shared/database/incidents.py` | New `resolve_open_incidents_for_devices()`, `json.dumps` fix |
| `backend/shared/correlation/engine.py` | New `_compute_incident_id` root-cause key, `_primary_device_id`, `_resolve_recovered_devices` wiring |
| `backend/shared/database/events.py` | `_as_json()` jsonb decode fix |
| `backend/worker/collectors/mist_ap_history.py` | Ledger-backed state-transition events only |
| `backend/tests/test_correlation_engine.py` | New `TestRootCauseDedupAndRecovery` (7 tests) + flat-root assert updated |
| `backend/tests/test_mist_ap_history.py`, `test_mist_topology.py` | New |
| `docs/Plans/CORRELATION_PIPELINE_PLAN.md` | Replaced event-ID-hash design with root-cause key + recovery SQL |

---

## 3. Pending Items (by Impact)

| # | Item | Why |
|---|------|-----|
| H1 | **Phase 3: verify + finish per-site VeloCloud titles** | Initial fix done: link/tunnel emitters on `velocloud.py` base now stamp per-edge site (verified in code + 3 new tests). Pending: restart worker (done in-session), and confirm live — plus the riched `velocloud_events.py` events collector has its own `_normalize` and may still emit empty `site_id`; check which collector feeds the live "Multiple locations" incidents. ~6,000 legacy `multiple locations` rows stay as-is (new incidents form per-site going forward). |
| M1 | `health_snapshot.py` periodic SQL error (worker log, "syntax error near '2'") | Pre-existing, nonfatal, fires every 5 min — root-cause when touching health features |
| L1 | 8_handoff.md is stale (correct resting place is this file's updated content) — superseded by this file |

---

## 4. How to Pick Up — Next Developer

1. Phase 3: confirm per-site titles live after restart; check `velocloud_events.py` event emitter stamps site. See H1.
2. Revert 8_handoff (restored, no diff) — any stale "column" check there (the `worker_heartbeat` schema uses `cycle_status`, not `status`).
3. Resolve M1 (health_snapshot) opportunistically.

---

## 5. CHANGELOG Entry

```
## [22] — 2026-08-02 — Correlation noise fix: root-cause merge + recovery resolution
- Event-id hash replaced by root-cause incident key (site_id | root device | issue category) so recurring failures merge, no longer flood incident rows
- Added recovery resolution: DEVICE_REACHABLE events auto-resolve open incidents whose root device recovered (only OPEN; operator states untouched)
- Flat incidents populate root_device_ids via primary-device selection (highest severity)
- Fixed _as_json jsonb decode + confidence_breakdown serialization; 315 incidents now persist breakdown
- Backfilled 7,909 legacy open incidents with root_device_ids
- Phase 1: mist AP reachability events only on ledger-backed state transitions (flood eliminated)
- Tests: 364 passed / 10 pre-existing failures (velocloud×8, redis publish, topology backbone)
```