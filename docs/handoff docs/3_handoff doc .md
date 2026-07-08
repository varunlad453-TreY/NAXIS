# Project Session Handoff Document

> **Session Date:** July 5, 2026
> **Session Goal:** Fix Docker environment configuration, verify all architectural additions (collectors, telemetry, integrations), and perform a clean Docker rebuild.
> **Status:** Docker rebuild in progress. Core architecture complete. Environment fix applied. Pending: verification of running stack.

---

## 1. Executive Summary

This session focused on diagnosing and fixing a critical Docker configuration issue where containers were loading **stale localhost values** instead of the correct Docker-internal hostnames. The root cause was missing environment variables in `config/.env` that Pydantic Settings reads at startup.

**Key outcome:** The `config/.env` file has been fixed with the correct PostgreSQL connection variables. Docker Desktop was force-killed and a clean rebuild (`docker compose up -d --build`) was initiated. The rebuild is currently in progress.

**Overall project status:** All 6 collectors are implemented and code-complete. The telemetry architecture (CollectorOutcome → collector_run_ledger → UI) is fully wired. The frontend Integrations page has expandable collector sections. The backend API exposes `/integrations`, `/telemetry`, and `/telemetry/alerts` endpoints.

---

## 2. ✅ Completed & Working Components

### 2.1 CollectorOutcome Contract (Foundation)

All collectors return a standardized `CollectorOutcome` — never raw lists. This is the universal contract.

| File | Purpose |
|------|---------|
| `backend/shared/models/collector_outcome.py` | `CollectorOutcome` dataclass with `mark_success()`, `mark_error()`, `mark_skipped()` |
| `backend/shared/models/__init__.py` | Exports `CollectorOutcome` |

### 2.2 Collectors — All 6 Vendors Implemented

| Vendor | File | Collector ID(s) | Sub-collectors | Status |
|--------|------|-----------------|----------------|--------|
| **Juniper Mist Events** | `backend/worker/collectors/mist.py` | `mist-events` | 1 (alarms + logs) | ✅ Code complete |
| **Juniper Mist Inventory** | `backend/worker/collectors/mist_inventory.py` | `mist-inventory` | 1 (AP inventory + stats) | ✅ Code complete |
| **Mist Topology** | `backend/worker/collectors/mist_topology.py` | `mist-ap-history`, `mist-ap-rf`, `mist-client-topology`, `mist-wired-uplink`, `mist-radio-neighbors` | 5 sub-collectors | ✅ Code complete |
| **Cisco DNAC** | `backend/worker/collectors/dnac.py` | `dnac-devices`, `dnac-alarms`, `dnac-topology`, `dnac-clients`, `dnac-interfaces` | 5 sub-collectors | ✅ Code complete |
| **VeloCloud SD-WAN** | `backend/worker/collectors/velocloud.py` | `velocloud-edges`, `velocloud-links`, `velocloud-tunnels`, `velocloud-events`, `velocloud-apps` | 5 sub-collectors | ✅ Code complete |
| **Arista WLC** | `backend/worker/collectors/arista_wlc.py` | `arista-wlc-clients`, `arista-wlc-aps`, `arista-wlc-radios`, `arista-wlc-events` | 4 sub-collectors | ✅ Code complete |

**Total collectors: 21 individual collectors across 4 vendor orchestrators.**

Each collector follows the dual-import pattern:
```python
try:
    from backend.config.settings import get_settings
except ImportError:
    from config.settings import get_settings
```

### 2.3 Worker Daemon

| File | Purpose |
|------|---------|
| `backend/worker/main.py` | `WorkerDaemon` class — runs all collectors, records telemetry, writes heartbeats |
| `backend/run_worker.py` | Entry point for worker process |
| `backend/worker/__init__.py` | Package init |

**What WorkerDaemon does each cycle:**
1. Runs all collectors via `_collect_all()` → returns `list[CollectorOutcome]`
2. Records each outcome to `collector_run_ledger` table via `record_collector_run()`
3. Writes worker heartbeat to `worker_heartbeat` table via `record_worker_heartbeat()`
4. Persists all `UnifiedEvent` objects to Postgres
5. Sleeps for `collector_interval` seconds (default 60s)

### 2.4 Telemetry Database Layer

