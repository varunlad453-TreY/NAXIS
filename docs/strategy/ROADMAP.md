> **Appendix (2026-08-18) — gate status, measured.**
>
> | Gate | Claimed | Measured 2026-08-18 |
> |---|---|---|
> | 1b identity ≥95% of device refs resolve | CLOSED | **~99.8%** (1,069/1,071) — but only after fixing MAC reconciliation; it was effectively **0%** for current events, since Mist events carry a third id form registered nowhere |
> | 1a ingest <100 MB/day | CLOSED | Retention had never once completed; DB was back to **28 GB** / 4.58M events. Now 1.87 GB / 311k |
> | Phase 2 "one incident with N suppressed symptoms" | PASSED | **Not met in production.** Mechanism verified on real data (a real switch with 2 real sibling APs yields 1 incident, `inferred_root=true`, 2 symptoms), but live cascade count is still 0 — see below |
> | 1f AWS | DONE | Superseded by Azure; 2 of 3 blockers fixed, `dns:` still hardcoded |
> | Test suite | 432/432 | **540 passing, 2 failing** (`test_rca_engine::test_generate_rca_enforces_citations`, `test_topology_api::test_not_found_returns_empty`) — both pre-existing |
>
> **Why the Phase 2 gate is still open.** Three defects were fixed in sequence, each
> hidden behind the last: (1) site nodes wrote a `site_key` into `topology_nodes.canonical_key`,
> which is FK'd to `devices`, so the whole graph rebuild aborted every pass; (2) the
> physical-link query read `inventory.attributes` and `inventory.raw_data`, neither of
> which exists, and the failure was swallowed at DEBUG — no switch→AP link had **ever**
> been built from that path, now 1,109 are; (3) the cascade requires the root device to
> emit its own event, but 962 of 1,109 links have an LLDP-only switch parent with no
> telemetry at all, so it could never fire — an inferred-common-parent mode now roots an
> incident at the shared parent and flags `inferred_root`.
>
> What remains is data, not code: eligible (`major`+) events currently arrive spread
> across a **24-hour vendor-time window**, so only one same-site pair on different
> devices falls inside a single 300 s correlation window. The cascade will fire on a
> genuine simultaneous multi-AP outage. Note also that Mist's "Device Down" mapped to
> `warning`, below the `MAJOR` correlation threshold — the single most important signal
> in the estate never reached Stage 1 at all until it was raised to `MAJOR`.
>
> ---
>
> **Appendix (2026-08-05) — current-state bridge.** Full gap map + step-by-step execution plan: see `PLAN_GAP.md`.
>
> **Verified today (2026-08-05):**
> - **WP-2.1 edge direction CLOSED** & **WP-2.2 incident identity CLOSED**: explicit `links` table with `parent_node_id`/`child_node_id` (schemas/postgres/009_links.sql), migration from `topology_edges`, `topology_sync.py` writes switch→AP to `links`, `DatabaseTopologyProvider` queries `links` for cascade; incident identity fixed (deterministic fault fingerprint `(site|root_device|category)`, SQL array union for evidence accumulation, severity escalation, terminal recurrence handling). **The engine now merges evidence across cycles into living incident objects.**
> - Majority of **Phase 2 is already built**: correlation engine (`backend/shared/correlation/engine.py`, `rules.py`, 105 tests green), incidents + `/incidents/stats`, and the Alerts UI at `/correlation`.
> - **WP-0 write-path items CLOSED**: polled-state emitters stopped (RF + wired uplink diff-on-write, ~1 MB/day), `retention.py` fixed (`recorded_at`), `EVENT_RETENTION_DAYS` / `INCIDENT_RETENTION_DAYS` / `RAW_EVENT_DEBUG_DAYS` wired, test fixture + 50K export, `mist-inventory` duration guard, worker healthcheck 300s, dead code deleted.
> - **WP-1 canonical identity CLOSED**: `schemas/postgres/008_identity.sql` applied live (153 sites / 4,102 devices / 2,051 topology nodes linked); `backend/shared/database/identity.py` resolver with bulk APIs; `backend/scripts/backfill_identity.py` backfill; all event collectors wired (Mist × 6, VeloCloud × 5, DNAC × 3, Arista WLC × 2, SNMP × 1); health_snapshot fixed to use `canonical_key` from DB.
> - 1e/1f, Phase 3/4/5: not built (no Keycloak/audit_log, no AWS, no locations/path-trace/LLM RCA).
> - Test/image state: **432/432 backend, 114 frontend, type-check clean**; `raw_event` 877 MB (7-day debug window); DB **2.1 GB**, events ~1.27M, incidents 11,085.
> - **Decision (team):** `events`/`incidents` truncation deferred until after WP-2 identity/edge fixes (WP-2.3).

