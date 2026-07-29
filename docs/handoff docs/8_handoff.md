# 8 Handoff — Current State

## Last Session (Jul 7, 2026)
Completed P1/P2/P3 for topology visualization:
- **P1 Health Overlay**: Backend `_enrich_health()` derives per-node health (critical/warning/healthy/unknown) from events, inventory reachability, and node props. Frontend renders green/yellow/red/gray dot with ping animation.
- **P2 Blast Radius Highlighting**: `GET /topology/blast-radius/{incident_id}` returns subgraph with `root_cause_node_ids` and `symptom_node_ids`. Frontend highlights with pulsating glow (root cause) or steady glow (symptom) via `?highlight=` URL param.
- **P3 Incident→Topology Linking**: Incident detail page has "View in Topology" button → `/topology?highlight=id1,id2`.

## Test Status
- **Backend**: 99 tests pass (21 topology + 78 correlation)
- **Frontend**: 35 tests pass, TypeScript zero errors

## Key Files Changed Last Session
| File | What |
|------|------|
| `backend/api/models/topology_models.py` | Added `health_status`/`health_label` fields, `BlastRadiusResponse` model |
| `backend/api/models/incident_models.py` | Added `topology_node_ids` field |
| `backend/api/routes/topology.py` | `_enrich_health()`, `GET /blast-radius/{id}`, `_INFRASTRUCTURE_TYPES` set |
| `backend/api/routes/incidents.py` | `_resolve_affected_device_ids()`, injects `topology_node_ids` |
| `backend/tests/test_topology_api.py` | 21 tests covering health and blast radius |
| `frontend/src/types/topology.ts` | `HEALTH_STATUS_META`, `BlastRadiusResponse`, `HealthStatus` type |
| `frontend/src/types/incident.ts` | `topology_node_ids` in `IncidentDetail` |
| `frontend/src/lib/api.ts` | `getBlastRadius()` method |
| `frontend/src/components/topology/layout.ts` | `highlightSet` support in `buildLayout()` |
| `frontend/src/components/topology/topology-graph.tsx` | Health dot + glow/pulse animations |
| `frontend/src/app/topology/page.tsx` | `?highlight=` URL param + auto-refresh disable |
| `frontend/src/app/incidents/[id]/page.tsx` | "View in Topology" button in Blast Radius sidebar |
| `frontend/src/components/topology/layout.test.ts` | 4 new highlight tests |
| `frontend/src/types/topology.test.ts` | 8 HEALTH_STATUS_META tests |
| `docs/TOPOLOGY_VISUALIZATION.md` | Updated with P1/P2/P3 docs |
| `docs/HANDOFF.md` | Session handoff (human-readable) |
| `docs/AI_HANDOFF.md` | This file |

## Platform Architecture (for AI context)

### Backend (FastAPI, port 8000)
- **Entry**: `backend/api/main.py` — sets up FastAPI app, CORS, API key auth, lifespan (connects/disconnects DB)
- **DB**: asyncpg pool at `shared/database/client.py` — singleton `db` object
- **Routes** (all registered in `main.py`):
  - `/incidents` — list, get detail (includes `topology_node_ids` for blast radius linking)
  - `/events` — list with filters (source, severity, site, device, time range)
  - `/devices` — list inventory devices (VeloCloud, Mist, etc.)
  - `/topology` — full graph, summary, node detail, blast-radius subgraph
  - `/mist/*` — Mist AP history, client timeline, SLE anomaly ranking
  - `/sdwan/chat` — SD-WAN intelligence chat (rule-based, no LLM)
  - `/integrations` — integration CRUD, test, sync
  - `/telemetry` — collector health telemetry
  - `/health` — simple health check

### Shared Modules (`backend/shared/`)
- `database/` — client.py (asyncpg pool), events.py (CRUD), incidents.py (CRUD), topology.py (node resolution + graph traversal), collector_telemetry.py, redis.py
- `models/` — event.py (UnifiedEvent schema), incident.py (Incident model with blast radius), event_factory.py, collector_outcome.py
- `correlation/` — engine.py (CorrelationEngine with Stage 1 site+time grouping + Stage 2 topology cascade), rules.py (SiteTimeWindowRule, TopologyCascadeRule)