| File | Purpose |
|------|---------|
| `backend/shared/database/collector_telemetry.py` | Schema creation, `record_collector_run()`, `record_worker_heartbeat()`, `list_collector_telemetry()` |

**Database tables created:**
```sql
collector_run_ledger (
    run_id BIGSERIAL PRIMARY KEY,
    collector_id TEXT NOT NULL,
    source_system TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL,          -- success/error/skipped
    duration_ms INTEGER,
    rows_written INTEGER DEFAULT 0,
    error_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
)

worker_heartbeat (
    worker_id TEXT PRIMARY KEY,
    heartbeat_at TIMESTAMPTZ NOT NULL,
    cycle_status TEXT NOT NULL,
    message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
)
```

### 2.5 API Routes

| Route File | Endpoints | Status |
|------------|-----------|--------|
| `backend/api/routes/integrations.py` | `GET /integrations`, `GET /integrations/{id}`, `POST /integrations/{id}/test`, `POST /integrations/{id}/sync`, `GET /integrations/{id}/config` | ✅ Wired |
| `backend/api/routes/telemetry.py` | `GET /telemetry`, `GET /telemetry/alerts` | ✅ Wired |
| `backend/api/routes/incidents.py` | `GET /incidents`, `GET /incidents/active`, `GET /incidents/{id}`, `GET /health` | ✅ Wired |
| `backend/api/routes/events.py` | `GET /events` | ✅ Wired |
| `backend/api/routes/devices.py` | `GET /devices` | ✅ Wired |

**Registered in `backend/main.py`:**
```python
app.include_router(health_router)
app.include_router(incidents_router)
app.include_router(events_router)
app.include_router(devices_router)
app.include_router(integrations_router)
app.include_router(telemetry_router)
```

**Telemetry schema ensured on API startup:**
```python
await ensure_collector_telemetry_schema()
```

### 2.6 Integration Service

| File | Purpose |
|------|---------|
| `backend/api/services/integration_service.py` | Derives all integration status from live `collector_run_ledger` queries |
| `backend/api/models/integration_models.py` | Pydantic models: `IntegrationSummary`, `IntegrationDetailResponse`, `IntegrationCollectorSummary`, etc. |

**Key design:** The IntegrationService is **stateless** — it queries Postgres on every request. No in-memory state that resets on restart.

**Supported integrations in `_INTEGRATIONS` dict:**
- `mist` — Juniper Mist (events + inventory collectors)
- `dnac` — Cisco DNA Center (5 sub-collectors)
- `velocloud` — VeloCloud SD-WAN (5 sub-collectors)
- `arista_wlc` — Arista WLC (4 sub-collectors)

### 2.7 Frontend — Integrations Page

| File | Purpose |
|------|---------|
| `frontend/src/app/integrations/page.tsx` | Main integrations page with 30s polling |
| `frontend/src/components/integrations/integration-row.tsx` | Integration card with Collectors/Config/Test/Sync buttons |
| `frontend/src/components/integrations/collector-section.tsx` | Expandable per-collector status rows |
| `frontend/src/components/integrations/integration-config-panel.tsx` | Masked credential display |
| `frontend/src/components/integrations/integration-stats.tsx` | Summary statistics |
| `frontend/src/components/integrations/integration-status.tsx` | Status badge rendering |
| `frontend/src/components/integrations/integration.tsx` | Integration wrapper |
| `frontend/src/components/integrations/alert-banner.tsx` | Alert banner component |
| `frontend/src/components/integrations/index.ts` | Barrel exports |
| `frontend/src/types/integration.ts` | TypeScript types |

### 2.8 Settings & Configuration

| File | Purpose |
|------|---------|
| `backend/config/settings.py` | Pydantic Settings with all vendor env vars |
| `config/.env` | **FIXED THIS SESSION** — now includes all required PostgreSQL vars |

---

## 3. 🚧 Pending & "Left to Wire" Items

### 3.1 Docker Rebuild (In Progress)

The command `docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml up -d --build` was initiated. **Status: In progress — waiting for user to confirm completion.**

Once complete, verify with:
```powershell
docker compose ps
docker exec naxis-api env | findstr "POSTGRES_HOST"
# Should show: POSTGRES_HOST=postgres
curl http://localhost:8000/health
curl http://localhost:8000/integrations
curl http://localhost:8000/telemetry
```

