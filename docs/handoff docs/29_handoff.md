# Session 29 Handoff — WP-0 deferred items closed

> **Handoff Date:** Aug 5, 2026
> **Session Goal:** Close every item the Session 28 handoff left pending or hanging: strip the `raw_event` bloat now (not in 90 days), wire `INCIDENT_RETENTION_DAYS`, remove the vestigial `STORAGE_MODE`, generate the 50K fixture, explain the mist-history flapping observation, formally close the ingest gate, and sweep the stale "`raw_event` 100% NULL" claims out of the manager docs.
> **Status:** Done. Full suite: **418 backend passed / 0 failed**. Live-verified on the docker stack.

---

## 1. Executive Summary

Session 28 fixed the write path and chose to leave five items deferred. This session picked up every one of them.

| Item | Before | After |
|---|---|---|
| `events` table size | 6.98 GB (1.38M rows, 1.38M with `raw_event`) | **2.10 GB** (256K with `raw_event`) |
| Database size | ~7.9 GB | **2.1 GB** |
| `raw_event` in `events` | 5,207 MB | **877 MB** (7-day debug window) |
| `INCIDENT_RETENTION_DAYS` | unread in `.env` | **wired**, resolved-only pruning |
| `STORAGE_MODE` | vestigial setting + env var | **removed** |
| 50K fixture export | deferred to WP-2 | **generated** (~45.7 MB) |
| Mist-history "flapping" | ~11 transitions/min flagged | **resolved** — 0 recent transitions |
| Ingest gate (<100 MB/day) | pending 24 h sample | **closed** at ~1 MB/day events |

The big move was not waiting 90 days for old `raw_event` blobs to age out. Because the bloat was all recent (<7 days), the planned retention window would have done nothing for a week. A targeted one-off `UPDATE` by `source_event_id` prefix cleared **1,124,128 rows / 5,207 MB** immediately, followed by `VACUUM FULL` to return the space.

---

## 2. Completed Items

### 2.1 `raw_event` bloat stripped now (deferred from 0.4)

- **Why the deferred plan was wrong:** the 90-day retention window would not have reclaimed anything yet — every row was <7 days old. Waiting would have left ~5 GB of dead weight on disk.
- **One-off SQL:** `UPDATE events SET raw_event = NULL WHERE source_event_id LIKE 'mist-rf-%' OR source_event_id LIKE 'mist-uplink-%';`
  - Cleared 1,124,128 rows.
  - `raw_event` footprint: 5,207 MB → 877 MB.
- **`VACUUM FULL ANALYZE events;`** returned the disk space:
  - `events` table: 6,980 MB → 2,096 MB.
  - Database: 7,892 MB → 2,127 MB.
- **Recurring guard:** added `RAW_EVENT_DEBUG_DAYS=7` so the daily retention pass keeps `raw_event` bounded going forward.

### 2.2 Recurring retention extended (`INCIDENT_RETENTION_DAYS` + `RAW_EVENT_DEBUG_DAYS`)

- `backend/config/settings.py`: removed `storage_mode` / `is_postgres_enabled`; added `incident_retention_days` and `raw_event_debug_days`.
- `backend/shared/database/retention.py`: `run_retention()` now accepts `incident_days` and `raw_event_days`.
  - Incidents pruned with `WHERE status = 'resolved' AND created_at < $1` — **open incidents are never deleted**.
  - `raw_event` stripped with `WHERE raw_event IS NOT NULL AND timestamp < $1`.
- `backend/worker/main.py`: daily retention pass passes the new settings.
- `backend/tests/test_retention.py`: extended to assert the new queries and cutoffs.

### 2.3 `STORAGE_MODE` removed

- Zero consumers existed in backend, frontend, or compose.
- Removed `storage_mode` field and `is_postgres_enabled` property from `settings.py`.
- Removed `STORAGE_MODE=postgres` from `.env` and `config/.env`.
- Updated doc references in `docs/TELEMETRY_ARCHITECTURE.md` and `QUICKSTART_EVENTS_DEVICES.md` (also corrected stale ClickHouse references while there).

### 2.4 50K fixture export generated

- Ran from host against the dockerised Postgres:
  ```bash
  $env:PYTHONPATH="backend"
  $env:DATABASE_URL="postgresql+asyncpg://naxis:naxis_password@localhost:5433/naxis"
  python -m scripts.export_event_fixture --limit 50000 --output C:\Users\varun\AppData\Local\Temp\opencode\events_50k_fixture.json
  ```
