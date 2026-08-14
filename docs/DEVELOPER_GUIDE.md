# Naxis Developer Guide

Onboarding document for new developers. Covers the architecture, workflow, and conventions for the Naxis Network Resilient Platform.

---

## Stack (live, not aspirational)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Database | PostgreSQL (self-hosted, Docker) | Events, incidents, topology, telemetry ledger — everything |
| Backend | Python monolith, one Docker image, two entrypoints | API (FastAPI, port 8000) + Worker (async daemon) |
| Frontend | Next.js 15 (port 3000) + TanStack Query + shadcn | Web UI |
| Cache/notify | Redis (optional) | Real-time pub/sub for incidents; not an event bus |
| AI | None deployed | Future RCA uses LangGraph — no Ollama, no cloud LLMs |
| Deploy | docker-compose | `make up` / `make down` / `make rebuild` |

**Key simplification:** One database — PostgreSQL. No ClickHouse, no Neo4j, no managed services. The topology graph lives in Postgres (`topology_nodes` + `topology_edges` tables). Events and incidents are all in Postgres.

---

## Architecture

```
                    ┌──────────────────────┐
                    │   Next.js 15 (UI)    │  port 3000
                    └──────────┬───────────┘
                               │ HTTP + SSE
                               ▼
                    ┌──────────────────────┐
                    │  FastAPI (api)       │  port 8000
                    │  • Query endpoints   │
                    │  • CSV twins (.csv)  │
                    │  • Integration mgmt  │
                    └──────┬───────┬───────┘
                           │       │
                           ▼       ▼
                    ┌──────────┐ ┌──────────┐
                    │PostgreSQL│ │  Redis   │
                    │(primary) │ │(pub/sub) │
                    └────▲─────┘ └────▲─────┘
                         │            │
                         └──────┬─────┘
                                │
                     ┌──────────▼──────────────┐
                     │  Worker daemon           │
                     │  • Collect from vendors  │
                     │  • Normalize to Unified  │
                     │  • Sync topology graph   │
                     │  • Correlate → incidents │
                     │  • Record telemetry      │
                     └─────────────────────────┘
```

### Backend: one image, two processes

The `backend/Dockerfile` builds one image. Two entrypoints:
- **api**: `python -m backend.main` — FastAPI server
- **worker**: `python -m worker.main` — async polling daemon

Both share the same codebase, database, and models. No microservices.

---

## Quick Start

### Prerequisites
- Docker 20.10+ with Docker Compose 2.20+
- PowerShell 5.1+ (Windows) or bash (Linux/Mac)
- 8GB RAM minimum, 16GB recommended

### Running locally

```powershell
# Windows
.\dev.ps1
```

```bash
# Linux/Mac
make up
```

This starts PostgreSQL, Redis (optional), the API on port 8000, and the worker.

### Environment

Copy `config/.env.example` to `config/.env` and configure vendor credentials:

```env
# Database (defaults work for local Docker Postgres)
DATABASE_URL=postgresql+asyncpg://naxis:naxis@localhost:5432/naxis

# Vendor credentials
MIST_API_KEY=your-key
MIST_ORG_ID=your-org-id
DNAC_HOST=https://dnac.example.com
DNAC_USERNAME=admin
DNAC_PASSWORD=secret
DNAC_ENABLED=false        # DNAC not configured in dev

VELOCLOUD_API_KEY=your-key
VELOCLOUD_ENTERPRISE_ID=your-id

# Worker
COLLECTOR_INTERVAL=60     # seconds between collection cycles

# Correlation
CORRELATION_TOPOLOGY_CASCADE=true

# Redis (optional)
REDIS_ENABLED=false

# Notifications (optional, disabled by default)
# NOTIFICATION_ENABLED=true
# NOTIFICATION_MIN_FAILURES=3
# NOTIFICATION_MIN_SKIPS=10
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=notifier@example.com
# SMTP_PASSWORD=secret
# SMTP_FROM=naxis@example.com
# NOTIFICATION_EMAIL_TO=ops@example.com
# NOTIFICATION_DEDUP_MINUTES=15
```

