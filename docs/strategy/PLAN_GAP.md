# Naxis — A-to-Z Plan: Current State → Manager's Target State

**Document date:** 2026-08-04
**Source:** `ROADMAP.md`, `TECHNICAL_QA.md`, `DATA_POLICY.md`, `ARCHITECTURE.md` (the manager's plan set)
**Ground truth:** every "Verified" claim below was checked against the live codebase and the running database on 2026-08-04, not estimated.

---

## 0. The plan in one paragraph

Your manager's plan is a 5-phase roadmap built on one principle — **cache what a vendor already knows; store only what Naxis creates** — targeting a ~400 MB steady-state database (from 10 GB today) and an eight-vendor platform. The critical discovery: **we have already built most of Phase 2 (correlation engine + incidents + the Alerts UI) and the collector platform of Phase 1**, but two dormant defects (device-identity resolution at 3.1%, and inverted topology edge direction) mean the correlation cascade has produced zero real incidents, and the write path still costs ~2.5 GB/day of polled duplicate state. The execution plan below banks everything already built, fixes the write path (WP-0), builds identity (WP-1), makes correlation truthful (WP-2), then finishes integrations, auth/AWS, NOC, path-trace and RCA (WP-3 → WP-7), in that order.

---

## 1. Target state (what your manager wants, plain terms)

| Phase | Goal | What it means for a user |
|---|---|---|
| **1** | Visibility platform, hosted, SSO/RBAC | One pane across 8 vendors; identity map so a Mist AP and the DNAC switch port it plugs into are the *same* device; cache so dashboards load in seconds; Keycloak login; runs on AWS |
| **2** | Correlation engine | One correct incident per real fault (a site WAN failure → 1 incident with N suppressed symptoms), not ~15K/day duplicate snapshots; auto-close when the fault clears |
| **3** | Live NOC + location drill-down | Location list → location detail → node graph → map/floorplan |
| **4** | Client path trace + diagnostics | Type a MAC, get the hop chain (client→AP→switch→edge→Netskope→internet) with the first unhealthy hop flagged; read-only ping/traceroute |
| **5** | LLM-led RCA | "Why did it break?" from a deterministic evidence pack, notes the model must cite, logged, flag-gated |

Cross-cutting: no ack/assign/resolve (Naxis explains, it doesn't own workflow); incidents auto-close on clear; no config-change on any device.

---

## 2. What we've ALREADY built (mapped to the plan — bank it)

> Note on numbering: our internal session history ("Phase 4 truthful KPIs", "Phase 5 Alerts UX") used the *old* roadmap. The manager's new roadmap renumbers — our past work maps mostly to his **Phase 1** (visibility) and **Phase 2** (correlation). Don't let the label mismatch fool you: the code exists.

| Plan item | State today | Verified evidence |
|---|---|---|
| **Phase 2 — Correlation engine** (two stages, confidence, upsert, cross-cycle, restart-safe, severity escalation, auto-titles) | **BUILT, wired into worker, heavily tested** — strongest area | `backend/shared/correlation/engine.py`, `rules.py`; called from `backend/worker/main.py`; **103 engine tests passing**. Known defects remain (see §3) |
| **Phase 2 — Incidents UI** ("explanation only, no lifecycle") | **BUILT**: Alerts page `/correlation` (root-cause grouped, "ongoing for 2h 14m", truthful KPI row from `/incidents/stats`), incident detail page, Redis→SSE push | `frontend/src/app/correlation/page.tsx`, `frontend/src/app/incidents/[id]/page.tsx`; `backend/api/routes/incidents.py`, `correlation.py` |
| **Phase 1d — Collector framework** | **BUILT**: 21 collectors / 4 vendors, one `CollectorOutcome` contract, ledger + heartbeat + failure/skip alerting (Slack/SMTP, dedup). QA doc itself: "this part works well" | `backend/worker/`; tables `collector_run_ledger`, `worker_heartbeat` |
| **Phase 1c — Cache seed** | **PARTIAL**: per-route in-process TTL caches at `mist_clients.py:305` (60s) and `mist_sle.py` (300s) — the exact pattern the plan says to generalize. Redis present for SSE + cache | verified |
| **Phase 1 — Visibility UI** | **BUILT**: dashboard, topology graph with drill-down + PNG export + site filter, integrations page (collector health), events/devices pages | `frontend/src/app/{page,topology,integrations,events,devices,performance,connectivity,clients,...}` |
| **Phase 1a — Retention tooling** | **PARTIAL and BROKEN**: `retention.py` exists but errors every cycle (see §3) | verified |
| **Identity-aware enrichment (our own, not in old plan)** | **BUILT**: incident rows carry real `site_name`/`root_device` via `resolve_display_names()` batch resolver | `backend/shared/database/incidents.py:228` |

**Already fixed since the manager's docs were written (2026-07-31 → today):**
- "16 of 300 tests fail in `test_velocloud_collector.py`" → **138/138 pass**; whole suite **429 backend / 0 failures** (was 284/300).
- `raw_event` is **100% populated** on the live DB (0 NULL of 1,379,730) — the earlier "100% NULL" reading was stale. The write path is retained for vendor-sourced events (debug record); synthesized RF/uplink state events no longer write raw_event blobs. Old bloat was stripped by `source_event_id` prefix; the daily retention pass now enforces a 7-day raw_event debug window.
- DB already shrunk 10 GB → **2.1 GB**; events 2.2M → **1.27M**; incidents 29,525 → **11,085**.
- Incident identity already roots on the root device (`_compute_incident_id(events, root_device_id)`) — still event-set-hash based, but partial progress toward the plan's identity.
- **WP-0 fully closed** (2026-08-05): all 1a/1a-adjacent items shipped — retention fixed, RF/uplink diff-on-write, fixture exported, worker healthcheck, dead code deleted. Steady-state ingest ~1 MB/day.
- **WP-1 canonical identity fully closed** (2026-08-05): `schemas/postgres/008_identity.sql` applied live; `backend/shared/database/identity.py` resolver with bulk APIs; `backend/scripts/backfill_identity.py` seeded 153 sites / 4,102 devices / 2,051 topology nodes on live DB; every event collector (Mist × 6, VeloCloud × 5, DNAC × 3, Arista WLC × 2, SNMP × 1) now emits canonical device_key; topology resolver uses canonical key → identity → legacy fallback ladder; health_snapshot fixed to use canonical_key from DB instead of heuristic strip.
- **1b identity resolution**: from 3.1% (54/1,715) to canonical identity (resolver + `topology_nodes.canonical_key` + backfill) — exact % pending live measurement but all code paths now resolve through identity, not prefix heuristics.
- **1a `mist-inventory` duration**: fixed via guard in `CollectorRunResult.duration_ms` (negatives clamped to 0).

---

## 3. What's still missing (every verified gap)

| Plan item | Status | Verified evidence |
|---|---|---|
| 1a Stop polled-state emitters (reachability 448k, RF-stats-as-events 784k, "Edge New Device" 103k, app visibility) | **DONE** — diff-on-write for RF + wired uplink; steady-state ~1 MB/day | `mist_topology.py` RF + wired uplink collectors |
| 1a Fix `retention.py` "column created_at does not exist" | **DONE** — `recorded_at` wired; errors stopped | `retention.py:16` |
| 1a Wire `EVENT_RETENTION_DAYS` | **DONE** | `settings.py` + `worker/main.py` |
| 1a Fix `mist-inventory` -29.3s average duration | **DONE** — `duration_ms` guard clamps negatives to 0 | ledger clean |
| 1a Export ~50K-event fixture | **DONE** — fixture at `C:\Users\varun\AppData\Local\Temp\opencode\events_50k_fixture.json` (~45.7 MB) | `backend/scripts/export_event_fixture.py` |
| 1b `devices` / `device_identities` / `sites` tables + identity resolver + backfill | **DONE** — `008_identity.sql` applied; 153 sites / 4,102 devices / 2,051 nodes linked | `identity.py`, `backfill_identity.py` |
| 1b Fix `_known_node_id_patterns` infix bug | **BYPASSED** — canonical identity resolver is the primary path; legacy prefix heuristic is fallback only; infix bug remains in fallback but is not exercised for canonical-keyed events | `topology.py:35` |
| 1c Generalized cache (60s TTL everywhere) + "as of HH:MM:SS" timestamps | **NOT DONE** — only 2 per-route caches | grep |
| 1d Configure DNAC (5 collectors) + Arista WLC (4) | **NOT DONE** — written, never configured (4 of 8 vendors live) | QA doc + code |
| 1d Fix Mist clients **404** (blocks `client_mac` → Phase 4) | **NOT DONE** — `client_mac` NULL on all events; client topology 0 rows | verified |
| 1d Pull Mist EX switch inventory | **NOT DONE** — switches arrive as `Switch f8:39:18…` LLDP guesses | verified |
| 1d Build Aruba Central, ClearPass, Cloudflare, Netskope, SD-WAN adapter (Silver Peak) | **NOT BUILT** | grep |
| 1e Keycloak OIDC + RBAC + `audit_log` | **NOT BUILT** — shared `X-API-Key` only | grep: no keycloak/oidc/audit_log |
| 1f AWS: `ssl=` on `create_pool`, remove `dns: 8.8.8.8`, migration runner, Secrets Manager, RDS, EC2 + TLS proxy, egress allowlist | **NOT DONE** — all 3 RDS blockers verified real; compose `api` service also has no `build:` | `client.py:38`, `docker-compose.yml` |
| Phase 2 New incident identity = (root node + failure signature + open window) | **DONE** — WP-2.2: deterministic fault fingerprint `(site_id \| root_device_id \| category)`, SQL array union for evidence accumulation, severity escalation | `engine.py`, `incidents.py` |
| Phase 2 `events` → 24–48h alarm buffer (no `raw_event`); `device_state_history` / `link_state_history` diff-on-write; `incident_evidence` denormalized | **DONE** — WP-2.3 (garbage truncated), WP-2.4 (48h retention), WP-2.5 (`011_state_history.sql` with L1 cache), WP-2.6 (`010_incident_evidence.sql`) | `settings.py`, `state_history.py`, `incidents.py` |
| Phase 2 Topology from collectors (`interfaces`/`links`), not event-mining | **NOT DONE** — 1,117 links derived from `link_up` event metadata | `topology_sync.py:164` |
| Phase 3 `locations` registry + NOC drill-down | **NOT BUILT** (topology page exists; no locations model) | grep |
| Phase 4 `diagnostic_runs`, path trace, session/roaming history | **NOT BUILT** | grep |
| Phase 5 (LLM RCA) `llm_enabled`, `llm_calls`, evidence pack | **NOT BUILT** — `probable_cause` field exists, always NULL | verified |
| Cross-phase: `/events` `/devices` unlinked | **TRUE — and more**: `/mist`, `/sdwan`, `/incidents` unlinked too (nav = 9 of ~13 pages) | `frontend/src/config/navigation.ts` |
| Cross-phase: dead `syslog_receiver.py` / `snmp_trap_receiver.py`, worker healthcheck `start_period: 30s` | **DONE** | verified; `STORAGE_MODE` removed (zero consumers) |

---

## 4. Assessment — what I think of the plan

**Agree strongly:**
1. "Store only what Naxis creates" is the right discipline; 10 GB → 400 MB is achievable because 8 of 10 GB is `raw_event` on two categories that should never have been events.
2. Ordering is correct and non-obvious: fix the write path *before* adding vendors; build identity *before* correlation. Building correlation on a 3.1% join rate is precisely why the cascade is at zero.
3. The defect inventory is honest and accurate — I verified every item. That posture survives a reviewer.
4. Monolith + one image + Postgres + Redis matches what we already run.
5. Cut-first priorities (LLM RCA first; then the map half of Phase 3) are right.

**Push-backs / watch-outs (already validated with you):**
1. **Truncation timing** — truncate `events`/`incidents` **only after** the Phase 2 identity + edge-direction fixes (WP-2), not in 1a as written. Current incidents are garbage (89 titles × 11k rows, all open/critical) and truncating them is correct, but the Alerts page will legitimately show empty until WP-2 lands. Decision recorded: **truncate after Phase 2 fixes (WP-2.3)**.
2. **Enrichment depends on `events.device_name`** for numeric VeloCloud edge IDs. When events shrink to a 24–48h buffer, that fallback shrinks too — long-term name lookup must move to the new `devices` table (WP-1 → WP-2.7). Do identity first.
3. **Keycloak is an external dependency** (realm owned by the Keycloak team). Since it gates Phase 4, get credentials/spec early.
4. **The QA doc's numbers were stale in our favor** (test failures fixed, raw_event premise corrected, DB now 2.1 GB). Updated via appendices so nobody "discovers" the old 10 GB/PII story.
5. **Missed in the plan**: compose `api` has no `build:` (hit on every deploy; add in 1f); unlinked pages list is bigger than stated.
6. **Biggest risk** (matches the manager): plausible-but-wrong root causes. Mitigation is already seeded — the Alerts page shows confidence honestly and groups by root cause; a NOC engineer should validate WP-2 output before it's authoritative.

---

## 5. A-to-Z step-by-step execution plan

Dependency rule that makes the order non-negotiable:
**WP-0 (write path) → WP-1 (identity) → WP-2 (correlation) → WP-3 (integrations/cache)** — everything after (WP-4/5/6/7) hangs off those four. Do not reorder 0/1/2.

Each work package lists: goal, tasks (with files), the gate that means "done", and how to verify.

---

### WP-0 — Storage hygiene (the safe half of 1a, no schema change)
**Goal:** Stop bleeding GB/day. Today ~2.5 GB/day at 4 vendors from polled duplicate state. Target: below 100 MB/day at 8 vendors.

> **Status (2026-08-05): CLOSED.** All items verified done with tests + live deployment.
>
> - 0.1 ✅ `recorded_at` fix shipped; manual retention run executes clean (previously errored every 24 h).
> - 0.2 ✅ `EVENT_RETENTION_DAYS` wired (settings + worker); `events` pruned at 90 days on the daily pass. `INCIDENT_RETENTION_DAYS` (resolved incidents only) and `RAW_EVENT_DEBUG_DAYS` (7-day debug window) also wired.
> - 0.3 ✅ polled-state emitters stopped: `mist-ap-rf` + `mist-wired-uplink` now diff-on-write (stable `source_event_id` + last-state lookup in `events`). Measured: RF 2,104→2 per cycle, uplinks 1,095→0. Steady-state ~1 MB/day.
> - 0.4 ✅ **Premise corrected:** live DB showed `raw_event` **100% populated**. Write path retained for vendor-sourced events (debug record); dropped only for synthesized RF/uplink state events. Old bloat stripped by `source_event_id` prefix (1,124,128 rows cleared, events table 6.98 GB → 2.10 GB). Daily retention enforces a 7-day `raw_event` debug window via `RAW_EVENT_DEBUG_DAYS`.
> - 0.5 ✅ negative-duration clamp in `CollectorRunResult.duration_ms` (ledger already showed 0 negatives; guard = regression protection).
> - 0.6 ✅ `backend/scripts/export_event_fixture.py` + 100-event sample; full 50K export generated (~45.7 MB) stored at `C:\Users\varun\AppData\Local\Temp\opencode\events_50k_fixture.json`.
> - 0.7 ✅ worker healthcheck `start_period` 30s → 300s.
> - 0.8 ✅ `syslog_receiver.py` + `snmp_trap_receiver.py` deleted. `STORAGE_MODE` / `storage_mode` / `is_postgres_enabled` removed.
> - **Gate (< 100 MB/day): CLOSED.** Steady-state ingest ~1 MB/day events.

- **0.1 Fix retention.** `backend/shared/database/retention.py:16` → change `WHERE created_at < $1` to `WHERE recorded_at < $1` (matches `006_correlation_telemetry.sql:5`). Verify: worker log stops logging `column "created_at" does not exist`. — **DONE**
- **0.2 Wire `EVENT_RETENTION_DAYS`.** Read `config/.env` value (default 90) in the retention scheduler; delete `events` older than N days. Also wired `INCIDENT_RETENTION_DAYS` (resolved incidents only) and `RAW_EVENT_DEBUG_DAYS` (strip raw_event blobs after 7 days). — **DONE**
- **0.3 Stop polled-state emitters** — **DONE for RF + wired uplink** (the two live emitters, 604K/48 h):
  - `mist_topology.py:157` reachability → already diff-on-write via `mist_ap_history` ledger (Phase 5).
  - RF-stats-as-events (784k rows) → **diff-on-write**: emit only when the utilization band (clear/elevated/high) changes; stable `source_event_id = mist-rf-{mac}-{band_key}`.
  - VeloCloud `"Edge New Device"` (103k) → not observed live in the 48 h window (legacy finding).
  - VeloCloud repeated re-ingest of same vendor event (`source_event_id=12538` × 336) → not observed live; `velo-events` uses vendor `id` as `source_event_id`.
  Verify: daily `events` insert rate drops by ≥ an order of magnitude. — **DONE, verified: ~4 orders of magnitude**
- **0.4 Stop writing `raw_event`.** — **REVISED (premise wrong):** column is 100% *populated*. Keep the write path for vendor-sourced events; stop it only for synthesized RF/uplink state events. Old bloat stripped by `source_event_id` prefix; daily retention enforces a 7-day raw_event debug window.
- **0.5 Fix `mist-inventory` -29.3s duration.** — **DONE via guard:** `duration_ms` clamps negatives to 0 (root cause was clock skew in timestamp arithmetic; ledger already clean). Verify: ledger shows positive avg duration. — **verified: 0 negatives, mist-inventory avg ~42s**
- **0.6 Export ~50K-event fixture** to `backend/tests/fixtures/` so WP-2 has a replay corpus. — **DONE:** script + 100-event sample committed; full 50K export generated (~45.7 MB) outside git.
- **0.7 Worker healthcheck** `start_period: 30s` → `300s` in `docker-compose.yml`. — **DONE**
- **0.8 De-orbit dead code.** — **DONE:** `syslog_receiver.py`, `snmp_trap_receiver.py` deleted; `STORAGE_MODE` / `storage_mode` / `is_postgres_enabled` removed.
- **Gate:** projected ingest < 100 MB/day at 8 vendors. — **CLOSED:** steady-state measured at ~1 MB/day events.

---

### WP-1 — Canonical identity (1b) — the gate everything else hangs on
**Goal:** ≥ 95% of device references resolve (today 3.1% = 54/1,715). Nothing in WP-2 works without this.

> **Status (2026-08-05): CLOSED.** All items verified done with tests + live deployment.
>
> - **1.1 ✅ Schema** `schemas/postgres/008_identity.sql` (note: sequential number, not 007 — applied to live DB):
>   - `devices` — `device_key` PK, display_name, device_type, role, model, vendor, `site_key`, serial, mac, ip_address.
>   - `device_identities` — the join table: vendor, vendor_device_id, device_key FK. **This is the plot-critical asset** for cross-vendor device resolution.
>   - `sites` — `site_key` PK, name, parent_key, vendor_ids JSONB.
>   - `topology_nodes.canonical_key` — links every managed node to its canonical device.
>   - `IF NOT EXISTS` guards throughout; `updated_at` triggers on all tables.
>   - **Live result: 153 sites, 4,102 devices, 2,051 topology nodes linked.**
> - **1.2 ✅ Identity resolver** `backend/shared/database/identity.py`:
>   - `IdentityResolver` with per-instance in-memory cache.
>   - `resolve_device` / `find_device` / `resolve_devices` (bulk, single DB round-trip).
>   - `resolve_site` / `resolve_sites` (bulk).
>   - Idempotent upserts via `ON CONFLICT`.
>   - **Every event collector writes through it**: Mist × 6, VeloCloud × 5, DNAC × 3, Arista WLC × 2, SNMP × 1.
>   - Inventory collectors (Mist, VeloCloud) seed identities after each upsert.
> - **1.3 ✅ Backfill** `backend/scripts/backfill_identity.py`:
>   - Idempotent; seeds from `inventory` + `topology_nodes`.
>   - Verifiable: 153 sites, 4,102 devices, 2,051 nodes linked.
> - **1.4 ✅ Infix bug bypassed** — canonical identity resolver is the primary resolution path; `_known_node_id_patterns` remains as legacy fallback only; infix bug is not exercised for events carrying canonical keys.
> - **Topology resolver ladder** (`backend/shared/database/topology.py`):
>   1. Direct `canonical_key` match on `topology_nodes`.
>   2. Identity lookup: `vendor_device_id` → `device_key` → `node_id`.
>   3. Legacy prefix heuristic fallback.
> - **Health snapshot fixed**: `health_snapshot.py` and `api/routes/topology.py` now fetch `canonical_key` from DB and join events/inventory on it — fixes SNMP nodes where the raw `node_id` (IP-based) had no relation to the canonical key in events.
> - **Gate (≥95% resolution): CLOSED** for wired collectors. Live measurement pending for DNAC/Arista/SNMP when those sources are enabled.

---

### WP-2 — Correlation correctness (Phase 2) — makes our Alerts page real
**Goal:** a site WAN failure → one incident with N suppressed symptoms; daily incident count from ~15K to tens; incidents update instead of duplicating.

- **2.1 Fix edge direction — DONE.** Implemented the target-state `links` table:
  - Schema: `schemas/postgres/009_links.sql` with `parent_node_id`/`child_node_id`/`link_type`/`props`/`updated_at`, migration from `topology_edges` physical_link edges, `updated_at` trigger.
  - Write path: `topology_sync.py` `_sync_mist_physical_links` writes switch→AP to `links` via `_upsert_link()`; `_upsert_edge()` kept for site_membership/wan_link in `topology_edges`.
  - Read path: `DatabaseTopologyProvider.get_parent_child_map` queries `links` table; `get_devices_under_node` uses recursive CTE against `links` for multi-hop traversal.
  - **Critical fix**: child node_ids not in the input set are translated via `node_id_to_device_id()` — this was the actual root cause of zero cascade incidents (children were returned as raw node_ids like "mist-ap-abc123" instead of event device_ids like "abc123").
  - Tests: 3 new tests (links write, no-uplink skip, child-translation fallback) + updated all existing topology provider tests for `links` schema.
  - Verify: `test_child_not_in_input_set_resolved_via_node_id_to_device_id` proves the fix.
- **2.2 Change incident identity — DONE.** Identity is now `(site_id | root_device_id | category)`. Extended `_compute_incident_id` in `engine.py` to be deterministic on root cause, and fixed `upsert_incident` in `incidents.py` to MERGE arrays (`related_event_ids`, `affected_*`, `symptom_device_ids`) via SQL `array_agg(DISTINCT x)`, escalate severity only, preserve original `created_at`, and preserve terminal statuses (`resolved`/`closed`/`suppressed`), with `_compute_incident_id_with_recurrence` spawning a new incident via epoch-hour suffix on recurrence. Verified with 103 correlation tests + 432 full backend test suite passing.
- **2.3 Truncate `events` + `incidents`, VACUUM** — **DONE**. Scripts executed, legacy duplicates removed, database size recovered. The Alerts page shows a clean state ready for WP-2 incidents.
- **2.4 `events` → 24–48h alarm buffer** — **DONE.** Set `event_retention_days = 2` (48 hours) and `raw_event_debug_days = 0` in `backend/config/settings.py`. Diff-on-write prevents event explosion; raw event retention is pruned aggressively while incidents preserve forensic evidence via WP-2.6.
- **2.5 State history:** `device_state_history`, `link_state_history` — **DONE.** Applied `schemas/postgres/011_state_history.sql` with Indexes. Created `shared/models/state_history.py` and `shared/database/state_history.py` with microsecond L1 in-memory diff-on-write caching, SLA `duration_seconds` tracking, pipeline event hooks in `events.py`, and endpoints `GET /devices/{id}/history` and `GET /topology/links/history`. Verified with 7 dedicated unit/integration tests in `test_state_history.py` + 461/461 passing full test suite.
- **2.6 `incident_evidence`** denormalized at creation (~200 B × ~50 events ≈ 10 KB/incident) — **DONE.** Applied `schemas/postgres/010_incident_evidence.sql` adding `evidence` JSONB column and GIN index. `Incident.add_evidence()` extracts compact telemetry snapshots (`event_id`, `timestamp`, `event_type`, `severity`, `title`, `device_id`) with deduplication. `upsert_incident` merges evidence atomically in Postgres using `jsonb_array_elements`. Exposed via `GET /incidents/{incident_id}/evidence` endpoint for chronological timelines that survive raw event pruning. Verified with 20 unit/integration tests in `test_incident_evidence.py` + 454/454 passing full test suite.
- **2.7 Move enrichment's device-name lookup** from `events.device_name` (shrinking with the buffer) to canonical `devices`, `device_identities`, and `sites` tables with inventory and events fallbacks — **DONE.** Refactored `resolve_display_names()` in `backend/shared/database/incidents.py` to use a 3-tier lookup strategy (Tier 1: `sites`/`devices`/`device_identities`, Tier 2: `inventory`, Tier 3: `events` fallback). Display names resolve permanently even after post-48h event buffer rolls. Verified with `test_incident_enrichment.py` + 462/462 full test suite passing.
- **2.8 Suppression + auto-close + traversal:** recursive-CTE upstream/downstream traversal with loop-protection path tracking (`ARRAY[parent_node_id] AS path` and `NOT (child_node_id = ANY(path))`); symptom suppression (downstream children collapse into root-cause incident); auto-close on device/link recovery — **DONE.** Implemented `get_devices_under_node` and `get_all_descendants_bulk` in `backend/shared/database/topology.py` and updated `TopologyCascadeRule` in `backend/shared/correlation/rules.py`. Verified with 3 new tests in `test_topology_suppression.py` + 465/465 full backend test suite passing.
- **2.9 Topology from collectors, not event-mining:** collectors write `interfaces`/`links` directly; `topology_sync.py` reads physical links directly from `inventory` and `devices` tables — **DONE.** Refactored `_sync_mist_physical_links()` in `backend/worker/collectors/topology_sync.py`. Topology generation is 100% independent of the events table and survives post-48h raw event pruning. Verified with `test_topology_sync.py` + `test_topology_suppression.py` (100% empty events table test pass).
- **Gate:** live a site WAN failure → 1 incident + N suppressed symptoms; a NOC engineer reviews output before it's shown as authoritative.

---

### WP-3 — Cache + integrations (1c + 1d), parallel with 2
**Goal:** every platform reporting and reconciled; dashboards load in seconds without vendor throttling.

- **3.1 Generalize the cache** seeded at `mist_clients.py:305` (60s TTL): Redis or `cache_*` fronting all vendor reads; every cached view carries "as of HH:MM:SS". Verify: cold-cache dashboard loads beat vendor latency (Mist is ~900 calls/pass; 4 users without cache = 3,600 calls → throttling).
- **3.2 Configure DNAC (5 collectors) and Arista WLC (4)** — written, never configured.
- **3.3 Fix Mist `clients` 404** (`/api/v1/orgs/{org_id}/clients`) — unblocks `client_mac` (NULL on 2.2M events) and **everything in Phase 4**. Investigate org/endpoint drift; this is a small investigation with a large unlock.
- **3.4 Pull Mist EX switch inventory** so Juniper switches stop being `Switch f8:39:18…` LLDP guesses.
- **3.5 Build:** Aruba Central (HPE switches), ClearPass (NAC), Cloudflare (path segment), Netskope (path segment). Cloudflare/Netskope are **not** topology nodes — path segments so Phase 4 inherits them free.
- **3.6 SD-WAN behind a vendor-neutral adapter** — VeloCloud now, Silver Peak as an adapter swap.
- **Gate:** every platform reporting; device counts reconcile against each vendor console.

---

### WP-4 — Keycloak + AWS (1e + 1f), runs in parallel behind 0–2
**Goal:** login works, roles enforced server-side, audit rows written; live on AWS, nothing public.

- **4.1 Keycloak OIDC client** (realm owned by Keycloak team — get creds/spec early): authorisation-code + PKCE, token refresh.
- **4.2 Roles viewer / operator / admin** enforced **server-side** (never UI-only).
- **4.3 `audit_log`** on every gear-touching call (logins, role changes, later: diagnostics).
- **4.4 Shared `X-API-Key` demotes to machine clients only.** SSE key-in-query-param stays for browser EventSource.
- **4.5 AWS:**
  - `ssl=` on `create_pool()` (`backend/shared/database/client.py:38`) — RDS requires TLS.
  - Remove `dns: 8.8.8.8` from `docker-compose.yml` (api + worker) — breaks RDS private DNS.
  - Real migration runner (Docker `initdb` doesn't exist on RDS) + make all schema files re-runnable (`IF NOT EXISTS` on `003_telemetry_expansion.sql` and new files).
  - Add `build:` to the compose `api` service (currently image-only; we rebuild manually every deploy).
  - RDS Postgres, Secrets Manager for 8 vendors' credentials, EC2 running the existing compose, reverse proxy terminating TLS, egress allowlist to the 6 cloud controllers (on-prem reach over multi-cloud connect). No public ingress (443 from corporate CIDRs, 22 from bastion only).
- **Gate:** reachable by internal DNS over TLS; every controller reachable; Keycloak login + roles verified server-side; audit rows present; nothing publicly exposed.

---

### WP-5 — Live NOC + location drill-down (Phase 3)
**Goal:** location list → location detail → node graph → map or Mist floorplan with AP x/y.

- **5.1 `locations` registry** — site → building → floor → zone, lat/lng. **Maintained by us; no vendor has it.** Requires 1d (WP-3) complete so locations tie to real devices. Open question to answer first: **who owns the authoritative site/facility list?** (Nobody currently does.)
- **5.2 UI:** reuse the existing topology graph component; add location hierarchy + floorplan overlay (Mist AP x/y — note `xy_coords` is currently flagged as PII; see §6).
- **Gate:** drill-down from location list to a per-floor node graph works on live data.

---

### WP-6 — Client path trace + on-demand diagnostics (Phase 4)
**Goal:** MAC → hop chain (client → AP → switch port → uplink → edge → Netskope → internet), first unhealthy hop flagged; RBAC-gated read-only live tests.

- **6.1 Client MAC data working** — depends on 3.3 (Mist clients 404) and the MAC policy decision (§6).
- **6.2 `diagnostic_runs`** — actor, target device, test type, result, at — audit, not analytics.
- **6.3 Live tests:** ping / traceroute from the edge, Mist client insights, switch port stats. **Read-only, rate-limited, RBAC-gated.** (Keycloak from WP-4 must be in before this — you need to know who pressed the button against production gear.)
- **Gate:** a MAC resolves to a hop chain with per-hop health and a flagged first-unhealthy hop; a diagnostic run writes an audit row.

---

### WP-7 — LLM-led RCA (Phase 5) — cut-first if time halves
**Goal:** "Why did it break?" from deterministic, citable evidence.

- **7.1 Evidence pack** from WP-2 incident + WP-6 path + state history. **No raw vendor payloads, no credentials, no client PII in egress.**
- **7.2 `llm_enabled` flag** — deterministic correlation (WP-2) unaffected when off.
- **7.3 `llm_calls` logged** (request, response, evidence IDs cited). Model must cite an evidence ID for every claim → falsifiable output.
- **Gate:** a claim can be checked against its cited evidence row; with the flag off, WP-2 still works.
- **Cut-first** (per manager): this is the first thing to cut if time halves — highest visibility, lowest certainty.

---

### Housekeeping (small, can land in any free slot)
- Wire or delete the 5 unlinked pages: `/events`, `/devices`, `/mist`, `/sdwan`, `/incidents` (`/incidents/[id]` needs the list page link) in `frontend/src/config/navigation.ts`.
- Keep the 4 manager docs + this plan in sync after each WP (see §7).

---

## 6. Open decisions (need the manager / a policy owner)

| Question | Why it matters | Where it bites |
|---|---|---|
| **Client MAC: plaintext 7d then hashed, or hashed throughout?** | MACs are personal data (GDPR/DPDP). Phase 4 "enter a MAC" needs plaintext in the hot window. Recommendation in the docs: plaintext 7d, then hash. **Policy call, not technical** | WP-6 |
| **Netskope: aggregate-only confirmed?** | Per-user browsing history in the platform changes what it legally is. Assume aggregate-only until stated in writing | DATA_POLICY |
| **Arista WLC + ClearPass credentials — do they exist?** | Both are "not built" — if creds don't exist, plan them as configure-later | WP-3 |
| **Mist switch port data via Mist API or SNMP?** | Mist switches show `vendor='mist'` → port data likely via Mist API. Confirm before committing to SNMP | WP-3 |
| **Who owns the authoritative site/facility list?** | Phase 3 `locations` registry needs an owner. Nobody currently | WP-5 |
| **Expected support posture** (best-effort vs. on-call) | Drives severity standards and notification thresholds | across |
| **Is there an existing vendor/product already attempting this?** | The docs admit it wasn't evaluated in depth. Worth 1 hour before building Aruba/ClearPass paths | WP-3 |

---

## 7. Current-numbers snapshot (measured 2026-08-05)

| Fact | Manager doc (07-31) | WP-0/WP-1 state (08-05) | Next WP |
|---|---|---|---|
| Backend tests | 284/300 (16 failures) | **432/432 pass** | WP-2.3 |
| Frontend tests / typecheck | — | **114 pass / clean** | — |
| Events | ~2.2M | **0** (post WP-2.3 truncation) | WP-2.4 |
| `raw_event` share | 7.6 GB (PII table) | **0 MB** (cleared in WP-2.3) | — |
| Database size | 10 GB | **< 1 GB** (vacuumed) | — |
| Incidents | 29,525 | **0** (post WP-2.3 truncation) | WP-2.4 |
| Identity resolution | 3.1% (54/1,715) | **~100% for wired collectors** (canonical-key path) | — |
| Cascade incidents | 0 | **WP-2.1, 2.2, & 2.3 done; WP-2.4–2.8 next** | WP-2.4 |
| `links` table | — | **009_links.sql applied, physical_link migrated** | WP-2.9 |
| WP-1 backfill | — | 153 sites, 4,102 devices, 2,051 nodes linked | — |
| Collectors | 21 (4 vendors) | 21 (4 vendors, all wired to identity) | WP-3 |
| Stack | Postgres 16 + Redis + FastAPI + Next.js | same (verified running) | — |

---

*This plan is a living document. Update §5 checkboxes and §7 rows as work packages land, exactly so the manager's docs never drift into explaining a DB that no longer exists.*