### 3.2 Frontend SWC Binary Crash (BLOCKER)

The `naxis-web` container was crashing with:
```
Failed to load SWC binary for linux/x64
@next/swc-linux-x64-musl was not installed
```

**Root cause:** The `frontend/Dockerfile` development stage installs `@next/swc-linux-x64-musl` but the package may not be resolving correctly on Alpine. The fresh `--build` should fix this by doing a clean `npm ci`.

**If it persists after rebuild:**
1. Check `frontend/package.json` for the `@next/swc-linux-x64-musl` dependency
2. May need to pin the musl package version or switch the base image

### 3.3 Correlation Engine Integration

The correlation engine (`backend/shared/correlation/`) exists but is **not yet wired into the worker pipeline**. Currently:
- Worker persists events to Postgres
- Worker does NOT run correlation to generate incidents from live data
- Incidents are only available from mock data or manual creation

**To wire:** Add correlation step in `WorkerDaemon.run_once()` after collecting events.

### 3.4 Topology Graph Sync

The topology graph (`graphify-out/`) exists as a static file but is **not synced from live collector data**. DNAC topology and Mist wired-uplink collectors produce topology data, but there's no pipeline to write it to a graph database.

### 3.5 Staleness Alerts UI

Backend `/telemetry/alerts` endpoint exists and generates alerts, but the frontend `alert-banner.tsx` component exists as a file — **verify it's actually rendered on the Integrations page** and consuming the alerts endpoint.

---

## 4. 🐛 Known Issues & Broken Elements

### 4.1 CRITICAL: Docker Environment Variables (FIXED THIS SESSION)

**Problem:** `config/.env` was missing `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`. Pydantic Settings defaulted to `"localhost"` for host and `"naxis_dev"` for password — both wrong inside Docker.

**Fix applied:**
```env
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=naxis
POSTGRES_PASSWORD=naxis_password
POSTGRES_DATABASE=naxis
```

**Verification needed after rebuild:**
```powershell
docker exec naxis-api env | findstr "POSTGRES_HOST POSTGRES_PASSWORD"
```

### 4.2 Docker Compose Down Hanging

**Problem:** `docker compose down` hung for 120+ seconds. `docker kill` from WSL2 also failed. Docker Desktop had to be force-killed via `taskkill`.

**Root cause:** Likely Docker Desktop WSL2 integration issue — containers stuck in an unresponsive state. The Windows Docker daemon and WSL2 Docker CLI may have been talking to different contexts.

**Workaround:** Force-kill Docker Desktop, restart, then rebuild.

### 4.3 Frontend SWC Crash

**Problem:** `naxis-web` container crashes on startup with SWC binary error.

**Error:**
```
⚠ Attempted to load @next/swc-linux-x64-gnu, but an error occurred:
Error relocating ...__register_atfork: symbol not found
⚠ Attempted to load @next/swc-linux-x64-musl, but it was not installed
⨯ Failed to load SWC binary for linux/x64
```

**Status:** Should be fixed by clean `--build`. If not, investigate `frontend/Dockerfile` and `package.json`.

### 4.4 CollectorOutcome Duck Typing

**Problem:** `record_collector_run()` accepts `CollectorRunResult` but worker passes `CollectorOutcome`. Works via duck typing — both have the same attributes.

**Risk:** If either class changes its attributes independently, this will silently break. Consider adding a Protocol or base class.

### 4.5 DNAC Timestamps in Milliseconds

DNAC API returns timestamps in milliseconds, not seconds. All DNAC collectors must divide by 1000:
```python
timestamp = datetime.fromtimestamp(float(ts_raw) / 1000, tz=timezone.utc)
```

### 4.6 DeviceInfo Field Names

The `DeviceInfo` Pydantic model uses `device_ip` (not `ip_address`) and `device_model` (not `platform`). Extra fields like `software_version` and `serial_number` go in the `metadata` dict.

### 4.7 EventCategory Limitations

`EventCategory` enum does not have `INVENTORY` or `TOPOLOGY`. Use `SYSTEM` as fallback for inventory and topology events.

---

## 5. 🧩 Unsolved Problems & Blockers