### Running the worker directly (without Docker)

```powershell
# Terminal 1: Start PostgreSQL (if not running via Docker)
docker run -d --name naxis-pg -p 5432:5432 ^
  -e POSTGRES_USER=naxis -e POSTGRES_PASSWORD=naxis -e POSTGRES_DB=naxis ^
  postgres:16-alpine

# Terminal 2: Run worker
cd backend
python -m worker.main
```

---

## Codebase Walkthrough

```
naxis/
├── backend/
│   ├── main.py                 # FastAPI app entrypoint (api)
│   ├── Dockerfile              # Single Docker image
│   ├── config/
│   │   └── settings.py         # Pydantic-settings, typed env vars
│   ├── api/
│   │   ├── routes/             # FastAPI routers (events, incidents, topology, integrations, correlation)
│   │   └── services/           # Business logic (integration_service, etc.)
│   ├── worker/
│   │   ├── main.py             # WorkerDaemon orchestration
│   │   ├── collectors/         # Vendor collectors (mist.py, dnac.py, velocloud_inventory.py, etc.)
│   │   ├── topology/           # Topology sync logic
│   │   ├── correlation/        # Worker-side correlation wiring (if any)
│   │   └── processors/         # Event processors
│   ├── shared/
│   │   ├── models/             # UnifiedEvent, Incident, CollectorOutcome, enums
│   │   ├── correlation/        # CorrelationEngine (engine.py + rules.py)
│   │   └── database/           # DB clients (redis.py, correlation_telemetry.py)
│   └── tests/                  # All tests
│       ├── conftest.py         # Fixtures: make_event(), MockTopologyProvider
│       ├── test_correlation_engine.py    # 103 tests
│       ├── test_correlation_pipeline.py  # 11 integration tests
│       ├── test_correlation_telemetry.py # 9 telemetry tests
│       ├── test_redis_client.py          # 11 Redis tests
│       ├── test_topology_sync.py         # 13 topology sync tests
│       ├── test_topology_api.py          # Topology API tests
│       └── test_velocloud_collector.py   # 136 VeloCloud tests
├── frontend/
│   └── src/
│       ├── app/                # Next.js 15 App Router pages
│       ├── components/         # React components (shadcn/ui)
│       ├── hooks/              # useQueryState, API hooks
│       └── types/              # TypeScript types
├── schemas/
│   └── postgres/               # SQL files, auto-applied on first Postgres start
├── config/
│   └── .env                    # Environment (gitignored, copy from .env.example)
├── docs/                       # All documentation
├── docker-compose.yml          # Production stack
└── docker-compose.dev.yml      # Dev overrides
```

---

## Collector System

Every collector follows the same contract — returns a `CollectorOutcome`:

```python
@dataclass
class CollectorOutcome:
    collector_id: str      # e.g. "mist-events"
    source_system: str     # e.g. "mist"
    status: str            # "success" | "error" | "skipped"
    started_at: datetime
    finished_at: datetime
    events: List[UnifiedEvent]
    rows_written: int
    error_text: str
    metadata: dict
```

### How collectors run

The `WorkerDaemon.run_once()` cycle:
1. Runs all configured collectors (vendors, SNMP poll, health snapshot)
2. Records each outcome to `collector_run_ledger` table
3. Writes a worker heartbeat to `worker_heartbeat`
4. Persists events to Postgres
5. Syncs topology from inventory
6. Runs correlation engine → creates incidents
7. Publishes incidents to Redis (if enabled) — SSE endpoint `/correlation/incidents/stream` for real-time frontend push
8. Records correlation telemetry to DB
9. Runs collector health monitoring (failure/skip pattern detection on `collector_run_ledger`)
10. Runs notification dispatch — sends Slack webhook / SMTP email for collector failures and skips (if `NOTIFICATION_ENABLED=true`, with in-memory dedup to avoid spam)
11. Runs data retention cleanup (purging >7d data from telemetry tables)
12. Sleeps for `COLLECTOR_INTERVAL` seconds

