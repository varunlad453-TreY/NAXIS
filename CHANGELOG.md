# Changelog

## [32] -- 2026-08-05 -- WP-2.2: Fix Incident Identity (Merge Evidence Across Cycles)
- **Incident identity redesigned:** changed incident ID generation from event-set hash to deterministic fault fingerprint `SHA-256(site_id | root_device_id | category)` so events describing the same fault map to the same incident ID.
- **SQL array union (`upsert_incident`):** `ON CONFLICT (incident_id) DO UPDATE` now uses `(SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(...) AS x WHERE x IS NOT NULL)` for `related_event_ids`, `affected_sites`, `affected_devices`, `affected_clients`, and `symptom_device_ids`, ensuring evidence accumulates across collection cycles instead of overwriting prior arrays.
- **Severity escalation only:** severity in `upsert_incident` uses a SQL `CASE` statement to only escalate (critical > major > minor > warning > info), preventing downgrades when lower-severity events arrive in subsequent cycles.
- **Timestamp & status preservation:** `created_at` is preserved on update (only `updated_at` advances); terminal statuses (`resolved`, `closed`, `suppressed`) are preserved and protected from overwrite.
- **Terminal status recurrence handling:** added `_compute_incident_id_with_recurrence()` which checks if an existing incident is in a terminal status via new `get_incident_status()` helper; if terminal, appends an epoch-hour suffix to spawn a new, fresh incident for the recurrence.
- **Engine async refactoring:** updated `create_incident()` and `_create_from_cascade()` to be `async` and await terminal status recurrence checks.
- **Tests & Verification:** added `TestIncidentIdentityMerge` test suite to `test_correlation_engine.py`. Full test suite: **432 backend tests passing (0 failures)**.

## [31] -- 2026-08-05 -- WP-2.1: Fix Inverted Edge Direction
- **Explicit `links` table schema (`009_links.sql`):** created `links` table with explicit `parent_node_id` and `child_node_id` columns, unique constraint on `(parent_node_id, child_node_id, link_type)`, and `updated_at` trigger.
- **Migrated physical link edges:** copied existing `physical_link` edges from `topology_edges` to `links` with corrected direction (`parent_node_id = dst_id`, `child_node_id = src_id`), establishing switch→AP parent-child hierarchy.
- **Cascade child translation fix:** fixed `DatabaseTopologyProvider.get_parent_child_map()` to translate raw child node_ids (e.g. `"mist-ap-abc123"`) via `node_id_to_device_id()` stripping prefixes to match canonical device_ids in event stream (e.g. `"abc123"`).
- **Write & Read Path Updates:** updated `topology_sync.py` and `snmp_poller.py` write paths to write physical links via `_upsert_link()`; updated topology API routes and recursive CTE traversal to read physical links from `links`.
- **Tests & Verification:** added 3 new topology tests (links write, no-uplink skip, child-translation fallback). Full test suite: **432 backend tests passing**.

## [30] -- 2026-08-05 -- WP-1: Canonical Identity Layer
- **Identity Schema (`008_identity.sql`):** created `sites`, `devices`, and `device_identities` join tables plus `topology_nodes.canonical_key` column for cross-vendor device resolution.
- **Identity Resolver (`backend/shared/database/identity.py`):** built `IdentityResolver` with in-memory caching and bulk resolution APIs (`resolve_devices`/`resolve_sites`) for fast single-query lookup.
- **Inventory & Collector Integration:** updated every event collector (Mist ×6, VeloCloud ×5, DNAC ×3, Arista WLC ×2, SNMP ×1) to resolve and emit `canonical_key`.
- **Live Inventory Backfill:** executed `scripts/backfill_identity.py` linking 153 sites, 4,102 device identities, and 2,051 topology nodes.
- **Topology Resolver Ladder:** updated topology node resolution to follow primary ladder: `canonical_key` → identity join → legacy prefix fallback. Fixed `health_snapshot.py` to use canonical keys from DB.
- **Tests & Verification:** added unit tests for identity resolver. Full test suite: **429 backend tests passing**.

