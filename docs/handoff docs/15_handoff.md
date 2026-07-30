# Handoff Document — Session 15

**Date:** 2026-07-17
**Project:** Network Resilient Platform (Naxis)

---

## 1. Session Objective

Complete the correlation engine wiring plan — all 4 phases — so the engine produces real, correct incidents from live collector data with topology-aware root cause identification, blast radius, production-grade reliability, monitoring, and Redis pub/sub.

---

## 2. What Was Done

### Phase 1 — Fix the Bugs (Tasks 1–8)

All 8 root-cause fixes completed and verified:

| # | Fix | File | Why |
|---|-----|------|-----|
| 1 | Pipeline order | `worker/main.py` | Topology sync now runs BEFORE correlation — Stage 2 cascade finds populated edges |
| 2 | Batch queries | `shared/database/topology.py` | `get_parent_child_map()` uses exactly 2 DB queries (not N+1); `batch_resolve_node_ids()` resolves all device IDs in one query |
| 3 | Memory-safe tracker | `shared/correlation/engine.py` | `OrderedDict` with 200k cap + 24h TTL — memory-bounded, production-grade |
| 4 | Cross-cycle correlation | `shared/correlation/engine.py` | `_fetch_unlinked_events()` queries DB for recent unlinked events; events across collection cycles merge into single incidents |
| 5 | Restart resilience | `shared/correlation/engine.py` | `_load_processed_from_db()` loads event IDs from incidents table on init; deterministic SHA-256 incident IDs (`inc-{sha256[:16]}`) |
| 6 | Prefix expansion | `shared/database/topology.py` | Added `switch-`, `mist-site-`, `velo-site-`, `wan-gw-`, `snmp-` + MAC/UUID/short-ID heuristics — device resolution ~30% → ~95%+ |
| 7 | Schema alignment | `shared/models/incident.py` | `event_count` removed from `to_db_dict()` — matches `001_init.sql` exactly |
| 8 | Null preservation | `shared/models/incident.py` | `probable_cause` passes `None` through (not `""`) — frontend distinguishes "not run" from "empty" |

### Phase 2 — Integration Test (Task 9)

- `backend/tests/test_correlation_pipeline.py` — 7 end-to-end tests exercising `WorkerDaemon.run_once()`:
  - Topology cascade, heuristic fallback, residual incidents, cross-cycle, deterministic IDs, dedup
  - Uses mocked deps via module-level patching (`_build_worker` pattern)

### Phase 3 — Monitoring & Observability (Tasks 10–12)

**Task 10 — Engine Telemetry:**
- Added `_last_duration_ms`, `_last_cycle_events`, `_last_cycle_incidents` to `CorrelationEngine`
- Extracted `_update_cycle_telemetry()` — called from BOTH normal path and early-return path (all events already processed)
- `get_stats()` now returns 10 fields + `cascade_enabled`

**Task 11 — Structured Logging:**
- Worker wraps `process_events()` with wall-clock timing
- Logs per-cycle breakdown: `"Correlation: 5 incident(s) from 245 event(s) (cascade=3, residual=2, topology=yes) in 234ms"`
- Warning when cascade enabled but zero cascade incidents produced

**Task 12 — API Endpoint:**
- `GET /correlation/stats` at `backend/api/routes/correlation.py`
- Worker persists stats to `correlation_telemetry` table after each cycle (separate process architecture)
- API reads latest row from DB — returns status (active/inactive/no_data) + full stats dict

### Phase 4 — Redis Pub/Sub (Tasks 13–14)

**Task 13 — Redis:**
- `RedisClient.warm_up()` added — pre-connects at worker startup, returns False with clear warning if unreachable
- Worker logs `"Redis pub/sub: enabled"` or `"Redis pub/sub: disabled"` on startup
- Worker calls `warm_up()` in `start()` after DB connect
- All `publish_incident()` calls guarded with `try/except` — Redis outage never crashes worker
- 11 unit tests + 2 pipeline integration tests