---

# NAXIS.ai — Roadmap

Phase order and gates. Written 2026-07-31. No timelines — 2-person team sizes its
own work.

Companion docs: `ARCHITECTURE.md` (target state), `DATA_POLICY.md` (what we store).

---

## Phase 1 — Visibility platform, SSO + RBAC, hosted

Show the whole estate in one pane. Store almost nothing.

### 1a — Stop the write path

The current write path is what makes everything downstream expensive. Fix before
adding vendors, not after — every integration built on the old path gets rewritten.

- Export a ~50K-event fixture to `backend/tests/fixtures/` so the Phase 2
  correlation engine has something to be tested against.
- Truncate `events` and `incidents`. VACUUM. Reclaims ~10 GB. Nothing has ever
  been acted on: 29,525 incidents, none ever updated, all `open`.
- Stop the polled-state emitters:
  `backend/worker/collectors/mist_topology.py:157` (reachability, 448,812 rows),
  RF-stats-as-events (784,869 rows), VeloCloud `"Edge New Device"` (103,600
  rows), app visibility.
- `raw_event` is retained as a 7-day debug record for vendor-sourced events; synthesized RF/uplink state events no longer write it. Old bloat stripped by `source_event_id` prefix; daily retention enforces the 7-day window. This keeps the debug value while bounding PII/storage.
- Wire `EVENT_RETENTION_DAYS` — **DONE**. `INCIDENT_RETENTION_DAYS` and a 7-day `raw_event` debug window are also wired.
- Fix `retention.py` logging `correlation_telemetry: column "created_at" does not
  exist` every cycle.
- Fix `mist-inventory` reporting **-29.3 s** average duration (`finished_at`
  before `started_at`).

**Gate:** ingest under 100 MB/day projected at 8 vendors, from 2.5 GB/day at 4.

### 1b — Canonical identity

- `schemas/postgres/007_identity.sql`: `devices`, `device_identities`, `sites`.
- Identity resolver every collector writes through.
- Backfill from `inventory` + `topology_nodes`.

**Gate:** ≥95% of device references resolve, from **3.1%** today (54 of 1,715).
Nothing in Phase 2 works without this.

### 1c — Cache layer

- Redis or `cache_*` fronting all vendor reads, 60s TTL. Generalize the pattern
  in `backend/api/routes/mist_clients.py:305`.
- Every cached view carries an "as of HH:MM:SS" timestamp.

**Gate:** dashboard cold-loads in seconds without a vendor throttle. Mist alone is
~900 calls per full pass.

### 1d — Integrations

Configure what exists, then build what doesn't. All through the 1b resolver.

Configure: DNAC (5 collectors written, never configured), Arista WLC (4, same).
Fix: Mist `/api/v1/orgs/{org_id}/clients` returns **404** — this is why
`client_mac` is NULL on all 2.2M events and client topology has always been 0
rows. Pull Mist EX switch inventory so Juniper switches stop being
`Switch f8:39:18...` guessed from LLDP.
Build: Aruba Central (HPE switches), ClearPass (NAC), Cloudflare, Netskope.
SD-WAN behind a vendor-neutral adapter — VeloCloud only until Silver Peak cutover.

Cloudflare and Netskope are path segments, not `topology_nodes`.

**Gate:** every platform reporting. Device counts reconcile against each vendor's
own console.

### 1e — Keycloak SSO + RBAC

Keycloak realm is owned by the Keycloak team. We implement the client side.

- OIDC client, session handling, token refresh.
- Roles: viewer / operator / admin, enforced server-side.
- `audit_log` on every call that touches gear.
- Shared `X-API-Key` demotes to machine clients only.

Must land before Phase 4 — on-demand diagnostics hit production equipment and you
need to know who pressed the button.

**Gate:** Keycloak login works, roles enforced server-side, audit rows written.

### 1f — Azure

Hosting is Azure with a managed PostgreSQL, not AWS. Full requirement — SKUs,
networking, Key Vault, cost, and the remaining code deltas — in `AZURE_HOSTING.md`.

- Azure Database for PostgreSQL Flexible Server (Burstable B2s; B1ms cannot carry the
  31 peak connections), Key Vault for 8 vendors' credentials, one VM running the
  existing compose file, reverse proxy terminating TLS.