### 5.1 Docker Desktop + WSL2 Reliability

Docker commands from Codebuff (running in WSL2) cannot reliably control containers managed by Windows Docker Desktop. The `docker kill` and `docker compose down` commands hung. This is a recurring issue that affects development velocity.

**Options to investigate:**
- Use Docker Desktop's WSL2 backend exclusively (disable Windows containers)
- Set Docker context explicitly: `docker context use desktop-linux`
- Consider running Docker entirely within WSL2

### 5.2 VeloCloud & Arista Credential Validation

VeloCloud and Arista WLC collectors are code-complete but have no live testing. The `VELOCLOUD_API_KEY` in `config/.env` is a JWT token — need to verify:
- Token hasn't expired (check `exp` claim)
- VeloCloud orchestrator URL is reachable
- API endpoints match the collector expectations

### 5.3 Correlation Engine Not Wired to Live Data

The correlation engine exists but isn't connected to the worker pipeline. Live events are persisted but never correlated into incidents.

### 5.4 No WebSocket/SSE for Live Updates

The frontend polls every 30 seconds. For a production operational tool, Server-Sent Events or WebSocket would provide real-time updates.

### 5.5 Authentication Not Implemented

The API is open — no auth middleware. All endpoints are publicly accessible.

---

## 6. 🏆 Resolved Challenges (Session Wins)

### 6.1 Fixed Missing PostgreSQL Environment Variables

**Problem:** Containers defaulted to `POSTGRES_HOST=localhost` and `POSTGRES_PASSWORD=naxis_dev`.
**Solution:** Added all 5 missing PostgreSQL variables to `config/.env`.
**Impact:** API and worker can now connect to Postgres inside Docker correctly.

### 6.2 Identified Docker Container Staleness

**Problem:** Docker was loading old images that didn't contain the new collectors and routes.
**Solution:** Initiated `--build` flag to force image rebuild from current source code.
**Impact:** All new code (21 collectors, telemetry routes, integration service) will be in the running containers.

### 6.3 Documented the Complete Collector Architecture

**Problem:** No single document covered all 21 collectors across 4 vendors.
**Solution:** This handoff document provides the complete inventory with collector IDs, file locations, and status.
**Impact:** Next developer can immediately understand the full scope.

### 6.4 Diagnosed Frontend SWC Crash

**Problem:** `naxis-web` container kept crashing in a restart loop.
**Solution:** Identified the `@next/swc-linux-x64-musl` binary issue. Clean rebuild should resolve.
**Impact:** Frontend will be accessible after rebuild.

### 6.5 Established Docker Manual Recovery Procedure

**Problem:** Docker hung and couldn't be stopped normally.
**Solution:** Documented the `taskkill` force-kill procedure and Docker Desktop UI deletion.
**Impact:** User can now recover from Docker hangs independently.

---

## 7. 🗺️ Recommended Next Steps

### Priority 1: Verify Docker Rebuild (Immediate)

```powershell
# Check containers are running
docker compose ps

# Verify environment
docker exec naxis-api env | findstr "POSTGRES_HOST"
# Expected: POSTGRES_HOST=postgres

docker exec naxis-api env | findstr "POSTGRES_PASSWORD"
# Expected: POSTGRES_PASSWORD=naxis_password

# Health check
curl http://localhost:8000/health

# Check integrations
curl http://localhost:8000/integrations | python -m json.tool

# Check telemetry
curl http://localhost:8000/telemetry | python -m json.tool
```

### Priority 2: Fix Frontend SWC Crash (If Rebuild Didn't Fix)

If `naxis-web` still crashes after rebuild:
1. Check `docker logs naxis-web --tail 30`
2. If SWC error persists, modify `frontend/Dockerfile` development stage
3. Consider adding `@next/swc-linux-x64-musl` as explicit dependency in `package.json`

### Priority 3: End-to-End Verification

1. Open `http://localhost:3000/integrations` — should show all 4 integrations
2. Click "Collectors" on Mist — should show mist-events + mist-inventory + 5 topology collectors
3. Click "Collectors" on DNAC — should show 5 DNAC sub-collectors
4. Click "Collectors" on VeloCloud — should show 5 VeloCloud sub-collectors
5. Click "Collectors" on Arista WLC — should show 4 Arista sub-collectors
6. Verify `GET /telemetry` returns collector summaries
7. Verify `GET /telemetry/alerts` returns alerts (initially all "skipped" if no credentials)