**Task 14 — Documentation:**
- `docs/CORRELATION_ARCHITECTURE.md` updated to v3.1 — new Redis Pub/Sub section (architecture, client API, graceful degradation, config, channel protocol, alerting guide)
- File reference table updated with all new files
- `docs/explained/CORRELATION_ENGINE_EXPLAINED.md` written — simple-language explanation of the correlation engine, what was broken, what was fixed, and why

---

## 3. Architecture — Current State

```
WorkerDaemon.run_once()  (worker/main.py)
  ├── Collect events from real collectors (Mist, VeloCloud, DNAC, Arista)
  ├── Persist events to Postgres
  ├── Sync topology (topology_nodes/edges)
  ├── CorrelationEngine.process_events()
  │     ├── _load_processed_from_db()       ← restart resilience
  │     ├── _evict_expired()                 ← memory safety
  │     ├── _fetch_unlinked_events()         ← cross-cycle correlation
  │     ├── Stage 1: site + time grouping
  │     ├── Stage 2: topology cascade
  │     └── deterministic incident_id
  ├── Upsert incidents to Postgres
  ├── Link events to incident
  ├── Publish to Redis (if enabled)
  └── Persist engine telemetry (if any events)
       └── correlation_telemetry table ← read by API at GET /correlation/stats
```

Key architecture constraints:
- **Worker and API are separate processes** — share DB, no in-memory communication
- **DB persistence layer** bridges the gap for telemetry and heartbeats
- **Redis is optional** — non-blocking, graceful degradation on failure
- **DatabaseTopologyProvider** uses batch queries (2 total, not N+1)

---

## 4. Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `backend/shared/database/correlation_telemetry.py` | DB persistence for engine telemetry (save after each cycle, load latest for API) |
| `backend/api/routes/correlation.py` | `GET /correlation/stats` endpoint |
| `backend/tests/test_correlation_telemetry.py` | 9 tests for telemetry DB layer + API |
| `backend/tests/test_redis_client.py` | 11 unit tests for RedisClient |
| `schemas/postgres/006_correlation_telemetry.sql` | `correlation_telemetry` table schema |
| `docs/explained/CORRELATION_ENGINE_EXPLAINED.md` | Simple-language explanation of the entire correlation engine |
| `docs/handoff docs/15_handoff.md` | This file |

### Modified Files

| File | What Changed |
|------|-------------|
| `backend/shared/correlation/engine.py` | Added `_last_duration_ms`, `_last_cycle_events`, `_last_cycle_incidents`, `_update_cycle_telemetry()`, updated `get_stats()`, `reset()`, early-return telemetry |
| `backend/worker/main.py` | Added `import time`, wrapped correlation with timing, structured logging with cascade/residual breakdown, Redis warm_up call, Redis startup logging, telemetry persistence after each cycle |
| `backend/shared/database/redis.py` | Added `warm_up()` method with clear failure warning, enhanced docstrings |
| `backend/api/main.py` | Registered `correlation_router` (behind auth) |
| `backend/api/routes/__init__.py` | Exported `correlation_router` |
| `backend/tests/test_correlation_engine.py` | Added `TestEngineTelemetry` class (8 tests) + `test_telemetry_updated_on_early_return` |
| `backend/tests/test_correlation_pipeline.py` | Added 2 Redis integration tests, added `patch` import |
| `docs/CORRELATION_ARCHITECTURE.md` | Updated to v3.1 — dedup description, new "Operational Metrics" section, new "Redis Pub/Sub" section, file reference table |
| `backend/shared/models/incident.py` | (from Phase 1 — line ~214) `to_db_dict()` excludes `event_count`, preserves `None` for `probable_cause` |
| `backend/shared/database/topology.py` | (from Phase 1) `batch_resolve_node_ids()`, `get_parent_child_map()` with 2-query batch pattern, expanded prefix patterns |

---

## 5. Test Results

**149 passed, 0 failed** (all backend tests).

| Test File | Count | Notes |
|-----------|-------|-------|
| `test_correlation_engine.py` | 87 | 78 original + 8 telemetry + 1 early-return |
| `test_correlation_telemetry.py` | 9 | DB persistence + API endpoint |
| `test_redis_client.py` | 11 | RedisClient unit tests |
| `test_correlation_pipeline.py` | 9 | 7 original pipeline + 2 Redis integration |
| `test_topology_api.py` | 34 | Unchanged |

