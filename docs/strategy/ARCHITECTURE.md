> **Appendix (2026-08-04) — current-state bridge.** Appended by the Naxis team (original text untouched); see `PLAN_GAP.md` for the gap map + execution plan.
>
> **Verified against today's code:**
> - **Phase 2 correlation engine + incidents + Alerts UI already exist** (`backend/shared/correlation/`, `backend/api/routes/incidents.py`, `frontend/src/app/correlation/page.tsx`) — this doc describes them as future. The cascade-killing identity defect (3.1%) is fixed via WP-1. The edge-direction defect is fixed via WP-2.1: explicit `links` table with `parent_node_id`/`child_node_id` replaces ambiguous `src_id`/`dst_id` in `topology_edges` for cascade relationships.
> - Missing exactly as documented: identity tables/resolver (1b), generalized cache (only `mist_clients.py:305` + `mist_sle.py` per-route caches exist), Keycloak/`audit_log`, AWS (all three RDS blockers real: no `ssl=` in `create_pool()` `client.py:38`, `dns: 8.8.8.8` in compose, no migration runner; also `api` service has no `build:` in compose).
> - No `incident_evidence`, `device_state_history`, `link_state_history`, `metrics_rollup`, `locations`, `diagnostic_runs`, `llm_calls` — all future as described.
> - `/events` + `/devices` are indeed unlinked — and so are `/mist`, `/sdwan`, `/incidents` (nav = 9 of ~13 pages) → housekeeping in `PLAN_GAP.md`.

---

# NAXIS.ai — Architecture

Target-state architecture. Written 2026-07-31, replacing the deleted doc set.

## Goal

A network resilience platform for one enterprise estate. It sits above 8 vendor
control planes and answers, in increasing depth:

1. What is the estate right now? — visibility (Phase 1)
2. What is broken, and where is the fault? — correlation (Phase 2)
3. What does one location look like? — NOC drill-down (Phase 3)
4. Where is this client's traffic stuck? — path trace (Phase 4)
5. Why did it break? — RCA (Phase 5)

Naxis reasons; it does not own incident workflow. There is no ack/assign/resolve.
Incidents auto-close when the underlying condition clears.

## The principle that shapes everything

**Cache what a vendor already knows. Store only what Naxis creates.**

Vendor consoles are the archive. Re-storing their event history is duplication
with no reader. Naxis stores exactly six things (see `DATA_POLICY.md`); every
other view is a TTL'd cache over live vendor APIs.

The one exception is Phase 2. You cannot correlate what you did not capture — a
link that flaps at 03:00 and recovers by 03:02 does not exist to an on-demand
query at 09:00. Correlation is the only reason Naxis persists a timeline.

## Estate

| System | Domain | State |
|---|---|---|
| VeloCloud | SD-WAN | live — 5 collectors |
| HPE Silver Peak / EdgeConnect | SD-WAN | replaces VeloCloud at cutover; not built |
| Mist | Wi-Fi APs + Juniper switches | live for APs; switch inventory not pulled |
| Cisco DNAC | switches + wireless | 5 collectors written, never configured |
| Arista WLC | Wi-Fi | 4 collectors written, never configured |
| Aruba Central | HPE switches | not built |
| Aruba ClearPass | NAC / identity | not built |
| Cloudflare | WAF / app edge | not built — path segment, not a device |
| Netskope | proxy / VPN | not built — path segment, not a device |

No Meraki. DNAC is the Cisco path.

Cloudflare and Netskope are **not** `topology_nodes`. They are policy planes that
traffic traverses, modelled as path segments so Phase 4 inherits them for free.
Modelling them as devices means undoing it in Phase 4.

SD-WAN is built behind a vendor-neutral adapter interface so the Silver Peak
cutover is an adapter swap, not a rewrite. VeloCloud remains the only live SD-WAN
implementation until cutover.

## Stack

Unchanged from today except where noted.

| Layer | Tech | Notes |
|---|---|---|
| DB | PostgreSQL 16 | local Docker in dev; AWS RDS in prod |
| Backend | Python monolith, one image, two entrypoints | `api` = uvicorn:8000, `worker` = async daemon |
| Frontend | Next.js 15 + TanStack Query + shadcn | |
| Cache | Redis | pub/sub for incident SSE **and** the vendor-response cache |
| Auth | Keycloak OIDC + RBAC | Keycloak realm owned by the Keycloak team; Naxis implements the client |
| Deploy | docker-compose on AWS EC2 | + reverse proxy terminating TLS |
| Secrets | AWS Secrets Manager | 8 vendors' credentials; not plaintext `config/.env` |

One Docker image, two processes. No microservices. No managed services beyond
RDS and Secrets Manager.

## Deployment

AWS, with multi-cloud connect already in place to the corporate network. That
link is what makes cloud viable — DNAC, Arista WLC, ClearPass and the switches
are on-prem and unreachable otherwise. No on-prem collector agent, no worker
split, no new inbound firewall rules.

Egress needed to: `api.mist.com`, VeloCloud VCO, Silver Peak Orchestrator,
Aruba Central, Cloudflare, Netskope.
Ingress to on-prem over the existing link: DNAC, Arista WLC, ClearPass, switches.

Three things block the RDS move and are Phase 1 work:

- `backend/shared/database/client.py` — `create_pool()` passes no `ssl=`. Every
  managed provider requires TLS.
- `docker-compose.yml` — `dns: 8.8.8.8` is hardcoded on api and worker. This
  breaks private DNS resolution for an RDS endpoint. Must be removed.