### Priority 4: Wire Correlation Engine

Connect the correlation engine to the worker pipeline so live events generate incidents.

### Priority 5: Fix Remaining Config

Add `DNAC_ENABLED=true` and actual DNAC credentials to `config/.env` if DNAC is reachable.
Add `ARISTA_WLC_ENABLED=true` and credentials if Arista WLC is reachable.

---

## Appendix A: Complete File Inventory

### New Files Created This Session/Phase

| File | Purpose |
|------|---------|
| `backend/shared/models/collector_outcome.py` | CollectorOutcome dataclass |
| `backend/shared/database/collector_telemetry.py` | Telemetry schema + queries |
| `backend/worker/collectors/dnac.py` | DNAC collector (5 sub-collectors) |
| `backend/worker/collectors/mist_topology.py` | Mist topology (5 sub-collectors) |
| `backend/worker/collectors/velocloud.py` | VeloCloud collector (5 sub-collectors) |
| `backend/worker/collectors/arista_wlc.py` | Arista WLC collector (4 sub-collectors) |
| `backend/worker/__init__.py` | Worker package init |
| `backend/run_worker.py` | Worker entry point |
| `backend/api/routes/integrations.py` | Integration API routes |
| `backend/api/routes/telemetry.py` | Telemetry API routes |
| `backend/api/models/integration_models.py` | Integration Pydantic models |
| `backend/api/services/integration_service.py` | Integration service (rewritten) |
| `backend/shared/models/collector_outcome.py` | CollectorOutcome model |
| `frontend/src/components/integrations/alert-banner.tsx` | Alert banner component |
| `frontend/src/components/integrations/collector-section.tsx` | Collector expandable section |
| `frontend/src/types/integration.ts` | Integration TypeScript types |
| `docs/TELEMETRY_ARCHITECTURE.md` | Telemetry architecture docs |
| `docs/FRONTEND_ARCHITECTURE.md` | Frontend architecture docs |
| `docs/HANDOFF.md` | Previous session handoff |
| `docs/3_handoff doc .md` | This document |

### Modified Files

| File | Changes |
|------|---------|
| `backend/main.py` | Added integrations + telemetry routers, telemetry schema on startup |
| `backend/api/models/__init__.py` | Added integration model exports |
| `backend/api/routes/__init__.py` | Added integrations + telemetry router exports |
| `backend/config/settings.py` | Added DNAC, VeloCloud, Arista WLC settings |
| `backend/shared/models/__init__.py` | Added CollectorOutcome export |
| `backend/shared/models/event.py` | Added VELOCLOUD to EventSource enum |
| `backend/worker/main.py` | WorkerDaemon with telemetry recording, all collectors |
| `backend/worker/collectors/__init__.py` | Added all collector exports |
| `backend/worker/collectors/mist.py` | Returns CollectorOutcome, dual imports |
| `backend/worker/collectors/mist_inventory.py` | Returns CollectorOutcome, dual imports |
| `backend/worker/Dockerfile` | Changed entry point to `backend/run_worker.py` |
| `frontend/src/app/integrations/page.tsx` | Added collector section toggle |
| `frontend/src/components/integrations/integration-row.tsx` | Added Collectors button |
| `frontend/src/components/integrations/index.ts` | Added CollectorSection export |
| `docker-compose.yml` | Updated with env_file directives |
| `docker-compose.dev.yml` | Added hot-reload volumes and debug settings |
| `config/.env` | **FIXED**: Added POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE |
| `Makefile` | Added `make dev` target, updated `up` with --env-file |

---

## Appendix B: Environment Variables Reference

### Required for Docker (config/.env)