## [29] -- 2026-08-05 -- WP-0 follow-up: close all deferred items
- **`raw_event` bloat stripped from DB:** one-off SQL cleared 1,124,128 synthesized RF/uplink `raw_event` blobs (5,207 MB → 877 MB); table `VACUUM FULL` shrunk events from 6.98 GB → 2.10 GB and DB from ~7.9 GB → 2.1 GB.
- **7-day `raw_event` debug window wired:** new `RAW_EVENT_DEBUG_DAYS` setting (default 7); daily retention pass strips blobs older than the debug window.
- **`INCIDENT_RETENTION_DAYS` wired:** new `settings.incident_retention_days` (env `INCIDENT_RETENTION_DAYS`, default 180); retention prunes only **resolved** incidents older than N days (open incidents are never touched).
- **`STORAGE_MODE` removed:** deleted `storage_mode` + `is_postgres_enabled` from `settings.py` and removed the env var from `.env` / `config/.env`; zero consumers existed and the DB connection is driven by `DATABASE_URL`.
- **50K fixture export generated:** `python -m scripts.export_event_fixture --limit 50000` produced ~45.7 MB corpus at `C:\Users\varun\AppData\Local\Temp\opencode\events_50k_fixture.json` for WP-2 replay work.
- **Mist-history flapping resolved:** investigation showed the ~11 transitions/min figure was pre-WP-0.3 data; post-deploy `device_unreachable` events are 0 and `mist_ap_history` shows 0 transitions in 48 h. Diff-on-write eliminated the per-poll re-emission.
- **WP-0 ingest gate closed:** steady-state ingest measured at ~1 MB/day events (excluding one-time deploy baseline bursts), far below the 100 MB/day gate.
- **Docs sweep:** corrected stale "`raw_event` 100% NULL" / "drop entirely" claims and outdated numbers in `PLAN_GAP.md`, `ROADMAP.md`, `TECHNICAL_QA.md`, `DATA_POLICY.md`; removed `STORAGE_MODE` references in `TELEMETRY_ARCHITECTURE.md` and `QUICKSTART_EVENTS_DEVICES.md`.
- **Tests:** retention tests updated for incidents + raw_event strip; full suite **418 backend passed / 0 failed**.
- **Worker redeployed** with the new retention settings.

