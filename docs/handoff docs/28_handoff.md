# Session 28 Handoff — WP-0: Storage Hygiene (write path)

> **Handoff Date:** Aug 4, 2026
> **Session Goal:** Execute Work Package 0 from `docs/strategy/PLAN_GAP.md` — the write-path fixes that stop the daily ~2 GB bleed: fix the broken retention cleanup, wire `EVENT_RETENTION_DAYS`, stop the two polled-state emitters flooding `events` (~600K/48 h), guard the duration telemetry, ship the event fixture exporter, fix the worker healthcheck start period, and de-orbit dead receivers. Tests + documentation for everything.
> **Status:** Done. Full suite: **418 backend passed / 0 failed** (+19). Live-verified on the docker stack.

---

## 1. Executive Summary

The manager's strategic docs (committed `ee1d87b`) named WP-0 "the safe half of 1a." Live measurement confirmed the two biggest leaks:

| Emitter | Per cycle (pre) | Per cycle (post) | 48 h volume |
|---|---|---|---|
| `mist-ap-rf` (RF stats as events) | 2,104 | **2** | 414,950 |
| `mist-wired-uplink` (link states) | 1,095 | **0** | 189,465 |

Both emitted a fresh event every poll with a **fresh UUID baked into `source_event_id`**, so the events insert's `ON CONFLICT (event_id)` could never dedupe them. Fix: **diff-on-write** — stable `source_event_id`, one last-state lookup per cycle, emit only on actual state change.

**Measured result on the live stack:** whole cycle now persists ~3 events (was ~2,200/cycle). Windowed: 5 events in 30 min post-deploy vs 179,891 in the prior 2.5 h window — ~4 orders of magnitude.

## 2. Completed Items

### 2.1 Retention (0.1 + 0.2) — `backend/shared/database/retention.py`, `config/settings.py`, `worker/main.py`

- **0.1 bug fix:** `_CORRELATION_TELEMETRY_CLEANUP` pruned on `created_at`, but the column is `recorded_at` (`schemas/postgres/006_correlation_telemetry.sql:5`) → the 24 h retention pass errored every cycle. Corrected to `recorded_at`.
- **0.2 wiring:** new `settings.event_retention_days` field (env `EVENT_RETENTION_DAYS`, default 90); `run_retention(days=7, event_days=90)` now also prunes `events` older than `event_days` on `timestamp` (index exists). Worker passes `_settings.event_retention_days`.
- Verify: manual `run_retention(days=7, event_days=90)` in the worker container returned `{...all 0}` with **no error** (previously the first query raised `UndefinedColumnError`). 0 rows deleted is correct — nothing is older than 90 days yet; the count becomes nonzero as history ages.

### 2.2 Diff-on-write for polled-state emitters (0.3)

- `backend/shared/database/events.py` — new `latest_event_states(source_event_ids)` helper: `DISTINCT ON (source_event_id) ... WHERE source_event_id = ANY($1)` returning newest `event_type` + `metadata` per stable id. One query per cycle.
- `backend/worker/collectors/mist_topology.py`:
  - **`MistApRfCollector`** restructured: `_rf_entries()` (state extraction + `_rf_level(utilization)` → `clear`/`elevated`/`high`) → `_rf_event()` builds the `UnifiedEvent` with **stable** `source_event_id = mist-rf-{mac}-{band_key}` and `metadata["mist_rf_level"]`. Emitted only when the level differs from the last event. `raw_event=None` (was the full device-stats blob ×3 bands).
  - **`MistWiredUplinkCollector`**: stable `source_event_id = mist-uplink-{uplink_id}`; emitted only when `event_type` differs from the last event — this emits `LINK_DOWN` on down-flip, `LINK_UP` on recovery, and nothing for steady states (event-type diff, not presence diff, so recovery after flap is preserved).
- Reachability (`mist-history`, 31,901/48 h) was already diff-on-write via the `mist_ap_history` ledger (Phase 5) — left as-is. VeloCloud links/tunnels/edges carry stable vendor `source_event_id`s (±4K/48 h) — not live spam.
- **Baseline burst is by design:** after deploy/restart no prior states exist, so each collector emits the current state once (~6.7K total on the first cycle), then goes quiet.

### 2.3 raw_event decision (0.4 — premise corrected)

- **The plan premise was stale:** live query shows `raw_event` **100% populated** (1,379,730 / 1,379,730, 0 NULL), not 100% NULL.
- Decision: keep the write path for vendor-sourced events (it is the debug record); stop it only for synthesized RF state events (largest duplicated blob). Old bloat ages out via 90-day retention.
- Docs corrected: `PLAN_GAP.md` 0.4 line + appendix, `DATA_POLICY.md` appendix.

### 2.4 Duration guard (0.5) — `backend/shared/database/collector_telemetry.py`

- `CollectorRunResult.duration_ms` clamps negatives to 0. Live ledger already had 0 negatives (old `-29.3s` entries were stale or cleaned); the guard prevents recurrence from clock skew. Do not over-claim a "fixed misordered timestamp" that no longer reproduces — verified clean.

### 2.5 Fixture export (0.6) — `backend/scripts/export_event_fixture.py`

