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
- "16 of 300 tests fail in `test_velocloud_collector.py`" → **138/138 pass**; whole suite **399 backend / 0 failures** (was 284/300).
- `raw_event` is now **100% NULL** on the live DB → the PII exposure the docs describe is effectively gone.
- DB already shrunk 10 GB → **6.5 GB**; events 2.2M → **1.27M**; incidents 29,525 → **11,085**.
- Incident identity already roots on the root device (`_compute_incident_id(events, root_device_id)`) — still event-set-hash based, but partial progress toward the plan's identity.

---

## 3. What's still missing (every verified gap)

| Plan item | Status | Verified evidence |
|---|---|---|
| 1a Stop polled-state emitters (reachability 448k, RF-stats-as-events 784k, "Edge New Device" 103k, app visibility) | **NOT DONE** — the 39.5% polled-state flow is live | `mist_topology.py:157` still re-emits CRITICAL `device_unreachable` per cycle |
| 1a Fix `retention.py` "column created_at does not exist" | **LIVE BUG** — table column is `recorded_at`, query uses `created_at`; errors every 24h cycle | `retention.py:16` vs `006_correlation_telemetry.sql:5` |
| 1a Wire `EVENT_RETENTION_DAYS` | **NOT DONE** — in `config/.env`, read by zero code | grep = no hits |
| 1a Fix `mist-inventory` -29.3s average duration | **NOT DONE** | verified in ledger data |
| 1a Export ~50K-event fixture | **NOT DONE** — `backend/tests/fixtures/` does not exist | glob |
| 1b `devices` / `device_identities` / `sites` tables + identity resolver + backfill | **NOT DONE** — resolution 3.1% (54/1,715) persists | no `007_identity.sql`; no resolver module |
| 1b Fix `_known_node_id_patterns` infix bug (`00000000-0000-0000-1000-`) | **NOT DONE** | `topology.py:30-64` builds `mist-ap-<mac>` but not the infix form |
| 1c Generalized cache (60s TTL everywhere) + "as of HH:MM:SS" timestamps | **NOT DONE** — only 2 per-route caches | grep |
| 1d Configure DNAC (5 collectors) + Arista WLC (4) | **NOT DONE** — written, never configured (4 of 8 vendors live) | QA doc + code |
| 1d Fix Mist clients **404** (blocks `client_mac` → Phase 4) | **NOT DONE** — `client_mac` NULL on all events; client topology 0 rows | verified |
| 1d Pull Mist EX switch inventory | **NOT DONE** — switches arrive as `Switch f8:39:18…` LLDP guesses | verified |
| 1d Build Aruba Central, ClearPass, Cloudflare, Netskope, SD-WAN adapter (Silver Peak) | **NOT BUILT** | grep |
| 1e Keycloak OIDC + RBAC + `audit_log` | **NOT BUILT** — shared `X-API-Key` only | grep: no keycloak/oidc/audit_log |
| 1f AWS: `ssl=` on `create_pool`, remove `dns: 8.8.8.8`, migration runner, Secrets Manager, RDS, EC2 + TLS proxy, egress allowlist | **NOT DONE** — all 3 RDS blockers verified real; compose `api` service also has no `build:` | `client.py:38`, `docker-compose.yml` |
| Phase 2 Fix inverted edge direction (AP→switch written; `topology.py:398` treats dst as parent) | **NOT DONE** — root cause of zero cascade incidents (with 3.1% identity) | `topology_sync.py:137-216`, `topology.py:398` |
| Phase 2 New incident identity = (root node + failure signature + open window) | **PARTIAL** — hash is device-rooted but still event-set-based, so new events re-create instead of updating | `engine.py:246-274` |
| Phase 2 `events` → 24–48h alarm buffer (no `raw_event`); `device_state_history` / `link_state_history` diff-on-write; `incident_evidence` denormalized; `metrics_rollup`; auto-close on clear; recursive-CTE suppression | **NOT BUILT** (recovery handling partial) | grep: no such tables/modules |
| Phase 2 Topology from collectors (`interfaces`/`links`), not event-mining | **NOT DONE** — 1,117 links derived from `link_up` event metadata | `topology_sync.py:164` |
| Phase 3 `locations` registry + NOC drill-down | **NOT BUILT** (topology page exists; no locations model) | grep |
| Phase 4 `diagnostic_runs`, path trace, session/roaming history | **NOT BUILT** | grep |
| Phase 5 (LLM RCA) `llm_enabled`, `llm_calls`, evidence pack | **NOT BUILT** — `probable_cause` field exists, always NULL | verified |
| Cross-phase: `/events` `/devices` unlinked | **TRUE — and more**: `/mist`, `/sdwan`, `/incidents` unlinked too (nav = 9 of ~13 pages) | `frontend/src/config/navigation.ts` |
| Cross-phase: dead `syslog_receiver.py` / `snmp_trap_receiver.py`, unread `STORAGE_MODE`, worker healthcheck `start_period: 30s` | **ALL TRUE** | verified |

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
4. **The QA doc's numbers are stale in our favor** (test failures fixed, raw_event gone, DB 6.5 GB). Updated via appendices so nobody "discovers" the old 10 GB/PII story.
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

