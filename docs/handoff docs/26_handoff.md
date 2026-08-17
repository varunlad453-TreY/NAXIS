# Session 26 Handoff — Dead Code Removal: Legacy ORM Worker Path

> **Handoff Date:** Aug 4, 2026
> **Session Goal:** Remove the entire legacy mock-pipeline worker path (ORM services + SQLAlchemy `db/` layer + `run_worker.py` + `MockTelemetryPipeline`) — dead code reachable only through a legacy entrypoint that the docker stack never runs. This was flagged in session 25 as "dead path, not live" with an open question of whether to delete; user directive: **remove if not needed, keep if needed — professional project, no dead paths tolerated.**
> **Status:** Done. Full suite: **392 backend passed / 0 failed** after deletion.

---

## 1. Executive Summary

`backend/run_worker.py` (legacy worker entrypoint) pulled in a whole closed subsystem that the live stack never executes:

- `backend/services/` — SQLAlchemy ORM services (`device_service`, `event_service`, `incident_service`, the latter containing the legacy N+1 `get_stats()`)
- `backend/db/` — SQLAlchemy `base.py` + `models.py`
- `backend/worker/mock_ingest/runner.py` — `MockTelemetryPipeline` (mock data generator)

The live worker runs `python -u -m worker.main` (docker-compose `command:` overrides the image CMD), which uses the asyncpg `shared/database` layer exclusively. The deleted subsystem was a pre-Phase-2 demo path — its presence meant a developer could accidentally start a fake-data worker and the repo contained an N+1 implementation right next to the fixed one. All deleted.

---

## 2. Completed Items

### 2.1 Import-graph verification (before cutting)

Grep'd every reference across the repo (`.py`, `.md`, `.yml`, `.toml`, `.ps1`):

- `backend/db/*` ← imported only by `backend/services/*`, `db/models.py → db/base.py`, and `run_worker.py`
- `backend/services/*` ← imported only by `run_worker.py`
- `backend/worker/mock_ingest/*` ← imported only by `run_worker.py`
- `run_worker.py` ← imported by nothing; executed only via the worker Dockerfile CMD, which compose overrides with `python -u -m worker.main`
- Tests: zero references to `backend.services`, `backend.db`, `mock_ingest` (verified `backend/tests` clean)

### 2.2 Deleted files

| File | What it was |
|------|-------------|
| `backend/run_worker.py` | Legacy worker entrypoint (mock pipeline, ORM init, old loop) |
| `backend/services/device_service.py` | ORM device service |
| `backend/services/event_service.py` | ORM event service |
| `backend/services/incident_service.py` | ORM incident service + legacy N+1 `get_stats()` |
| `backend/db/base.py` | SQLAlchemy engine/session |
| `backend/db/models.py` | SQLAlchemy ORM models |
| `backend/worker/mock_ingest/runner.py` | `MockTelemetryPipeline` mock data pipeline |
| `backend/worker/Dockerfile` | Unbuilt anywhere — compose builds `backend/Dockerfile` (target production) for **both** api and worker; its CMD pointed at the deleted `run_worker.py` |

(`backend/worker/Dockerfile` deletion also confirmed: only historical reference is `docs/handoff docs/3_handoff doc .md` — a record, not a live build path.)

### 2.3 Docs updated (live docs only)

- `README.md` — project tree: removed `run_worker.py`, added `worker/main.py` as daemon location
- `docs/DEVELOPER_GUIDE.md` — entrypoint table: worker is `python -m worker.main`; "run worker directly" command; walkthrough tree: removed `run_worker.py` + `db/` lines

Left as historical records (not rewritten): `docs/handoff docs/3, 4, 15`, `docs/TELEMETRY_ARCHITECTURE.md` §2 "What Was Before" — they describe the past deliberately.

### 2.4 Docs created/updated for this session

- `CHANGELOG.md` — `[26]` entry
- `docs/handoff docs/26_handoff.md` — this file
- `DOCUMENTATION_INDEX.md` — session count corrected 19 → 26 (was already stale at 19 vs 25)

### 2.5 Verify

```bash
python -m pytest backend/tests    # 392 passed / 0 failed (same count as before — deletion removed no tests)
graphify update .                 # 3914 nodes / 7674 edges / 272 communities
```

---

## 3. Files Changed

| File | What |
|------|------|
| `backend/run_worker.py` | **Deleted** |
| `backend/services/` (3 files) | **Deleted** |
| `backend/db/` (2 files) | **Deleted** |
| `backend/worker/mock_ingest/runner.py` | **Deleted** |
| `backend/worker/Dockerfile` | **Deleted** (unbuilt; CMD referenced deleted entrypoint) |
| `README.md` | Project tree fixed |
| `docs/DEVELOPER_GUIDE.md` | Entrypoints + run command + walkthrough tree fixed |
| `CHANGELOG.md` | `[26]` entry |
| `DOCUMENTATION_INDEX.md` | Handoff session count 19 → 26 |
| `docs/handoff docs/26_handoff.md` | this file |

## 4. Verification of "Everything Through This Session"

- **No live code touched:** api (`backend/main.py`, `backend/api/`, `backend/shared/`) and worker (`backend/worker/`) pipelines are untouched — deletion was purely of the legacy cluster.
- **No test changed:** 392 passed before and after — the deleted files had no test coverage (they were never part of the tested path).
- **Knowledge graph:** `graphify update .` re-extracted — nodes 4036 → 3914, edges 7708 → 7674, communities 312 → 272, graph.html regenerated.

## 5. Pending Items (by Impact)

None.

## 6. How to Pick Up — Next Developer

1. Stack is fully running (api/worker/postgres/redis/web) — no rebuild needed; the deleted files were never copied into the compose images' active paths (`backend/Dockerfile` copies `worker/` + `api/` only).
2. Worker entrypoint is `python -u -m worker.main` everywhere (compose `command:`, healthcheck greps `worker.main`). Do not reintroduce a `run_worker.py`.
3. The only ORM-style DB layer in the repo is `shared/database/` (asyncpg). If a future feature needs ORM-like models, add to `shared/database/`, not a new `backend/db/`.

## 7. CHANGELOG Entry

```
## [26] — 2026-08-04 — Dead Code Removal: Legacy ORM Worker Path
- Deleted the entire legacy mock-pipeline worker path, root to leaf: backend/run_worker.py, backend/services/
  (device/event/incident ORM services incl. legacy N+1 get_stats()), backend/db/ (SQLAlchemy base+models),
  backend/worker/mock_ingest/runner.py (MockTelemetryPipeline), backend/worker/Dockerfile (unbuilt; CMD pointed at run_worker.py)
- Import graph verified repo-wide before cutting: zero references outside the deleted cluster
- Live worker confirmed unaffected: compose runs python -u -m worker.main
- Docs: README + DEVELOPER_GUIDE trees/entrypoints fixed; historical handoffs + TELEMETRY "What Was Before" left as records
- Full suite: 392 backend passed / 0 failed; graphify updated (3914 nodes / 7674 edges / 272 communities)
```