### Current collectors (22+ total across 5+ vendors)

| Collector | Source | Status |
|-----------|--------|--------|
| `mist-events` | Mist API (alarms + audit logs) | ✅ Live |
| `mist-inventory` | Mist API (AP inventory + stats) | ✅ Live |
| `mist-ap-history` | Mist API (device lifecycle) | ✅ Live |
| `mist-ap-rf` | Mist API (wireless performance) | ✅ Live |
| `mist-client-topology` | Mist API (client mapping) | ⚠️ 0 rows (client tracking not enabled) |
| `mist-wired-uplink` | Mist API (AP-to-switch) | ✅ Live |
| `mist-radio-neighbors` | Mist API (RF interference) | ⚠️ 0 rows (radio scanning not enabled) |
| `dnac-devices` | DNAC Intent API | ✅ Registered (not configured) |
| `dnac-alarms` | DNAC Intent API | ✅ Registered (not configured) |
| `dnac-topology` | DNAC Intent API | ✅ Registered (not configured) |
| `dnac-clients` | DNAC Intent API | ✅ Registered (not configured) |
| `dnac-interfaces` | DNAC Intent API | ✅ Registered (not configured) |
| `velocloud-edges` | VCO API (edge inventory) | ✅ Live |
| `velocloud-links` | VCO API (link metrics) | ✅ Live |
| `velocloud-tunnels` | VCO API (tunnel health) | ✅ Live |
| `velocloud-events` | VCO API (enterprise events) | ✅ Live |
| `velocloud-apps` | VCO API (application visibility) | ⚠️ mark_skipped (VCO limit) |
| `arista-wlc-clients` | Arista WLC API (wireless clients) | ✅ Registered (not configured) |
| `arista-wlc-aps` | Arista WLC API (AP inventory) | ✅ Registered (not configured) |
| `arista-wlc-radios` | Arista WLC API (channel utilization) | ✅ Registered (not configured) |
| `arista-wlc-events` | Arista WLC API (controller events) | ✅ Registered (not configured) |
| `aruba-central` | Aruba Central API (cloud Wi-Fi) | ⬜ Code exists, not configured |

### Adding a new collector

1. Create a class inheriting the collector pattern in `backend/worker/collectors/`
2. Return `CollectorOutcome` from `collect()` (or `collect_all()` for sub-collectors)
3. Wire it into `WorkerDaemon` in `backend/worker/main.py`
4. Add `velocloud_<vendor>_enabled` env var + settings entry
5. Test: add tests in `backend/tests/`

---

## Correlation Engine

### Two stages

| Stage | What | Config flag |
|-------|------|-------------|
| 1 — Site + Time Window | Groups events by `site_id` + 5-minute window → flat incidents | Always on |
| 2 — Topology Cascade | Reorganizes groups by infra vs leaf device type → cascade incidents | `topology_cascade_enabled` |

### Key files

| File | Purpose |
|------|---------|
| `backend/shared/correlation/engine.py` | `CorrelationEngine.process_events()` — main pipeline |
| `backend/shared/correlation/rules.py` | `SiteTimeWindowRule`, `TopologyCascadeRule`, `TopologyProvider`, confidence, title gen |
| `backend/shared/models/event.py` | `UnifiedEvent`, `DeviceInfo`, `ClientInfo`, `EventSeverity` |
| `backend/shared/models/incident.py` | `Incident` model |
| `backend/config/settings.py` | `CorrelationSettings` — env → `CorrelationConfig` |

### Running correlation

Correlation runs automatically inside `WorkerDaemon.run_once()` after collection and topology sync. The engine:
- Filters events below `MAJOR` severity
- Groups by site + time window
- Applies topology cascade (Stage 2) if enabled
- Creates `Incident` objects in the database
- Publishes to Redis pub/sub (if enabled)
- Records telemetry to `correlation_telemetry` table

---

## Topology Sync