### Correlation Flow
1. Collectors ingest telemetry → normalized `UnifiedEvent` objects
2. `CorrelationEngine.process_events()`:
   - **Stage 1**: `group_events_by_site_and_time()` — groups by site_id + 5-min window
   - **Stage 2**: `TopologyCascadeRule.evaluate()` — separates infrastructure vs leaf devices, queries topology provider for parent-child edges, creates `CascadeGroup` (root cause + symptoms)
   - Creates `Incident` per cascade group with blast radius (`affected_devices`, `affected_sites`, `affected_clients`)
   - Calculates confidence score from event count, severity distribution, device diversity
3. Incidents stored in PostgreSQL → served by `/incidents` routes

### Topology Health Flow
1. `GET /topology` calls `_enrich_health()` on each node
2. Health derivation order:
   - Recent CRITICAL event (events table, last 15 min) → **critical**
   - Node props `reachability=unreachable` or `connected=false` → **critical**
   - Inventory `reachability=unreachable` → **critical**
   - Recent MAJOR event → **warning**
   - Inventory `reachability=reachable` → **healthy**
   - Fallback → **unknown**

### Blast Radius Flow
1. Frontend calls `GET /incidents/{id}` → gets `topology_node_ids`
2. User clicks "View in Topology" → navigates to `/topology?highlight=id1,id2`
3. Or frontend calls `GET /topology/blast-radius/{incident_id}` directly
4. Backend resolves `affected_devices` to node IDs via `resolve_node_id()` (checks exact match, `mist-ap-` prefix for MACs, `velo-edge-` prefix)
5. Fetches subgraph nodes + edges + neighbor nodes for context
6. Classifies: infrastructure types (switch/router/wan_edge/etc.) that have children in the set → `root_cause_node_ids`, rest → `symptom_node_ids`

### Frontend (Next.js 15, port 3000)
- **Pages**: `/` (homepage), `/incidents`, `/incidents/[id]`, `/events`, `/devices`, `/topology`, `/mist`, `/sdwan`, `/integrations`, `/correlation`, `/performance`, `/connectivity`, `/clients`, `/settings`, `/help`
- **Key deps**: ReactFlow (topology graph), @tanstack/react-query (polling), Tailwind CSS
- **API client**: `frontend/src/lib/api.ts` — all methods, camelCase key conversion, API key auth

### Database (PostgreSQL)
- `topology_nodes` — network graph nodes (node_id, node_type, name, ip, vendor, model, site_id, props)
- `topology_edges` — parent-child relationships (src_id=child, dst_id=parent, edge_type)
- `events` — normalized unified events (all fields from UnifiedEvent model)
- `incidents` — correlated incidents with blast radius lists
- `inventory` — device inventory (platform, reachability, site, props JSONB)
- `collector_run_ledger` — collector telemetry
- `worker_heartbeat` — background worker health
- `mist_ap_history` — Mist AP lifecycle events

## What's Left / Next Steps
- **Placeholder pages**: Performance, Connectivity, Clients, Settings, Help pages are still stubs
- **Incident auto-navigation**: Could auto-redirect to topology on blast radius compute
- **Blast radius on topology page**: Side panel or overlay when viewing highlighted topology
- **Health history timeline**: Trend of health status over time
- **Performance**: Pagination/lazy loading for large topologies (1000+ nodes)

## Commands
```bash
# Backend tests
cd backend && python -m pytest tests/ -v --tb=short

# Frontend tests + type-check
cd frontend && npm run type-check && npx vitest run --reporter verbose

# Run backend
cd backend && uvicorn api.main:app --reload --port 8000

# Run frontend
cd frontend && npm run dev

# Update graphify knowledge graph after code changes
graphify update .
```