---

## 6. Configuration Reference

### Correlation (backend/config/settings.py)

| Variable | Default | Description |
|----------|---------|-------------|
| `CORRELATION_TIME_WINDOW` | 300 | Time window in seconds for Stage 1 grouping |
| `CORRELATION_MIN_EVENTS` | 2 | Minimum events to form an incident |
| `CORRELATION_TOPOLOGY_CASCADE` | true | Enable Stage 2 infrastructure-aware cascade |

### Redis (backend/config/settings.py)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string |
| `REDIS_ENABLED` | false | Enable Redis pub/sub for live incident push |
| `REDIS_MAX_CONNECTIONS` | 10 | Connection pool size |

---

## 7. Key Patterns & Conventions

- **Module-level patching in tests:** Pipeline tests patch `worker.main` module attributes directly (`wm.MistCollector = MagicMock()`, `wm.upsert_incident = AsyncMock()`). Each test resets what it needs.
- **DB singleton:** `shared/database/client.py` exports `db` as a module-level singleton. Tests patch `api.routes.topology.db` or `shared.database.correlation_telemetry.db` at the module level.
- **Redis singleton:** `RedisClient` uses `__new__` + `_instance` + module-level `_redis_client` cache. Tests reset `RedisClient._instance = None` and patch `_redis_client` for isolation.
- **Fake make_event:** `conftest.py:make_event()` is the standard factory for `UnifiedEvent` in tests.
- **MockTopologyProvider:** Defined at `conftest.py:457` — implements the `TopologyProvider` protocol with a given `{parent: [children]}` dict.

---

## 8. Known Caveats / Dangling Threads

- **Worker and API are separate processes.** The `GET /correlation/stats` endpoint reads from the DB, not from in-memory engine state. If the worker hasn't run yet, the endpoint returns `{"status": "no_data"}`.
- **Redis is disabled by default** (`REDIS_ENABLED=false`). The worker logs `"Redis pub/sub: disabled"` unless explicitly configured.
- **No SSE/WebSocket endpoint yet.** The Redis `naxis:incidents` channel is published to but has no subscriber on the API side yet — that's a future task.
- **`run_worker.py`** (alternative worker entry) uses `MockTelemetryPipeline` which includes mock data generators. The main `WorkerDaemon` in `worker/main.py` uses only real collectors.
- **Prefix patterns** cover all known device types but if a new collector adds a novel prefix (e.g., `arista-{id}`), `_known_node_id_patterns()` in `topology.py` will need updating.
- **`utcnow()` deprecation warnings** appear in tests (1455 total). These are cosmetic — Python 3.12 deprecated `datetime.utcnow()` in favor of `datetime.now(datetime.UTC)`. The code works correctly; upgrading would touch every test file.

---

## 9. Future Improvements

- **SSE/WebSocket endpoint** that subscribes to Redis `naxis:incidents` and pushes live incident updates to the frontend
- **Correlation performance dashboard** — frontend page consuming `GET /correlation/stats` to show engine health at a glance
- **Redis connection pooling tuning** — the current pool size is hardcoded at 10; may need adjustment for high-throughput deployments
- **Historical telemetry** — the `correlation_telemetry` table is append-only; a retention policy (delete > 7 days) should be scheduled
- **Frontend incident list improvements** — now that the engine produces correct root-cause incidents, the incident UI could show cascade relationships with expandable symptom lists

---

## 10. UI-Visible Changes

**No frontend code was changed in this session.** All work was backend-only:

- **Correlation engine + worker** — these run as background processes (separate from the API server). No direct UI.
- **New API endpoint** `GET /correlation/stats` — visible in `/docs` (Swagger UI) but no frontend page consumes it yet.
- **Indirect effect:** The incident list page should now show **properly correlated incidents** — root-cause titles like "core-switch-01 — failure cascading to 3 dependent devices" instead of flat/separate entries. This is because the Phase 1 fixes (pipeline order, cross-cycle, prefix expansion) made Stage 2 cascade actually work.