- ~~Add `ssl=` to `create_pool()`~~ — **done** (`ssl='require'` when `POSTGRES_SSL=true`).
- ~~Real migration runner~~ — **done** (`scripts/migrate.py`, idempotent, in the image).
- **Remove `dns: 8.8.8.8`** — still present on `worker`/`web` in `docker-compose.yml`
  and `worker`/`api`/`web` in `docker-compose.dev.yml`. Breaks private DNS for the
  database FQDN and every on-prem controller name.
- **Rebuild the frontend with the real `NEXT_PUBLIC_API_URL`** — it is inlined into the
  browser bundle at build time, so a runtime value never reaches the browser.
- Wire Key Vault into `settings.py` (nothing reads it today).
- Egress allowlist to 6 cloud controllers behind a NAT Gateway for a stable source IP;
  on-prem reach over multi-cloud connect — **confirm the circuit terminates in Azure**.

**Gate:** reachable at an internal DNS name over TLS, every controller reachable,
nothing publicly exposed.

---

## Phase 2 — Correlation engine

The only phase where storage is unavoidable. You cannot correlate what you did not
capture — a link that flaps at 03:00 and recovers by 03:02 does not exist to an
on-demand query at 09:00.

- Fix edge direction: `links` table with explicit `parent_node_id`/`child_node_id`
  replaces the ambiguous `src_id`/`dst_id` in `topology_edges` for cascade-relevant
  relationships. `topology_sync.py` writes switch→AP to `links`; `DatabaseTopologyProvider`
  queries `links` for parent-child; `node_id_to_device_id()` fallback translates
  child node_ids to event device_ids. This is why Stage 2 cascade can now match
  topology edges to events.
- Change incident identity from SHA-256-of-event-set to (root-cause node +
  failure signature + open window). The hash is why 29,525 incidents were never
  once updated and `"Multiple locations - connectivity issue"` appears 12,601
  times.
- `events` becomes a 24–48h working buffer, alarms only, no `raw_event`.
- `device_state_history` / `link_state_history`, diff-on-write.
- `incident_evidence` denormalized at creation (~10 KB/incident) so incidents stay
  readable after the buffer rolls.
- Recursive-CTE upstream/downstream traversal, symptom suppression, auto-close on
  state clear.
- `metrics_rollup` for baselines — only if "where can we improve connectivity"
  stays in scope.
- Move the topology source off event-mining:
  `backend/worker/collectors/topology_sync.py:164` derives all 1,117 physical
  links from `link_up` event metadata. With no event archive this must come from
  `interfaces`/`links` written directly by collectors.

**Gate:** a site WAN failure produces one incident with N suppressed symptoms.
Daily incident count drops from ~15K to tens.

---

## Phase 3 — Live NOC + location drill-down

Location list → location detail → node graph → map or Mist floorplan with AP x/y.
`locations` registry (site → building → floor → zone, lat/lng) maintained by us;
no vendor has it. Needs 1d complete.

---

## Phase 4 — Client path trace + on-demand diagnostics

MAC → hop chain (client → AP → switch port → uplink → edge → Netskope → internet)
with per-hop health and the first unhealthy hop flagged. Session/roaming history.
Live tests: ping/traceroute from the edge, Mist client insights, switch port
stats. RBAC-gated, rate-limited, every run written to `diagnostic_runs`.

Depends on the Mist client 404 fix (1d) and Keycloak (1e).

---

## Phase 5 — LLM-led RCA

Evidence pack from Phase 2's incident + Phase 4's path + state history. Behind an
`llm_enabled` flag.

The evidence pack is deterministic and the model must cite evidence IDs for every
claim — LLM reasoning, but falsifiable. No raw vendor payloads, no credentials, no
client PII in the egress. `llm_calls` logged.

---

## Cross-phase notes

- `/events` and `/devices` pages exist but are linked from nowhere. Wire into
  `frontend/src/config/navigation.ts` or delete.
- `syslog_receiver.py` and `snmp_trap_receiver.py` exist and are imported by
  nothing. Decide in 1d whether they are in scope.
- `STORAGE_MODE` was removed — it had zero consumers; the database connection is driven by `DATABASE_URL`.
- Worker healthcheck `start_period: 30s` is shorter than the first collection
  pass, so the container reports a transient false "unhealthy" on startup.

## Open questions

- Client MAC: plaintext 7d then hashed, or hashed throughout?
- Netskope: confirm aggregate-only.
- Arista WLC and ClearPass credentials — do they exist?
- Mist switch port data via Mist API, or SNMP?