- Output: **50,000 events, 45.67 MB** — too large for git, available for WP-2 replay work.

### 2.5 Mist-history flapping explained

- The Session 28 handoff quoted ~31,901 mist-history transitions/48 h (~11/min).
- Live query (post-WP-0.3): `device_unreachable` events in the last 48 h = **0**.
- `mist_ap_history` ledger shows **0 transitions** in 48 h; 70 rows, all `unreachable` steady state.
- Conclusion: the flapping was a **symptom of the pre-fix per-poll re-emission** (fresh UUID every cycle), not genuine AP flapping or API intermittency. Diff-on-write eliminated it.

### 2.6 Ingest gate closed

- Measured hourly events + byte size for the last 24 h.
- Steady-state hours (post-baseline-burst): ~11–79 events/hour, ~26–64 kB/hour.
- Projected daily ingest: **~1 MB/day events** at four vendors.
- Even with an anomalous hour (13:00, 743 events / 534 kB), ingest stays well under 100 MB/day.
- Gate formally closed.

### 2.7 Doc sweep

Corrected stale claims and numbers in:
- `docs/strategy/PLAN_GAP.md`
- `docs/strategy/ROADMAP.md`
- `docs/strategy/TECHNICAL_QA.md`
- `docs/strategy/DATA_POLICY.md`
- `docs/TELEMETRY_ARCHITECTURE.md`
- `QUICKSTART_EVENTS_DEVICES.md`

Key corrections:
- `raw_event` is **100% populated**, not 100% NULL.
- `raw_event` is retained as a 7-day debug record, not dropped entirely.
- DB size updated: 6.5 GB → **2.1 GB**.
- `EVENT_RETENTION_DAYS` / `INCIDENT_RETENTION_DAYS` / `RAW_EVENT_DEBUG_DAYS` all wired.
- `STORAGE_MODE` removed.
- Test count: 399 → **418**.

---

## 3. Tests

- `backend/tests/test_retention.py` updated for incidents + raw_event strip.
- Full run: **418 passed / 0 failed**.
- Frontend untouched (114 still passing, type-check clean).

---

## 4. Live Verification

1. Rebuilt worker image: `docker build -t naxis-worker -f backend/Dockerfile --target production .`; `docker compose up -d --force-recreate worker`.
2. Worker healthy; logs confirm new code running.
3. `raw_event` strip + `VACUUM FULL` executed on live DB:
   - `events` 6,980 MB → 2,096 MB.
   - DB 7,892 MB → 2,127 MB.
4. Settings import verified: `event_retention_days=90`, `incident_retention_days=180`, `raw_event_debug_days=7`.
5. Ingest gate: steady-state ~1 MB/day events.

---

## 5. Watch Items / Deferred

None remaining from WP-0. Everything flagged in Session 28 is now closed or documented.

Forward work remains in WP-1/WP-2 (identity, correlation correctness) per `docs/strategy/PLAN_GAP.md`.

---

## 6. Files Changed

| File | Change |
|---|---|
| `backend/config/settings.py` | added `incident_retention_days`, `raw_event_debug_days`; removed `storage_mode` + `is_postgres_enabled` |
| `backend/shared/database/retention.py` | incidents (resolved-only) + raw_event strip queries; new params |
| `backend/worker/main.py` | pass `incident_days` + `raw_event_days` |
| `backend/tests/test_retention.py` | assert new retention targets |
| `.env`, `config/.env` | removed `STORAGE_MODE` |
| `CHANGELOG.md` | new [29] entry |
| `docs/strategy/{PLAN_GAP,ROADMAP,TECHNICAL_QA,DATA_POLICY}.md` | corrected stale raw_event/storage numbers |
| `docs/TELEMETRY_ARCHITECTURE.md`, `QUICKSTART_EVENTS_DEVICES.md` | removed STORAGE_MODE / ClickHouse refs |

## 7. Commands

```bash
python -m pytest backend/tests        # 418 passed / 0 failed
docker build -t naxis-worker -f backend/Dockerfile --target production .
docker compose up -d --force-recreate worker
```

---

*Graphify update skipped: `graphify` CLI is not available in this environment (matches Session 28 note).*