- CLI export (core columns, no raw blobs): `python -m scripts.export_event_fixture --limit N --output ...`. Run in the worker container against live DB: `docker cp` in/out.
- Committed sample: `backend/tests/fixtures/events_sample.json` (100 events, 98 KB).
- Full 50K export ≈ 50 MB — too big for git; one-liner when WP-2 needs the replay corpus.

### 2.6 Compose + dead code (0.7 + 0.8)

- `docker-compose.yml`: worker healthcheck `start_period: 30s` → `300s`.
- Deleted `backend/worker/receivers/{syslog_receiver.py, snmp_trap_receiver.py, __init__.py}` — imported by nothing, and they reference settings fields (`syslog_enabled`, `snmp_trap_enabled`, …) that do **not exist** in `settings.py` (would crash at runtime). Import graph verified before delete.
- `STORAGE_MODE` / `storage_mode` / `is_postgres_enabled`: **kept** (harmless env-driven config; `is_postgres_enabled` has no consumers — documented as vestigial in this handoff, not churned).

## 3. Tests

| File | Coverage |
|------|----------|
| `backend/tests/test_retention.py` (new, 4) | each pruned table targets its real column; events use `event_days`, telemetry uses `days`; no-pool guard; per-table failure isolation |
| `backend/tests/test_event_dedup.py` (new, 12) | `latest_event_states` shape + empty-input skip; RF level buckets, steady-state skip, level-change emit, first-poll baseline, recovery-to-clear; uplink steady/down/recovery/baseline |
| `backend/tests/test_collector_telemetry.py` (new, 4) | positive duration kept; **negative clamped to 0**; zero; `finished_at=None` |

Full run: **418 passed / 0 failed** (was 399). Frontend untouched (114 still passing, type-check clean — not re-run, no frontend change; state preserved from session 27).

## 4. Live Verification (docker stack)

1. Rebuilt worker image: `docker build -t naxis-worker -f backend/Dockerfile --target production .`; `docker compose up -d --force-recreate worker`.
2. Logs confirm new code running: `Mist AP RF: 2 RF event(s) from 2104 entries`, `Mist wired uplinks: 0 link event(s) from 1095 links`, `Persisted 3 events to Postgres`.
3. Ledger (last 10 min): `mist-ap-rf 2`, `mist-wired-uplink 0`, `mist-events 1` (genuine vendor feed), everything else steady/0; all `duration_ms` ≥ 0.
4. Events table (measured): **5 rows in last 30 min** vs 179,891 in the prior 2.5 h; first-cycle baseline burst 6,751 (by design); table 6,980 MB, 1,378,000+ rows → growth stops, 90-day retention will now start reclaiming.
5. Manual retention run (`run_retention(days=7, event_days=90)`) executed with **0 errors**.
6. 0 new incidents / 30 min — expected: previously incidents were being minted from RF/`other` spam; correlations still fire on real CRITICAL/MAJOR event clusters (reachability transitions unchanged).

## 5. Watch Items / Deferred

- **Gate (ingest < 100 MB/day)**: re-measure after 24 h of ledger data to close the WP-0 gate formally.
- **`mist-history` flapping**: ~11 transitions/min (31,901/48 h) is high for a real network — diff-on-write is working, so this is either genuine flapping or the Mist stats API intermittently reporting `connected:false`. Not a WP-0 regression; flag for WP-2 (state history) review.
- **`INCIDENT_RETENTION_DAYS`** exists in `.env` but is read by no code. Deliberately deferred: incidents are the product's core record and are entangled with enrichment/incident_links — pruning comes with WP-2, not WP-0.
- **`STORAGE_MODE`** vestigial (see 2.6).
- Full 50K fixture export — run at WP-2 when the replay harness exists.

## 6. Files Changed

| File | Change |
|------|--------|
| `backend/shared/database/retention.py` | `recorded_at` fix; `events` pruning; `event_days` param |
| `backend/config/settings.py` | `event_retention_days` field |
| `backend/worker/main.py` | retention call passes `event_retention_days` |
| `backend/shared/database/events.py` | `latest_event_states()` helper |
| `backend/worker/collectors/mist_topology.py` | RF + uplink diff-on-write (stable ids) |
| `backend/shared/database/collector_telemetry.py` | negative-duration clamp |
| `backend/scripts/export_event_fixture.py` | new exporter |
| `backend/tests/fixtures/events_sample.json` | 100-event sample |
| `backend/tests/{test_retention,test_event_dedup,test_collector_telemetry}.py` | 19 new tests |
| `docker-compose.yml` | worker healthcheck `start_period` 300s |
| `backend/worker/receivers/*` | 3 files deleted |
| `docs/strategy/{PLAN_GAP,DATA_POLICY}.md` | WP-0 status + raw_event correction |

## 7. Commands

```bash
python -m pytest backend/tests        # 418 passed / 0 failed
docker build -t naxis-worker -f backend/Dockerfile --target production .
docker compose up -d --force-recreate worker
docker exec naxis-worker python /tmp/export_event_fixture.py --limit 100 --output /tmp/events_sample.json
```