Topology is stored in PostgreSQL (`topology_nodes` + `topology_edges`). The sync runs after collection in `WorkerDaemon.run_once()`.

### Supported topology sources

| Source | What it creates |
|--------|----------------|
| Mist inventory | AP nodes (device_id, site_id, device_type="ap") |
| VeloCloud inventory | Edge nodes, gateway nodes, WAN link edges (site_membership + wan_link) |
| DNAC topology | Switch/router nodes, physical/L3 edges |

### How it works

`TopologySync` in `backend/worker/topology/`:
1. Reads inventory rows from the DB
2. Creates/updates nodes in `topology_nodes`
3. Creates edges in `topology_edges` (site_membership, wan_link, physical, l3)
4. Deletes stale nodes/edges from previous sync

---

## Testing

### Run full suite

```powershell
pytest backend\tests -v
```

Current: **432 backend tests, 0 failures** + **114 frontend tests** (`cd frontend && npm test`).

### Test files

| File | Tests | What |
|------|-------|------|
| `test_velocloud_collector.py` | 138 | VeloCloud collector, `_build_rows`, `_upsert_inventory`, normalization |
| `test_correlation_engine.py` | 105 | CorrelationEngine Stage 1 + Stage 2, identity merge (WP-2.2), rules, confidence, titles, dedup, recovery, cross-cycle escalation |
| `test_correlation_pipeline.py` | 11 | Full pipeline: collector → event → correlation → incident |
| `test_correlation_telemetry.py` | 9 | DB persistence + API endpoint for correlation stats |
| `test_incident_enrichment.py` | 6 | Alerts enrichment: site/root-device display names, UUID + numeric fallbacks, detail route regression |
| `test_incident_stats_api.py` | 5 | `GET /incidents/stats` SQL aggregates, zero-fill, route ordering |
| `test_incidents_api.py` | 3 | `GET /incidents` status filter reaches SQL; invalid status → 422 |
| `incident-stats.test.ts` (frontend) | 5 | `buildStats()` KPI fallback: SQL passthrough, true total, confidence mean, zero-fill |
| `alerts.test.ts` (frontend) | 3 | `groupByRootCause()` grouping, fallback labels, severity+recency sort |
| `utils.test.ts` (frontend) | 6 | `formatElapsed()` durations: minutes/hours/days, NaN/negative guards |
| `test_redis_client.py` | 11 | RedisClient: publish, health, warm_up, close |
| `test_topology_sync.py` | 13 | `_sync_velocloud_topology`, `_sync_mist_topology` |
| `test_topology_api.py` | Var | Topology API endpoints |

### Test conventions

- `make_event()` fixture in `conftest.py` creates test `UnifiedEvent` objects
- `MockTopologyProvider` in `conftest.py` seeds topology relationships for tests
- All async tests use `@pytest.mark.asyncio`
- No mock/stub imports in production code — all mocks are test-only

---

## Key Conventions

### Database
- History/audit tables are append-only, one row per meaningful state change
- Schema files in `schemas/postgres/NNN_*.sql`, auto-applied on first Postgres start

### API
- Every list-style JSON endpoint has a `.csv` twin at the same path (streaming `StreamingResponse`, ISO 8601 UTC)

### Frontend
- `@/` alias → `frontend/src/`
- Tab/view state survives refresh: `useQueryState` from `@/hooks/use-query-state`, never plain `useState`
- `useSearchParams()` requires `<Suspense>` boundary — split into `PageInner` + default export

### Feature flags
- Vendor integrations use `<vendor>_enabled` bool in settings — never hard-fail when off

### Environment
- Config in `config/.env`, typed in `backend/config/settings.py` (pydantic-settings)

### Redis
- Optional and non-blocking — worker continues without it
- Only used for real-time incident notifications (pub/sub channel `naxis:incidents`)

---

## Docs Landscape