- Schema application is Docker-only (`docker-entrypoint-initdb.d`), which does
  not exist on RDS. `003_telemetry_expansion.sql` has zero `IF NOT EXISTS`
  guards, so it cannot be re-run. Needs a real migration runner.

## Data model

Current tables that survive: `inventory`, `topology_nodes`, `topology_edges`,
`collector_run_ledger`, `worker_heartbeat`, `correlation_telemetry`,
`node_health_snapshots`.

### Phase 1 — identity and access

```
devices            device_key PK, canonical name, type, role, site_key, vendor, model
device_identities  vendor, vendor_device_id, device_key FK   -- the join table
sites              site_key PK, name, vendor site_ids[], parent
users, roles, sessions
audit_log          actor, action, target, result, at
```

`device_identities` is the platform's only irreducible asset. No vendor knows
that a Mist AP MAC and the DNAC switch port it uplinks to are the same physical
adjacency. Today event device references resolve against topology at **3.1%**
(54 of 1,715) because events carry a bare MAC (`a8f7d9044ce1`) while nodes use
`mist-ap-00000000-0000-0000-1000-<mac>`. Every collector must write through an
identity resolver.

### Phase 2 — correlation

```
events                 24-48h working buffer. Genuine alarms only. No raw_event.
device_state_history   diff-on-write: one row per real transition
link_state_history     diff-on-write
interfaces             port-level detail, written by collectors
links                  explicit parent_key / child_key, not src/dst
incidents              identity = (root_cause_node, failure_signature, open_window)
incident_evidence      denormalized: ts, device, type, severity, title, vendor deep-link
metrics_rollup         hourly 90d (WAN links), daily 90d (radios), daily 2y (sites)
```

Two bugs here are why Stage 2 topology cascade has produced **zero** incidents
in its entire life:

1. Identity resolution at 3.1%, above.
2. Edge direction. Every `physical_link` row is AP→switch, and
   `backend/shared/database/topology.py:398` treats `dst_id` as the parent — so
   switches are modelled as children of APs. Cascade is inverted even once IDs
   resolve. `links` replaces this with explicit `parent_key`/`child_key`.

A third design bug: incident identity is currently a SHA-256 of the sorted
event-ID set. One new event produces a brand-new incident rather than updating
the existing one. Result: 29,525 incidents, **none ever updated**, all `open`,
with `"Multiple locations - connectivity issue"` appearing 12,601 times.

`incident_evidence` denormalizes each contributing event (~200 bytes × ~50
events = ~10 KB per incident) so an incident stays readable after the 24-48h
event buffer rolls. Without it, last week's incident opens empty and Phase 5 has
nothing to reason over.

### Phase 3-5

```
locations       site -> building -> floor -> zone, lat/lng. Ours; no vendor has it.
clients         current association 7d, session history 30d
diagnostic_runs actor, target device, test type, result, at  -- audit, not analytics
llm_calls       request, response, evidence IDs cited
```

## API

FastAPI. Existing conventions hold:

- Every list-style JSON endpoint has a `.csv` twin at the same path.
- Feature flags per vendor: `<vendor>_enabled`. Never hard-fail when off.
- Auth moves from shared `X-API-Key` to Keycloak OIDC bearer tokens. The API key
  demotes to machine clients only.
- Cache-first reads: a `cache_*` layer or Redis fronting vendor calls, 60s TTL.
  The pattern exists already in `backend/api/routes/mist_clients.py:305`.

Measured vendor latency — this is why naked pass-through is not an option:

| Collector | avg | max |
|---|---|---|
| `mist-inventory` | — | 252 s |
| `velocloud-links` | 1.7 s | 163 s |
| `mist-radio-neighbors` | 17 s | 67 s |
| `velocloud-apps` | 44 s | 56 s |

Mist alone is ~900 API calls per full pass (153 sites × 6 separate site loops).
Four concurrent dashboard users without a cache is 3,600 calls and vendor
throttling.

`mist-inventory` reports an average duration of **-29.3 s** — `finished_at` is
before `started_at`. Separate bug, tracked in the roadmap.

## UI

Front door is the multi-vendor single pane. From there:

- **Live NOC** (Phase 3) — location list → location detail → node graph → map or
  Mist floorplan with AP x/y.
- **Client trace** (Phase 4) — enter a MAC, get the hop chain with per-hop health
  and the first unhealthy hop flagged, plus on-demand diagnostics.
- **Incidents** (Phase 2) — explanation only. No lifecycle controls.

Every cached view carries an honest "as of HH:MM:SS" timestamp. Cache-first means
data is up to 60s stale and a cold cache takes seconds to fill; the UI must not
imply live.

Existing conventions hold: `@/` alias, `useQueryState` for all tab/view state
(never plain `useState`), `<Suspense>` around `useSearchParams()`.

`/events` and `/devices` pages exist but are linked from nowhere. Either wire
them into `frontend/src/config/navigation.ts` or delete them.

## Open questions

- **Client MAC handling.** MACs are personal data under GDPR/DPDP. Phase 4's
  "enter a MAC" feature needs plaintext at least in the hot window.
  Recommendation: plaintext 7 days, hashed after. Policy call, not technical.
- **Netskope scope.** Aggregate tunnel health only, or per-user? Per-user
  browsing history in Naxis changes what the platform legally is. Assumed
  aggregate-only until stated otherwise.
- **Arista WLC and ClearPass credentials** — do they exist, or are those systems
  not yet accessible to us?
- **Mist switch coverage.** Mist switches show `vendor='mist'`, so port-level
  data is likely available via the Mist API rather than SNMP. Confirm before
  committing to the SNMP path for Juniper switches.
