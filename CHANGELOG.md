# Changelog

## [17] — 2026-07-21 — Dashboard Collector Health Widget
- Added `CollectorHealthWidget` to main dashboard (polls `GET /telemetry`, shows summary stats + inline alerts)
- Added `api.getTelemetry()` and `TelemetryResponse` types
- Fixed `TelemetryAlertType` to match runtime camelCase (`"staleData"` | `"repeatedFailure"` | `"dataGap"`)
- Updated `FRONTEND_ARCHITECTURE.md` and `TELEMETRY_ARCHITECTURE.md`

## [16] — 2026-07-20 — VeloCloud E2E Verification
- Fixed props data gap in `VelocloudInventoryCollector` (WAN links now stored in `inventory.props`)
- 151 new tests: 136 collector + 13 topology sync + 2 pipeline
- Marked `velocloud_metrics.py` as deprecated (ponytail)
- Total test suite: 300 backend tests

## [15] — 2026-07-17 — Correlation Engine Hardening & Wiring
- **Phase 1 (8 fixes)**: Pipeline order (topology sync before correlation), batch DB queries, memory-safe dedup tracker (OrderedDict 200k cap + 24h TTL), cross-cycle correlation, restart resilience (DB-persisted processed IDs, deterministic SHA-256 IDs), prefix expansion for `resolve_node_id()`, schema alignment, null preservation
- **Phase 2**: 7 end-to-end pipeline integration tests
- **Phase 3**: Engine telemetry (duration, event/incident counts per cycle), structured logging, `GET /correlation/stats` endpoint
- **Phase 4**: Redis pub/sub (`warm_up()`, graceful degradation), `correlation_telemetry` table
- 149 backend tests pass

## [14] — 2026-07-15 — Three-Mode Topology UX/UI Improvements
- Redesigned `TypeClusterNode` (270px wide, proportional health bar, clickable health badges)
- Health summary toolbar + global search in `AggregatedView`
- Pre-filtering by health status in `DeviceBrowser` (color-coded filter pills, per-row health bar)
- No backend changes

## [13] — 2026-07-15 — Three-Mode Topology Architecture (+ Bug Fixes)
- Fixed "Failed to load sites" 500 error (removed SQL health column reference, Python-based health computation)
- Fixed missing `site_membership` edges in site internal view
- Auto-fit view on initial load, flat layout for single-site internal view
- Fixed dark theme hydration mismatch (mounted guard in `theme-toggle.tsx`)
- URL-synced drill-down (`?site_id=X`), breadcrumbs, `SiteHealthSummary`, filter chips
- Aggregated site health in `SiteCard` (derived from child device counts, not node health)
- **Three-mode system** for large sites (≥50 devices): Aggregated View → Device Browser → Context Graph
- Client-side caching (React Query, 5min gcTime for recently viewed sites)
- 134 total tests

## [12] — 2026-07-15 — Drill-Down Topology Architecture
- Backend: `GET /topology/backbone` (site nodes + inter-site edges only), `GET /topology/sites/{site_id}/internal`
- Frontend: `SiteBrowser` card grid (searchable, vendor-filterable) replacing full ReactFlow graph
- SiteCard with vendor icon, device count, health dot
- Deep-link support: `/topology?site_id=X`
- Fixed Web Worker (now actually creates Worker, not setTimeout fallback)
- Fixed backend edge filtering (WHERE src_id = ANY(...) OR dst_id = ANY(...))
- Theme toggle always visible in collapsed sidebar
- 80 tests

## [11] — 2026-07-14 — Web Worker for Dagre Layout
- Created `layout.worker.ts` — runs `buildGroupedLayout()` off main thread
- Created `useTopologyLayout()` hook — Worker lifecycle, requestId-based stale message filtering, sync fallback
- Removed `<MiniMap>` (paint overhead)
- Loading spinner during initial computation
- 60 tests