| Doc | What it covers |
|-----|---------------|
| `docs/TELEMETRY_ARCHITECTURE.md` | Collector → ledger → UI architecture; per-collector health; notification system |
| `docs/CORRELATION_ARCHITECTURE.md` | Full correlation engine design (Stage 1 + 2) |
| `docs/FRONTEND_ARCHITECTURE.md` | Frontend structure and patterns |
| `docs/TOPOLOGY_VISUALIZATION.md` | Topology graph rendering |
| `docs/Plans/` | Session plans (each numbered session has a plan) |
| `docs/handoff docs/` | AI session handoffs (detailed per-session changes) |
| `docs/why/` | Product rationale for major features |

---

## Session History (Summary)

| Session | Focus |
|---------|-------|
| 1–7 | Foundation: schema, collectors, API, frontend |
| 8–11 | Mist collectors, topology architecture, integration page |
| 12 | Integration status UI, telemetry ledger |
| 13–14 | DNAC collector suite (5 sub-collectors) |
| 15 | Correlation engine (Stage 1 + Stage 2) wired into production pipeline |
| 16 | VeloCloud end-to-end verification: fix `props` data gap, 151 new tests, topology sync |
| 17 | Dashboard Collector Health Widget, TelemetryAlertType fix |
| 18 | Phase A–F completion: 26 items across oversight, pipeline wiring, monitoring, frontend UX, technical debt |
| 19 | VeloCloud all-5-collectors live, notification system (Slack+email+dedup), dashboard event count UX overhaul, DB index + shm_size |
| 20 | Boil-the-ocean audit: verified every claim against production DB, fixed hardcoded vendor/site counts, corrected all doc statuses, removed duplicate index, VACUUM completed, fixed ReactFlow border conflict |
| 21 | Topology cascade fix: identifier translation (node_id → device_id), removed heuristic fallback, fixed 11 silent `except: pass` patterns, 30 new topology tests |
| 22 | Correlation noise fix: root-cause merge via `ON CONFLICT DO UPDATE`, recovery resolution (`DEVICE_REACHABLE` auto-resolves), incident count stable at ~8,845 |
| 23 | Human incident titles: real site names + root device hostnames + plain-language issues (e.g. "Pimpri Plant · AP32-02 unreachable — 5 devices affected") |
| 24 | Close out 10 pre-existing test failures (stale tests, not env issues); fixed worker healthcheck (`ps` → `/proc/1/cmdline`) |
| 25 | Truthful KPIs: `GET /incidents/stats` single-pass SQL aggregates; replaced N+1 `get_stats()`; added "Sites affected" / "Devices affected" |
| 26 | Dead code removal: deleted legacy `run_worker.py`, `services/`, `db/`, `mock_ingest/` — 392 tests pass after removal |
| 27 | Alerts page UX: grouped by root cause, "ongoing for 2h 14m" duration, backend enrichment via `resolve_display_names()` |
| 28 | Storage hygiene: retention fixes, diff-on-write RF/uplink emitters, 7-day raw_event debug window, `INCIDENT_RETENTION_DAYS`, dead code removed |
| 29 | WP-0 follow-up: raw_event bloat stripped (5.2 GB → 877 MB), 50K fixture export, docs sweep corrected |
| 30 | WP-1 Canonical Identity Layer: `sites/devices/device_identities` tables, `IdentityResolver`, 4,102 identities backfilled |
| 31 | WP-2.1 Fix Inverted Edge Direction: `links` table with `parent_node_id`/`child_node_id`, corrected physical link direction |
| 32 | WP-2.2 Fix Incident Identity: deterministic fault fingerprint `SHA-256(site_id | root_device_id | category)`, SQL array union, severity escalation only |
| 33–49 | Enterprise topology redesign: readable layered layout, regional hub cards, all-sites data grid, NOC floorplans redesign, locations registry |

**Work Packages (WP):**
- **WP-0** — Storage hygiene (retention, diff-on-write, dead code)
- **WP-1** — Canonical identity layer (cross-vendor device resolution)
- **WP-2** — Correlation hardening (edge direction, incident identity, evidence merge)

---

*Last updated: 2026-08-14*