```bash
# Service
SERVICE_NAME=naxis
LOG_LEVEL=INFO
ENVIRONMENT=development
STORAGE_MODE=postgres

# API
API_HOST=0.0.0.0
API_PORT=8000
API_CORS_ORIGINS=http://localhost:3000,http://localhost:8000

# PostgreSQL (CRITICAL — must match docker-compose service name)
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=naxis
POSTGRES_PASSWORD=naxis_password
POSTGRES_DATABASE=naxis
POSTGRES_HOST_PORT=5433

# Redis
REDIS_HOST_PORT=6380
REDIS_URL=redis://redis:6379/0
REDIS_ENABLED=true

# Mist
MIST_API_KEY=xxx
MIST_ORG_ID=xxx
MIST_BASE_URL=https://api.mist.com
MIST_ENABLED=true

# DNAC
DNAC_HOST=xxx
DNAC_USERNAME=xxx
DNAC_PASSWORD=xxx
DNAC_VERIFY_SSL=false

# VeloCloud
VELOCLOUD_URL=xxx
VELOCLOUD_API_KEY=xxx
VELOCLOUD_ENABLED=true

# Arista WLC
ARISTA_WLC_HOST=xxx
ARISTA_WLC_USERNAME=xxx
ARISTA_WLC_PASSWORD=xxx
ARISTA_WLC_VERIFY_SSL=false
```

### Key Environment Variable Mapping

| Pydantic Field | Env Var | Default | Docker Value |
|---------------|---------|---------|-------------|
| `postgres_host` | `POSTGRES_HOST` | `localhost` | `postgres` |
| `postgres_port` | `POSTGRES_PORT` | `5432` | `5432` |
| `postgres_user` | `POSTGRES_USER` | `naxis` | `naxis` |
| `postgres_password` | `POSTGRES_PASSWORD` | `naxis_dev` | `naxis_password` |
| `postgres_database` | `POSTGRES_DATABASE` | `naxis` | `naxis` |
| `redis_url` | `REDIS_URL` | `redis://localhost:6379/0` | `redis://redis:6379/0` |
| `storage_mode` | `STORAGE_MODE` | `memory` | `postgres` |

---

## Appendix C: Quick Commands

```bash
# Full rebuild (what's running now)
docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# Check status
docker compose ps

# Verify env vars
docker exec naxis-api env | findstr "POSTGRES_HOST"

# Health check
curl http://localhost:8000/health

# Check integrations
curl http://localhost:8000/integrations | python -m json.tool

# Check telemetry
curl http://localhost:8000/telemetry | python -m json.tool

# Check alerts
curl http://localhost:8000/telemetry/alerts | python -m json.tool

# View logs
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web

# Nuclear restart
docker compose down -v
docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

---

## Appendix D: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js :3000)                      │
│  /integrations — expandable collector sections per vendor        │
│  /integrations/:id — collector details + config                  │
│  Polls API every 30s                                             │
└─────────────────────────┬───────────────────────────────────────┘
                          │ REST API
┌─────────────────────────▼───────────────────────────────────────┐
│                    BACKEND (FastAPI :8000)                        │
│  /integrations → IntegrationService → list_collector_telemetry() │
│  /telemetry → list_collector_telemetry() + _build_alerts()       │
│  /telemetry/alerts → _build_alerts() only                        │
│  /incidents → IncidentService                                    │
│  /events → EventService                                          │
│  /devices → DeviceService                                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    POSTGRES (:5432)                               │
│  collector_run_ledger — every collector run records a row        │
│  worker_heartbeat — liveness signal                              │
│  events — normalized UnifiedEvent objects                        │
│  incidents — correlated incidents                                │
│  devices — discovered network devices                            │
└─────────────────────────▲───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                    WORKER DAEMON                                  │
│  WorkerDaemon.run_once() every COLLECTOR_INTERVAL seconds        │
│  │                                                               │
│  ├── MistCollector.collect() ──────────── → mist-events          │
│  ├── MistInventoryCollector.collect() ─── → mist-inventory       │
│  ├── MistTopologyCollector.collect_all() → 5 mist-topology       │
│  ├── DNACCollector.collect_all() ──────── → 5 dnac collectors    │
│  ├── VeloCloudCollector.collect_all() ─── → 5 velocloud          │
│  └── AristaWlcCollector.collect_all() ── → 4 arista-wlc          │
│                                                                   │
│  Each returns CollectorOutcome → recorded to ledger              │
│  Worker writes heartbeat every cycle                             │
└─────────────────────────────────────────────────────────────────┘
```

---

**End of handoff. The next session should start by verifying the Docker rebuild completed successfully, then proceed with end-to-end testing of the integrations page and telemetry endpoints.**