## [28] -- 2026-08-04 -- WP-0: Storage Hygiene (write path)
- **Retention fix (0.1):** `correlation_telemetry` cleanup was pruned on `created_at` (column doesn't exist) — every 24 h pass errored. Now prunes on `recorded_at`. Verified a manual retention run executes clean.
- **`EVENT_RETENTION_DAYS` wired (0.2):** new `settings.event_retention_days` (env `EVENT_RETENTION_DAYS`, default 90); `events` pruned at 90 days on the daily pass alongside the 7-day telemetry cleanup. Nothing older than 90 days exists yet; count drops as history ages.
- **Polled-state emitters stopped (0.3):** `mist-ap-rf` + `mist-wired-uplink` previously emitted a fresh event per radio/link every poll (~604K events/48 h, with fresh UUID `source_event_id` so `ON CONFLICT (event_id)` could never dedupe). Both now diff-on-write: stable `source_event_id` (`mist-rf-{mac}-{band_key}`, `mist-uplink-{uplink_id}`), last state looked up once per cycle via new `events.latest_event_states()`, events emitted only on band/link-state change. RF baseline burst (~1 event per radio/band) re-seeds once after restart; uplink recovery `LINK_UP` re-emits correctly after a `LINK_DOWN` (event_type diff, not presence diff).
- **Measured live:** RF 2,104 → 2 events/cycle; uplinks 1,095 → 0; whole cycle persisted 3 events. Windowed count: 5 events in 30 min post-deploy vs 179,891 in the prior 2.5 h. First-cycle baseline burst 6,751 (by design).
- **raw_event (0.4, premise corrected):** live DB shows `raw_event` 100% populated (0 NULL of 1,379,730), not 100% NULL — write path retained for vendor-sourced events; dropped only for synthesized RF state events (biggest duplicated blob ×3 bands). Docs corrected (`PLAN_GAP.md`, `DATA_POLICY.md`).
- **Duration guard (0.5):** `CollectorRunResult.duration_ms` clamps negatives to 0 (clock-skew protection; ledger already had 0 negatives).
- **Fixture export (0.6):** new `backend/scripts/export_event_fixture.py` (core columns, no raw blobs) + 100-event sample committed to `backend/tests/fixtures/events_sample.json`; full 50K export is a one-liner when WP-2 needs a replay corpus.
- **Worker healthcheck (0.7):** `start_period` 30s → 300s in `docker-compose.yml`.
- **Dead code removed (0.8):** `backend/worker/receivers/{syslog_receiver,snmp_trap_receiver,__init__}.py` deleted (imported by nothing; referenced settings fields that don't exist). `STORAGE_MODE` kept + documented vestigial.
- **Tests:** +19 backend tests (`test_retention.py`, `test_event_dedup.py`, `test_collector_telemetry.py`). Full suite: **418 backend passed / 0 failed**.
- Docs: CHANGELOG [28], handoff 28, `PLAN_GAP.md` WP-0 → DONE, `DATA_POLICY.md` appendix corrected. Graphify update skipped (CLI unavailable in this environment; graph is gitignored).

## [27] -- 2026-08-04 -- Phase 5: Alerts Page UX
- Correlation Engine page rebuilt as "Alerts": title/empty-state renamed; engine telemetry demoted from a panel to a one-line footnote
- KPIs trimmed to Active outages / Sites affected / Devices affected / Avg confidence (truthful SQL aggregates from /incidents/stats)
- List grouped by root cause (root device + site header); rows show Outage/Degraded/Attention label, "ongoing for 2h 14m" duration (formatElapsed), device count, confidence, event count
- Backend: IncidentSummary + site_name/root_device, batch-resolved via new resolve_display_names() (inventory for sites + UUID devices, events latest device_name for numeric VeloCloud edge ids); wired into GET /incidents and /incidents/active -- migration-free
- Tests: 6 backend enrichment/detail tests + cross-cycle severity escalation test (103 engine tests); 9 new frontend tests (grouping + durations)
- Full suite: 399 backend passed / 0 failed; 114 frontend passed; type-check clean; live-verified on docker stack (site_name/root_device resolve to real names; stats truthful)

## [26] — 2026-08-04 — Dead Code Removal: Legacy ORM Worker Path
- Deleted the entire legacy mock-pipeline worker path, root to leaf:
  - `backend/run_worker.py` (legacy worker entrypoint — imported by nothing)
  - `backend/services/` — `device_service.py`, `event_service.py`, `incident_service.py` (SQLAlchemy ORM services with N+1 `get_stats()`; imported only by `run_worker.py`)
  - `backend/db/` — `base.py`, `models.py` (ORM layer; imported only by the deleted services)
  - `backend/worker/mock_ingest/runner.py` — `MockTelemetryPipeline` (imported only by `run_worker.py`)
  - `backend/worker/Dockerfile` — unbuilt anywhere (compose builds `backend/Dockerfile` for both api and worker); its CMD pointed at the deleted `run_worker.py`
- Import graph verified repo-wide before cutting: zero code/script/compose/test references outside the deleted cluster
- Live worker confirmed unaffected: compose runs `python -u -m worker.main` (overrides the image CMD); `backend/Dockerfile` copies `worker/` and `api/` only
- Docs updated (live docs only; historical handoffs 3/4/15 + TELEMETRY "What Was Before" left as records): README project tree, DEVELOPER_GUIDE entrypoints + direct-run command + walkthrough tree
- Full suite after removal: `392 backend passed / 0 failed`; graphify updated (3914 nodes / 7674 edges / 272 communities)

## [25] — 2026-08-03 — Phase 4: Truthful KPIs (API)
- New `GET /incidents/stats` — single-pass SQL aggregates: `total`, `active` (open/investigating/mitigated), `by_severity` (zero-filled), `distinct_sites`/`distinct_devices` (`COUNT(DISTINCT unnest(...))`), `avg_confidence`
- Replaced the service's N+1 `get_stats()` (one COUNT query per status) with the one aggregate query in `shared/database/incidents.py`; `ACTIVE_STATUS_VALUES` is now a single source of truth shared by the repo layer and service
- Correlation page (`/correlation`) KPIs now render from `/incidents/stats` + the list response's true `total` — previously every KPI was computed from `incidents.length` of a 500-row page, silently capping headline numbers at 500
- Added "Sites affected" / "Devices affected" KPI cells (distinct counts) and truthful "Showing X of Y" footer (`data.total`)
- 5 new API tests (`test_incident_stats_api.py`): aggregates, active-status SQL param, severity zero-fill, route-ordering (never swallowed by `/{incident_id}`), 500 on DB error
- Full suite: `389 passed / 0 failed`; `npm run type-check` clean
- **Follow-up (pending items L1–L3 cleared):**
  - Live-verified on the docker stack: API image rebuilt + restarted; `stats.total` == list `total` (11,025), `stats.active` == `?status=open` (5,986) against the live DB; web container built, `/correlation` renders the full KPI row; CORS OK
  - `GET /incidents` now accepts `status` filter (`List[IncidentStatus]`) — it was silently ignored before (service/repo already supported it); invalid values → 422; 3 new tests (`test_incidents_api.py`)
  - Deleted unused `stats-panel.tsx` (dead code summing `affected_*_count`)
  - KPI fallback extracted to pure `buildStats()` (`frontend/src/lib/incident-stats.ts`) + 5 vitest cases; frontend suite: `105 passed` (`npm test`)
  - Backfilled `docs/handoff docs/24_handoff.md` (session 24 was CHANGELOG-only, no handoff doc existed)
- Full suite after follow-up: `392 backend passed / 0 failed` + `105 frontend passed`

## [24] — 2026-08-03 — Close out pre-existing test failures + live-verify
- Fixed 10 failing tests previously written off as "pre-existing/env": they were stale tests, not environment issues:
  - VeloCloud `collect_all_*` tests asserted the pre-Phase-3 orchestrator (1 outcome, `velocloud-auth` id, "[edges, events, links, tunnels, apps]" order, all links/tunnels/apps "skipped"). Now assert the real fan-out: 5 outcomes in orchestration order, links/tunnels extract from the single pre-fetched edges payload, apps falls back/skips when no endpoint works. Removed the obsolete "sub-collectors always skipped" tests; added `TestVeloCloudAppsCollector` (success + skip paths). New `_mock_client_factory` helper for the direct-`httpx.AsyncClient(...)` binding path in `collect_all`.
  - Topology backbone tests supplied 11 db.fetch results but the endpoint performs 8; the inter-site edges query silently consumed an unrelated `[]`. Fixed both fixtures to the real call sequence (edges query is now the 8th fetch).
  - `test_pipeline_does_not_publish_when_redis_disabled` now pins `wm._settings.redis_enabled=False` (env enables Redis) and asserts `get_redis_client` is never called.
- Full suite: `384 passed` (up from 375 passed / 10 failed), 0 failures.
- Live-verify (H1): worker restarted on the dev stack; ran the correlation engine against the live DB and got the new-format incident title `"Verify LAB DC · Verify-Access-Point-01 unreachable — 2 devices affected"`. Also fixed a real ops bug found while verifying: the worker healthcheck used `ps` which does not exist in the image (worker was `unhealthy` for hours) → replaced with `grep -q worker.main /proc/1/cmdline`; worker is now `healthy`.

## [23] — 2026-08-03 — Phase 3: Human Incident Titles
- `generate_incident_title()` rewritten to read "{Real Site Name} · {Root Device Hostname} {plain-language issue} — {N} devices affected", e.g. "Pimpri Plant · AP32-02 unreachable — 5 devices affected" (was "Site SFO-01 - connectivity issues affecting N devices")
- Event types map to plain-language issue phrases ("unreachable", "link down", "degraded", …) with category-level fallbacks; real `site_name` (fallback `site_id`) and the root device's hostname replace raw codes/IDs
- Cascade incidents get the same human title: `generate_incident_title()` runs over root + symptom events, naming the root cause and counting the full blast radius (root + symptoms)
- Cascade detection is now structural: engine + worker count cascade/residual incidents and the frontend renders the "Cascade" badge from `symptom_device_ids` instead of parsing the "failure cascading to N" title string — removed the hand-built cascade titles, raw device-ID fallbacks, and brittle regex in both frontend files
- 12 title unit tests (8 new, 4 reworked) cover the exact spec phrase, plain-language labels, site-name fallback, single-device behavior, and device-less events

## [22] — 2026-08-02 — Correlation Noise Fix: Root-Cause Merge + Recovery Resolution
- Phase 1: mist AP reachability events only on ledger-backed state transitions — per-poll CRITICAL flood eliminated
- Phase 2: incident ID is now a root-cause key `SHA256(site_id | root device | issue category)`; recurring failures merge via `ON CONFLICT DO UPDATE` (incident count flat ~8,845 through link_down floods)
- Recovery resolution: `DEVICE_REACHABLE` events auto-resolve OPEN incidents whose root device recovered (only OPEN; operator states untouched); backfilled 7,909 legacy open incidents with `root_device_ids`
- Fixed `events.py` jsonb decode and `confidence_breakdown` serialization — 315 incidents now persist breakdown
- Phase 3 start: VeloCloud link/tunnel events now stamp per-edge site (titles become per-site instead of "Multiple locations")

## [21] — 2026-07-30 — Stage 2 Topology Cascade: Kill Heuristic Fallback, Wire Real Edges
- Fixed identifier mismatch: `get_parent_child_map()` now returns event device_ids (not node_ids) via reverse index — cascade previously never matched, silently fell back to heuristics on every production run
- Removed heuristic fallback: `topology_fallback_to_device_type` defaults to `False`; cascade with a provider returns topology results only (fails visible instead of substituting fake data)
- Fixed 11 silent `except Exception: pass` patterns across receivers, collectors, engine, and API routes — all now log warnings with `exc_info=True`
- Created `DatabaseTopologyProvider.get_all_descendants()` returns device_ids (not node_ids)
- Simplified `_known_node_id_patterns()` to try all known prefixes unconditionally (was missing `mist-ap-` for short AP device_ids)
- Cross-vendor logical links guarded: `_sync_cross_vendor_links()` only runs when Mist or VeloCloud is enabled
- 30 new tests in `test_topology_provider.py` (identifier translation, parent-child map, descendants); 14 existing tests updated
- 129 core tests pass (10 pre-existing failures unchanged)

## [20] — 2026-07-27 — Boil the Ocean Audit: Production Verification & Doc Correction
- Verified every doc claim against live DB: VeloCloud 5/5 live, topology 93 edges + 63 gateways + 200 WAN links, Mist 1,957 APs, 156K VeloCloud events
- Fixed HeroSection hardcoded "1 Vendors live" → dynamic from /topology/summary (shows 2)
- Fixed HeroSection hardcoded "61 Sites" → dynamic from DB (shows 153)
- Corrected Arista WLC from "✅ Live" → "⬜ Not configured" across all docs
- Corrected DNAC from "✅ Live" → "✅ Registered" across all docs
- Corrected Mist client-topology/radio-neighbors from "⚠️ 404" → "0 rows (not enabled)"
- Removed duplicate index ix_events_timestamp (ORM idx_events_timestamp DESC already covered)
- VACUUM completed on 19GB events table — query 10,000ms → 84ms
- Fixed ReactFlow border shorthand conflict in context-graph.tsx + aggregated-view.tsx

## [19] — 2026-07-27 — Notification System, Dashboard UX, DB Performance
- VeloCloud all 5 collectors live: links/tunnels switched from stubs to real API calls
- VeloCloudAppsCollector correctly mark_skipped (vco109 methodError on monitor/* endpoints)
- Cleaned 9 stale velocloud-auth rows from collector_run_ledger
- Created notifier.py: Slack webhook (rich blocks), SMTP email (HTML table), in-memory dedup (15-min window)
- Added 11 notification env vars to settings.py (enable flag, Slack URL, SMTP config, thresholds)
- Wired dispatch_alerts into worker cycle after collector health check
- Added time-range selector (1h/24h/7d/30d) to dashboard event count
- Pre-fetch all 4 ranges on mount for instant switching
- Keep previous event count during loading (placeholderData)
- Show `—` on initial blank slate instead of misleading `0`
- Verified existing ORM index on events.timestamp, removed duplicate index; VACUUM ANALYZE completed
- Increased postgres shm_size from 64MB to 256MB — query time 10,000ms → 84ms
- Fixed HeroSection hardcoded "1 Vendors live" → dynamic from topology summary (2)
- Fixed HeroSection hardcoded "61 Sites" → dynamic from DB (153)
- Full doc audit: corrected Arista WLC/DNAC status to "not configured", Mist client/radio to "0 rows" across all docs

## [18] — 2026-07-21 — Phase A–F Completion
- Fixed dashboard event count to last 24h (was lifetime total)
- Wired health_snapshot, SNMP poller into worker pipeline
- Added Docker healthcheck for worker service
- Optimized VeloCloud with persistent client (no re-auth per cycle)
- Created collector health monitoring module (failure/skip pattern alerts)
- Created data retention cleanup module (7d cutoff, 24h interval)
- Added SSE endpoint GET /correlation/incidents/stream (Redis pub/sub)
- Added correlation engine health bar to frontend
- Added site dropdown + jump-to-site in topology toolbar
- Added Export PNG button, keyboard shortcut cheat sheet, device count in search
- Added per-collector alert dismiss with localStorage persistence
- Added cascade relationship badge in incident detail
- Added auto fitView on site expand (scoped to site node)
- Added 404 page, loading indicator for topology re-layout
- Fixed Arista WLC timestamp parsing (was datetime.now() stub)
- Removed dead code getInitialResolvedTheme() from providers.tsx

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
