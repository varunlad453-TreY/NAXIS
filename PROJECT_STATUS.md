# Naxis Project Status

**Last Updated:** 2026-06-20  
**Version:** 1.0.0  
**Status:** 🚧 Milestone B Complete — Persistence Layer Implemented

---

## Executive Summary

The **Naxis Operational Intelligence Platform** now has a **working persistence layer** (Milestone B). Events, incidents, and devices can be stored in ClickHouse/Neo4j when `STORAGE_MODE=clickhouse`, while `STORAGE_MODE=memory` keeps the original in-memory MVP behavior for tests and local demos.

### What just landed

- ClickHouse, Redis, and Neo4j async clients in `backend/shared/database/`
- `IncidentService` backed by ClickHouse (or in-memory fallback)
- `EventService` + `GET /events` endpoint
- `DeviceService` + `GET /devices` endpoint
- Worker persists events, incidents, and discovered devices every cycle
- Redis pub/sub for live incident broadcasts (when `REDIS_ENABLED=true`)
- Frontend type/data-contract bugs fixed (`affected_clients_count`, StatsPanel math)

### Remaining gaps

1. **Real vendor collectors** — still mock-only.
2. **Topology-aware correlation rules** — only site-time-window rule exists.
3. **AI RCA** — `probable_cause` field exists but is never populated.
4. **Auth, monitoring, CI/CD, K8s** — not started.

---

## Components Status

### Backend

| Component | Status | Files | Tests | Notes |
|-----------|--------|-------|-------|-------|
| **Event / Incident Schema** | ✅ Working | `backend/shared/models/` | 8/8 passing | Pydantic v2 models, ClickHouse row helpers |
| **Correlation Engine** | ⚠️ Partial | `backend/shared/correlation/` | 9/9 passing | Site-time window rule only; topology & MAC rules missing |
| **Mock Telemetry** | ✅ Working | `backend/worker/mock_ingest/` | Validated | DNAC, Mist, SD-WAN generators |
| **FastAPI Server** | ✅ Working | `backend/api/` | 16/16 passing | `/health`, `/incidents`, `/events`, `/devices` |
| **Worker Daemon** | ✅ Working | `backend/worker/main.py` | New | Persists events/incidents/devices per cycle |
| **ClickHouse Client** | ✅ Working | `backend/shared/database/clickhouse.py` | New | Async wrapper, insert + query events/incidents |
| **Redis Client** | ✅ Working | `backend/shared/database/redis.py` | New | Pub/sub for live incident feed |
| **Neo4j Client** | ✅ Working | `backend/shared/database/neo4j.py` | New | Topology upsert + device list |
| **Database Clients** | ✅ Implemented | `backend/shared/database/` | New | ClickHouse/Redis/Neo4j clients present |
| **Real Collectors** | ❌ Missing | N/A | N/A | No DNAC/Mist/Arista API clients |
| **AI RCA Service** | ❌ Missing | N/A | N/A | `probable_cause` field exists but is never populated |

**Total Backend Tests:** 39 passing (34 original + 5 new persistence/API tests).

### Frontend

| Component | Status | Files | Notes |
|-----------|--------|-------|-------|
| **Next.js App** | ✅ Working | `frontend/src/app/` | App Router, providers, globals |
| **Incident Dashboard** | ✅ Working | `frontend/src/app/page.tsx` | Active/All toggle, 10s polling, stats panel |
| **Incident Detail** | ✅ Working | `frontend/src/app/incidents/[id]/page.tsx` | Drill-down, blast radius, related events |
| **UI Components** | ✅ Working | `frontend/src/components/` | Badges, skeletons, cards |
| **API Client** | ✅ Working | `frontend/src/lib/api.ts` | Typed fetch wrapper (incidents only) |
| **Device Explorer** | ⚠️ Backend ready | `backend/api/routes/devices.py` | UI page not built yet |
| **Event Timeline** | ⚠️ Backend ready | `backend/api/routes/events.py` | Full `/events` page not implemented |

**Frontend Build:** `npm run build` passes, `npm run type-check` passes.

### Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| **Docker Compose stack** | ✅ Ready | 7 services declared; worker entry point and API health checks fixed |
| **ClickHouse schema** | ✅ Present | `schemas/clickhouse/001_events.sql`, `002_incidents.sql` |
| **Neo4j schema** | ✅ Present | `schemas/neo4j/001_constraints.cypher`, `002_indexes.cypher` |
| **Redis** | ✅ Declared | Client implemented; enable with `REDIS_ENABLED=true` |
| **Ollama** | ✅ Declared | Used only as infrastructure placeholder; no RCA service |

---

## Storage Modes