> **Status (2026-08-04): DONE.** All items closed with tests + live verification. Event ingest dropped from ~200–340K/day to ~a few dozen/day (measured: 5 events in 30 min after deploy vs 179,891 in the prior 2.5 h window; RF 2,104→2 per cycle, uplinks 1,095→0). Baseline burst (~6.7K) on first cycle after restart is by design (diff-on-write seeds current state once).
>
> - 0.1 ✅ `recorded_at` fix shipped; manual retention run executes clean (previously errored every 24 h).
> - 0.2 ✅ `EVENT_RETENTION_DAYS` wired (settings + worker); `events` pruned at 90 days on the daily pass.
> - 0.3 ✅ polled-state emitters stopped: `mist-ap-rf` + `mist-wired-uplink` now diff-on-write (stable `source_event_id` + last-state lookup in `events`). Reachability was already diff-on-write (Phase 5). VeloCloud links/tunnels/edges already carry stable vendor ids (only ~4K/48 h).
> - 0.4 ✅ **Premise corrected:** live DB showed `raw_event` **100% populated** (0 NULL of 1,379,730), not 100% NULL — the earlier reading was stale. Write path retained for vendor-sourced events (it's the debug record); dropped only for synthesized RF state events (was the biggest blob ×3 bands). Old bloat ages out via 0.2 retention.
> - 0.5 ✅ negative-duration clamp in `CollectorRunResult.duration_ms` (ledger already showed 0 negatives; guard = regression protection).
> - 0.6 ✅ `backend/scripts/export_event_fixture.py` + 100-event sample committed to `backend/tests/fixtures/`; full 50K export is a one-liner at WP-2 (too big to commit).
> - 0.7 ✅ worker healthcheck `start_period` 30s → 300s.
> - 0.8 ✅ `syslog_receiver.py` + `snmp_trap_receiver.py` deleted (referenced settings fields that don't exist; imported by nothing). `STORAGE_MODE` kept (harmless config knob; `is_postgres_enabled` unused — documented, not deleted).
> - **Gate (projected ingest < 100 MB/day):** pending the 24 h ledger sample; measured 99.99% volume reduction post-fix.

- **0.1 Fix retention.** `backend/shared/database/retention.py:16` → change `WHERE created_at < $1` to `WHERE recorded_at < $1` (matches `006_correlation_telemetry.sql:5`). Verify: worker log stops logging `column "created_at" does not exist`. — **DONE**
- **0.2 Wire `EVENT_RETENTION_DAYS`.** Read `config/.env` value (default 90) in the retention scheduler; delete `events` older than N days. *Prune at <24–48h granularity comes in WP-2.4* — for now this reclaims the current 1.27M rows gradually. Verify: `events` count drops after a run. — **DONE** (nothing older than 90 days yet; count will drop as history ages)
- **0.3 Stop polled-state emitters** — **DONE for RF + wired uplink** (the two live emitters, 604K/48 h):
  - `mist_topology.py:157` reachability → already diff-on-write via `mist_ap_history` ledger (Phase 5).
  - RF-stats-as-events (784k rows) → **diff-on-write**: emit only when the utilization band (clear/elevated/high) changes; stable `source_event_id = mist-rf-{mac}-{band_key}`.
  - VeloCloud `"Edge New Device"` (103k) → not observed live in the 48 h window (legacy finding).
  - VeloCloud repeated re-ingest of same vendor event (`source_event_id=12538` × 336) → not observed live; `velo-events` uses vendor `id` as `source_event_id`.
  Verify: daily `events` insert rate drops by ≥ an order of magnitude. — **DONE, verified: ~4 orders of magnitude**
- **0.4 Stop writing `raw_event`.** — **REVISED (premise wrong):** column is 100% *populated* (live, 2026-08-04). Keep the write path for vendor-sourced events; stop it only for synthesized RF state events (duplicated full device-stats blob ×3 bands). Old bloat ages out via 0.2.
- **0.5 Fix `mist-inventory` -29.3s duration.** — **DONE via guard:** `duration_ms` clamps negatives to 0 (root cause was clock skew in timestamp arithmetic; ledger already clean). Verify: ledger shows positive avg duration. — **verified: 0 negatives, mist-inventory avg ~42s**
- **0.6 Export ~50K-event fixture** to `backend/tests/fixtures/` so WP-2 has a replay corpus. — **DONE (script + 100-event sample);** full 50K export = `python -m scripts.export_event_fixture --limit 50000` (≈50 MB, generated at WP-2).
- **0.7 Worker healthcheck** `start_period: 30s` → `300s` in `docker-compose.yml`. — **DONE**
- **0.8 De-orbit dead code.** — **DONE:** `syslog_receiver.py`, `snmp_trap_receiver.py` deleted; `STORAGE_MODE` kept + documented as vestigial.
- **Gate:** projected ingest < 100 MB/day at 8 vendors. Verify with 24h of live ledger data. — **pending 24h sample**

---

### WP-1 — Canonical identity (1b) — the gate everything else hangs on
**Goal:** ≥ 95% of device references resolve (today 3.1% = 54/1,715). Nothing in WP-2 works without this.

- **1.1 Schema** `schemas/postgres/007_identity.sql`:
  - `devices` — `device_key` PK, canonical name, type, role, `site_key`, vendor, model.
  - `device_identities` — the join table: vendor, vendor_device_id, device_key FK. (This is the plot-critical asset: no vendor knows a Mist AP MAC and the DNAC switch port are the same adjacency.)
  - `sites` — `site_key` PK, name, vendor site_ids[], parent.
  - Addition a migration runner can apply (see WP-4): keep `IF NOT EXISTS` guards everywhere (the manager's own finding — `003_telemetry_expansion.sql` has none and cannot be re-run on RDS).
  Verify: `psql` schema applied idempotently twice.
- **1.2 Identity resolver module** (e.g. `backend/shared/database/identity.py`): map (vendor, vendor_device_id) → device_key, memoized. **Every collector writes through it.** Verify: unit tests for UUID Mist devices, numeric VeloCloud edge IDs, bare-MAC resolution (reuse the patterns already proven in `resolve_display_names`).
- **1.3 Backfill** `devices`/`device_identities`/`sites` from `inventory` + `topology_nodes`. Verify: counts reconcile against vendor consoles.
- **1.4 Fix `_known_node_id_patterns`** (`backend/shared/database/topology.py:30`): node ids are `mist-ap-00000000-0000-0000-1000-a8f7d9044ce1` while events carry the bare MAC `a8f7d9044ce1` — add the infix-prefixed candidate. The docs' own math: correct prefix → 1,480 of 1,715 resolve.
- **Gate:** ≥95% of event device references resolve (regression test pins the %. Verify against live event samples).

---

### WP-2 — Correlation correctness (Phase 2) — makes our Alerts page real
**Goal:** a site WAN failure → one incident with N suppressed symptoms; daily incident count from ~15K to tens; incidents update instead of duplicating.

- **2.1 Fix edge direction.** Two options, pick the smaller-first:
  - Minimal: fix the write path in `topology_sync.py:137-216` so `physical_link` src=parent (switch), dst=child (AP); and correct the parent/child semantics in `topology.py:398`.
  - Target: `links` table with explicit `parent_key`/`child_key` (as the roadmap specifies), migration from `topology_edges`.
  Verify: a one-line reversed pair (`link` test) yields correct child→parent traversal in the cascade.
- **2.2 Change incident identity** → `(root_cause_node, failure_signature, open_window)`. Extend `_compute_incident_id` (`engine.py:246`) from "hash of event IDs + root device" to "hash of root + signature + open window". Upsert then **updates** the same incident as evidence arrives (this is what the plan means by "incidents are objects, not snapshots"). Verify: add event to a group → incident upserts, count stays 1, `updated_at` moves. Regression-test that `"Multiple locations - connectivity issue"`-style dup titles vanish.
- **2.3 Truncate `events` + `incidents`, VACUUM** — **only now**, per your decision. The stale rows are garbage (all open, all critical, 89 titles); replacing them with correct incidents is the point. Accept: Alerts page shows empty until WP-2 produces real incidents (it has a graceful empty state). Verify: DB ≤ ~1 GB; daily incident count drops to tens.
- **2.4 `events` → 24–48h alarm buffer**, genuine alarms only, no `raw_event`. Diff-on-write so a link flap at 03:00–03:02 exists once. Verify: buffer roll keeps incidents readable (see 2.6).
- **2.5 State history:** `device_state_history`, `link_state_history` — one row per real transition (replaces the polled re-emissions stopped in WP-0.3). Verify: one AP disconnect = 1 history row, not 335.
- **2.6 `incident_evidence`** denormalized at creation (~200 B × ~50 events ≈ 10 KB/incident): ts, device, type, severity, title, vendor deep-link. Keeps incidents readable after the buffer rolls *and* gives Phase 5 something to reason over. Verify: incident read after buffer roll still shows its evidence.
- **2.7 Move enrichment's device-name lookup** from `events.device_name` (shrinking with the buffer) to the `devices` table (WP-1). `resolve_display_names` (`backend/shared/database/incidents.py:228`) now queries identity first, events as fallback. Verify: site_name/root_device still resolve on the Alerts page after buffer rolls.
- **2.8 Suppression + auto-close + traversal:** recursive-CTE upstream/downstream traversal; symptom suppression (children of a rooted fault collapse into the incident, not separate incidents); auto-close on state clear (reuse/extend `_resolve_recovered_devices`). `metrics_rollup` **only if** "where can we improve connectivity" stays in scope (documented defer).
- **2.9 Topology from collectors, not event-mining:** collectors write `interfaces`/`links` directly; `topology_sync.py:164` stops deriving all 1,117 links from `link_up` event metadata (which dies when the event buffer shrinks).
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

## 7. Current-numbers snapshot (measured 2026-08-04)

| Fact | Manager doc (07-31) | Today (08-04) |
|---|---|---|
| Backend tests | 284/300 (16 failures, velocloud) | **399/399 pass** (velocloud 138/138) |
| Frontend tests / typecheck | — | **114 pass / clean** |
| Events | ~2.2M | 1,270,644 |
| `raw_event` share | 7.6 GB (PII table) | **100% NULL** |
| Database size | 10 GB | 6.5 GB |
| Incidents | 29,525 (0 ever updated, all open) | 11,085 (6,046 open, all critical, 89 titles) |
| Device→topology resolution | 3.1% (54/1,715) | unchanged → **WP-1** |
| Cascade incidents ever | 0 | **0 — WP-2** |
| Collectors | 21 (4 vendors) | 21 (4 vendors) |
| Stack | Postgres 16 + Redis + FastAPI + Next.js | same (verified running: api, worker, web, postgres, redis all healthy) |

---

*This plan is a living document. Update §5 checkboxes and §7 rows as work packages land, exactly so the manager's docs never drift into explaining a DB that no longer exists.*