## [10] — 2026-07-11 — Topology Page UI/UX Fixes
- Split parents section in node detail panel (Site / Connected Switch / Other Parents)
- Health dot ping animation fixed (static dot with subtle opacity ping)
- Edge aggregation badges on collapsed site groups (cross-site count)
- Search/zoom-to-node (client-side, auto-expand site, fitView)
- Type filter toggles (AP / Switch / Site)
- Collapse-all/Expand-all buttons
- SNMP polling infrastructure in settings (SNMP_TARGETS, community, etc.)
- 75 tests

## [9] — 2026-07-08 — Topology Performance & Data Pipeline Fixes
- **Blast Radius Side Panel** — incident impact subgraph with root-cause/symptom coloring
- **Health History Timeline** — `node_health_snapshots` table + `HealthSnapshotCollector` + `health-history-chart.tsx`
- **Performance fix**: ReactFlow parent-child grouping with collapsible site containers (60 groups instead of 2500 nodes)
- Fixed missing `await` on `process_events()` (critical bug causing empty topology)
- Fixed Mist Wired Uplink 404 → LLDP fallback (1090 links collected per cycle)
- Fixed `\u0000` null byte in PostgreSQL inserts (`_strip_null()` in model layer)
- Fixed foreign key violation (MAC→UUID node ID mapping in topology sync)

## [8] — 2026-07-06 — Platform Architecture State
- Consolidated platform documentation
- All 21 collectors across 4 vendors (Mist, DNAC, VeloCloud, Arista WLC)
- Correlation Stage 1 + Stage 2 complete
- Topology visualization (ReactFlow) complete

## [7] — 2026-07-06 — Topology P1/P2/P3
- **P1 Health Overlay**: `_enrich_health()` derives per-node health from events/inventory/props
- **P2 Blast Radius Highlighting**: `GET /topology/blast-radius/{incident_id}`, pulsating glow for root cause, steady glow for symptoms
- **P3 Incident→Topology Linking**: "View in Topology" button on incident detail page
- 99 backend tests, 35 frontend tests

## [6] — 2026-07-07 — Topology Visualization
- Backend: `GET /topology`, `GET /topology/summary`, `GET /topology/nodes/{node_id}`
- Frontend: ReactFlow + dagre hierarchical layout, color-coded nodes, minimap, loading/error/empty states
- 9 backend tests, 23 frontend tests
- Fixed missing `api_key` field in Settings (broke auth middleware)

## [5] — 2026-07-07 — Correlation Engine Stage 2 (Topology Cascade)
- `TopologyProvider` Protocol (pluggable topology backend)
- `TopologyCascadeRule` — topology-aware mode + device-type heuristic fallback
- Per-site merging (conservative when no topology DB), per-device grouping (all events on same device = same cascade)
- Residual incident handling (no silent drops)
- 78 tests

## [4] — 2026-07-05 — GitHub Merge & Collector Linking
- Pulled latest frontend from GitHub (Mist/SD-WAN pages)
- Merged backend routes (added mist + sdwan routers to `backend/main.py`)
- Added missing integration API functions to `api.ts` + `camelizeKeys` helper
- Made collectors clickable (Mist → `/mist`, VeloCloud → `/sdwan`, events → `/events?source=...`)
- 8 frontend pages serving

## [3] — 2026-07-05 — Docker Environment Fix
- Fixed missing PostgreSQL env vars in `config/.env` (POSTGRES_HOST, PORT, USER, PASSWORD, DATABASE)
- Initiated clean Docker rebuild
- Documented all 21 collectors across 4 vendors

## [2] — 2026-07-05 — Phase 10 Staleness Alerts & snake_case→camelCase Migration
- Implemented Phase 10 Staleness Alerts UI (`AlertBanner`, `AlertBannerGroup`)
- Discovered and fixed systemic snake_case→camelCase mismatch
- Added `camelizeKeys()` recursive transformer to `api.ts`
- Fixed multiple runtime errors (eventsCollected undefined, op.icon undefined)
- Attempted React hydration error fix (partial)

## [1] — 2026-07-05 — Multi-Vendor Collector Expansion
- Verified Phase 8 (Mist Topology — 5 collectors)
- Implemented Phase 9 (VeloCloud SD-WAN — 5 collectors + Arista WLC — 4 collectors)
- Full end-to-end Docker stack verification
- 21 collectors across 4 vendors registered