| Mode | Env Var | Use Case |
|------|---------|----------|
| `memory` | `STORAGE_MODE=memory` (default) | Tests, local demos, no Docker required |
| `clickhouse` | `STORAGE_MODE=clickhouse` | Production persistence to ClickHouse + Neo4j |

---

## What Can You Do Right Now

### 1. Run the Platform Locally (In-Memory Demo)

```bash
# Terminal 1: Start backend
python3 -m uvicorn backend.api.main:app --reload --port 8000

# Terminal 2: Generate incidents
python3 demo_end_to_end.py

# Terminal 3: Start frontend
cd frontend && npm install && npm run dev
```

### 2. Run with Docker + Persistent Storage

```bash
# Copy example env and enable ClickHouse persistence
cp config/.env.example .env
# Edit .env: STORAGE_MODE=clickhouse

# Start the full stack
make up
```

### 3. Access the Platform

- **Frontend Dashboard:** http://localhost:3000
- **API Documentation:** http://localhost:8000/docs
- **Health Check:** http://localhost:8000/health
- **Events API:** http://localhost:8000/events
- **Devices API:** http://localhost:8000/devices

### 4. Run Tests

```bash
# Backend
pytest

# Frontend
cd frontend && npm run type-check && npm run build
```

---

## Architecture Diagram (Current State)

```
┌────────────────────────────────────────────────────────────────┐
│                     NAXIS PLATFORM v1.0                        │
│                   Operational Intelligence                     │
└────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Browser    │
│ localhost:3000│
└──────┬───────┘
       │
       │ HTTP (React Query)
       ▼
┌──────────────────────┐
│  Next.js Frontend    │
│  ┌────────────────┐  │
│  │ Incident List  │  │
│  │ Incident Detail│  │
│  │ Stats Panel    │  │
│  └────────────────┘  │
└──────┬───────────────┘
       │
       │ API Calls
       ▼
┌──────────────────────┐
│  FastAPI Backend     │  localhost:8000
│  ┌────────────────┐  │
│  │ GET /incidents │  │
│  │ GET /events    │  │
│  │ GET /devices   │  │
│  │ GET /health    │  │
│  └────────────────┘  │
└──────┬───────────────┘
       │
       │ Service Layer
       ▼
┌──────────────────────┐     ┌──────────────────────┐
│  IncidentService     │────▶│  ClickHouse          │
│  EventService        │     │  naxis.events        │
│  DeviceService       │     │  naxis.incidents     │
└──────┬───────────────┘     └──────────────────────┘
       │
       │ Correlation / Publish
       ▼
┌──────────────────────┐     ┌──────────────────────┐
│  Correlation Engine  │────▶│  Redis               │
│  Worker Loop         │     │  naxis:incidents     │
└──────┬───────────────┘     └──────────────────────┘
       │
       │ Device Topology
       ▼
┌──────────────────────┐
│  Neo4j               │
│  Device/Site Graph   │
└──────────────────────┘
```

---

## Known Limitations

### Current MVP

- **Collectors:** Mock data only (no real vendor APIs).
- **Correlation:** Single site-time-window rule.
- **Updates:** Frontend polls every 10s (no WebSocket/SSE yet).
- **Auth:** None (open API).
- **Scale:** Single instance, no clustering.
- **RCA:** `probable_cause` and `confidence_score` exist in schema but are never populated.

---

## Next Steps

### Milestone A — Foundation Fix ✅ Done
### Milestone B — Persistent Data Layer ✅ Done

### Milestone C — Real Worker Loop

- Implement vendor collectors (DNAC, Mist, Arista SD-WAN, Arista WLC) with mock fallback.
- Worker writes normalized events to ClickHouse.
- Worker triggers correlation and writes incidents to ClickHouse.

### Milestone D — Intelligence & UI Expansion

- Topology-aware correlation rules.
- MAC cross-platform correlation.
- Ollama-based RCA endpoint (`POST /incidents/{id}/analyze`).
- Device explorer and event timeline pages.
- Server-Sent Events (SSE) for live updates.

### Milestone E — Production Hardening

- Authentication (Keycloak / JWT).
- Prometheus + Grafana monitoring.
- CI/CD pipeline (GitHub Actions).
- Kubernetes manifests.
- Backup/restore runbooks.

---

## Summary

The Naxis platform has moved from an **in-memory MVP** to a **persistable architecture**. The persistence layer is implemented, tested, and ready to use with `STORAGE_MODE=clickhouse`. The next critical step is **real vendor collectors** so the platform processes live data instead of synthetic events.

**Status:** Working MVP with persistence layer complete; collectors and intelligence next.

---

*Last updated: 2026-06-20*  
*Platform version: 1.0.0*  
*Status: 🚧 Milestone B complete; Milestone C (real collectors) next*
