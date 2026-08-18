> **Appendix (2026-08-18).** Hosting is **Azure with a managed PostgreSQL** — see
> `AZURE_HOSTING.md`, which supersedes §8 wherever they disagree. §9's `/incidents/stats`
> note below is now scoped: `by_severity`, `distinct_sites`, `distinct_devices` and
> `avg_confidence` count **active** incidents only, because the KPI tiles sit beside
> `active` and previously read "Critical 61,749" next to "Active 3,652". Test counts,
> DB size, and the RDS-blocker list in the 08-04 appendix are all stale — the
> measured table in `PLAN_GAP.md` §7 is authoritative.
>
> ---
>
> **Appendix (2026-08-04) — current-state bridge.** Appended by the Naxis team (original text untouched); see `PLAN_GAP.md` for the full gap map and execution plan.
>
> **Numbers that changed since this was written:**
> - Tests: **432/432 backend pass** (was 284/300 — all collector and correlation tests pass), **114 frontend pass**, type-check clean.
> - Storage: `raw_event` premise corrected — it was **100% populated** (1,379,730 rows); old bloat stripped by `source_event_id` prefix (1,124,128 rows cleared, 5,207 MB → 877 MB); DB is **2.1 GB** (was 10); events **1,380,476** (was ~2.2M); incidents **11,085** (was 29,525).
> - `retention.py` fixed (`recorded_at` bug); `EVENT_RETENTION_DAYS`, `INCIDENT_RETENTION_DAYS`, and a 7-day `RAW_EVENT_DEBUG_DAYS` window are now wired.
> - Polled-state emitters stopped: RF + wired uplink diff-on-write; `mist-history` transitions are steady-state (0 recent flaps).
> - Dead `syslog_receiver`/`snmp_trap_receiver` deleted; `STORAGE_MODE` / `storage_mode` / `is_postgres_enabled` removed; worker healthcheck `start_period` 30s → 300s.
> - Fixed since WP-1/WP-2.1/WP-2.2: identity resolution ~100% for wired collectors; edge direction fixed via explicit `links` table; incident identity fixed (deterministic fault fingerprint `(site|root_device|category)`, SQL array union for evidence accumulation, severity escalation, terminal recurrence handling).
> - Unchanged: Mist clients 404, no Keycloak/audit_log, no AWS.
> - Phase 5 (Alerts page) work landed after this doc: truthful KPI row from `/incidents/stats`, root-cause grouping, `site_name`/`root_device` enrichment.

---

# NAXIS.ai — Technical Q&A

Study reference. Every number here was measured against the running system on
2026-07-31, not estimated. Where something is broken it says so — a reviewer will
find it, and knowing it first is the strong position.

---

# 1. Product

### What is NAXIS.ai?

A platform that sits above eight vendor control planes, normalises their data into
one model, and explains what is broken. It is not monitoring — the vendor consoles
already monitor. It is the layer that answers "which of these 40 alerts is the
cause" across vendors that cannot see each other.

### Why not just use the vendor consoles?

Each console sees only its own domain. During an incident an engineer opens Mist,
VeloCloud, DNAC, Netskope, and correlates in their head under pressure.

Concrete gap: when a site's Netskope tunnel fails, every AP is up, every switch is
up, the SD-WAN edge is reachable. Every console we own shows that site as healthy.
Users have no internet. No single existing tool can state that, because no single
tool sees both the LAN and the egress path.

### Why not an off-the-shelf AIOps product?

Not evaluated in depth — the honest answer. The specific thing we need is
correlation across *our* eight-vendor mix including Netskope egress and Cloudflare
app edge, which is an unusual combination. If a product does that, buying is
cheaper than building. What we have that a product won't is the cross-vendor
identity map for our estate.

### What is the scope boundary?

Naxis reasons; it does not own workflow. No ack, assign, or resolve. No
configuration change to any device, in any phase. Incidents auto-close when the
underlying condition clears. Phase 4 adds read-only diagnostic *actions* (ping,
traceroute, port status) — never writes.

---

# 2. Architecture

### Describe the architecture.

One Docker image, three processes:

- `api` — FastAPI, `uvicorn main:app`, port 8000
- `worker` — async daemon, `python -u -m worker.main`, no listening port
- `web` — Next.js 15, port 3000

Backed by PostgreSQL 16 and Redis. Both `api` and `worker` share the same
codebase, models and database. Redis is used for real-time incident pub/sub
(channel `naxis:incidents`) and the vendor-response cache — not as an event bus.

### Monolith or microservices, and why?

Monolith. Three arguments, in order of strength:

**1. Identity resolution would become a network call.** `device_identities` is the
join table every collector writes through to resolve a vendor's device ID to our
canonical key. In-process that is a query. Split by vendor and it is an RPC on
every device write, or the logic gets duplicated eight times and drifts.

**2. Correlation needs cross-vendor events in one place, in time order.** Split
collectors into services and you need a message bus, then ordering guarantees,
then you are debugging distributed ordering instead of writing correlation rules.

**3. Two-person team.** Eight services means 8× the deploy surface for
credentials, TLS, health checks, connection pools and tracing. That time comes
out of integrations.

The reach argument for splitting — collectors on-prem, API in cloud — was real
until multi-cloud connect made one process able to reach everything.

### When would you revisit that?

Three concrete triggers:

- Another estate needs collecting and it is not reachable → on-prem collector agent
- Phase 5 LLM call volume needs a real queue → extract the RCA worker
- Vendor count past ~20 and collector deploys start blocking API deploys

None applies at eight vendors, one estate, two people.

### Isn't three processes already microservices?

No. Microservices means independently deployable artefacts with separate
codebases and data. This is one image, one codebase, one database, started with
three different commands. Adding a fourth process (`worker-slow` on a 15-minute
cycle) would still be the same artefact.

### Why PostgreSQL only? Why not a graph DB for topology, or a time-series DB?

The topology is ~2,700 nodes and ~3,400 edges. Traversal depth is 3–5 hops.
A recursive CTE handles that in single-digit milliseconds. Neo4j earns its
operational cost at millions of nodes and unbounded traversals, not here.

Time-series: after the storage redesign we keep ~100 MB of rollups. ClickHouse or
Timescale for 100 MB is not defensible.

Verified portability: the schemas use zero `CREATE EXTENSION`, no superuser DDL,
and `gen_random_uuid()` which is core in PostgreSQL 13+. 257 lines of SQL total.
Any managed PostgreSQL accepts them unchanged.

### Why Redis if PostgreSQL does everything?

Two narrow jobs: pub/sub so the UI gets incidents pushed over SSE without
polling, and the vendor-response cache. Both are things Postgres does badly.
Redis is optional and non-blocking — the worker continues if it is down.

---

# 3. Data flow — end to end

### Walk through one worker cycle.

`WorkerDaemon.run_once()` in `backend/worker/main.py`:

1. **Collect** — each enabled collector's `collect()` returns a `CollectorOutcome`
   (collector_id, source_system, status, timestamps, events, rows_written,
   error_text, metadata)
2. **Ledger** — every outcome written to `collector_run_ledger`, which is what
   drives the UI's freshness and failure display
3. **Heartbeat** — row in `worker_heartbeat`, plus `/tmp/naxis-worker-alive` for
   the container healthcheck (the image has no `ps`)
4. **Persist** — normalised events inserted to Postgres
5. **Topology sync** — before correlation, so Stage 2 has a populated graph
6. **Correlate** — events in, incidents out; upsert incidents, link events
7. **Publish** — new incidents to Redis if enabled
8. **Telemetry** — engine stats to `correlation_telemetry`
9. **Health checks** — collector failure/skip pattern detection, notification
   dispatch (Slack/SMTP with dedup)
10. **Snapshots** every 5 min, **retention** every 24 h
11. Sleep `COLLECTOR_INTERVAL` (60 s)

Whole pass wrapped in `asyncio.wait_for` with a `max(interval × 10, 600)` = 600 s
watchdog. Timeout cancels and recovers next interval rather than hanging.

### How does normalisation work?

Every vendor payload maps to `UnifiedEvent`: event_id, timestamp, source,
source_event_id, severity, category, event_type, title, description, plus nested
`DeviceInfo` / `ClientInfo`, tags, metadata, raw_event.

`EventSource` is a 9-member enum (dnac, mist, velocloud, arista_sdwan, arista_wlc,
snmp, snmp_trap, syslog, system). Severity is syslog-aligned. Vendor-specific
fields survive in `metadata`; the vendor payload in `raw_event`.

This abstraction genuinely holds — it is why adding vendor nine is mechanical.

### What is the collector contract?

One method returning `CollectorOutcome`, or `collect_all()` for a vendor with
sub-collectors. Registered in `WorkerDaemon`, gated by a `<vendor>_enabled`
setting. Never hard-fails when disabled — a missing credential produces a skipped
outcome, not a crash.

21 collectors today across four vendors.

### How does collector failure get surfaced?

`collector_run_ledger` records every run with status and duration.
`check_collector_health()` looks for failure and skip patterns over a 30-minute
window; `dispatch_alerts()` sends Slack/SMTP with in-memory dedup. Thresholds are
`NOTIFICATION_MIN_FAILURES=3`, `NOTIFICATION_MIN_SKIPS=10`.

This part works well and is worth showing.

---

# 4. Correlation engine

### How does correlation work?

Two stages.

**Stage 1 — site + time window.** Filter events below MAJOR severity. Group by
`site_id` within a 300 s window. Group key falls back `site: → device: → event:`
when site is unknown. Events outside the window on the same key create a
sub-group (`site:X:1`, `site:X:2`).

**Stage 2 — topology cascade.** Split each group into infrastructure vs leaf by
device type. Infra: switch, router, wan_edge, gateway, controller, firewall,
core_switch, distribution_switch, access_switch. Leaf: ap, access_point, client,
endpoint, sensor, camera, iot. Unknown types default to leaf. For each infra
device with children present in the same group, emit a cascade incident with the
infra device as root cause and the leaves as symptoms. Leaves with no identified
parent stay in their original incident.

### How is an incident ID generated?

`inc-` + first 16 hex of SHA-256 over the fault fingerprint `(site_id | root_device_id | category)`.
Deterministic, so events describing the same underlying failure map to the same `incident_id` across worker cycles.
If the existing incident in Postgres is in a terminal status (`resolved`, `closed`, `suppressed`), `_compute_incident_id_with_recurrence()` appends the epoch hour to spawn a new incident for the recurrence.

**FIXED in WP-2.2** (previously hashed event-ID set, causing duplicate incidents).

### How is confidence calculated?

`event_score × 0.4 + avg_severity × 0.4 + device_score × 0.2`

- `event_score` = `log(n+1)/log(10)`, capped at 1.0
- `avg_severity` = mean of per-event weights (critical 1.0, major 0.7, minor 0.4,
  warning 0.2, info 0.1)
- `device_score` = `unique_devices / 5`, capped at 1.0

**Be honest about what this measures:** event count and severity — grouping
confidence, not root-cause confidence. It sits in the `confidence_score` column
whose docstring says "RCA confidence." Measured average across all incidents is
0.699, which tells you nothing useful about correctness.

### How does correlation survive a restart or span cycles?

Two mechanisms.

*Restart:* on first call, `_load_processed_from_db()` loads all event IDs already
linked to incidents so previously-correlated events are not reprocessed.

*Cross-cycle:* `_fetch_unlinked_events()` pulls events with `incident_id IS NULL`
inside 2× the time window (limit 5,000) and merges them with the current batch, so
a group spanning two 60-second polls still forms one incident.

Processed events are tracked in an ordered dict capped at 200,000 with a 24-hour
TTL, evicting oldest-first.

**Known issue:** worker logs show `tracker_size=200000` — the tracker is pinned at
capacity, so eviction is running constantly and correlation may be re-processing
events whose IDs were evicted early.

### What is the measured performance?

~850 ms per cycle for ~1,650 events after filtering. Not a bottleneck.

---

# 5. Known defects — expect to be asked

Volunteering these is stronger than being caught by them.

### Stage 2 cascade has produced zero incidents in its entire life.

`0` cascade incidents ever created. The worker logs the warning every cycle. Two
independent causes:

**Cause 1 — identity mismatch.** Topology nodes are
`mist-ap-00000000-0000-0000-1000-a8f7d9044ce1`. Events carry the bare MAC
`a8f7d9044ce1`. `_known_node_id_patterns()` tries `mist-ap-<mac>` but not the
`00000000-0000-0000-1000-` infix. Measured: **54 of 1,715** event devices resolve
= **3.1%**. With the correct prefix, 1,480 would resolve.

**Cause 2 — inverted edge direction — FIXED in WP-2.1.** The 1,117 `physical_link`
rows were written AP→switch (`src_id` = AP, `dst_id` = switch), but the real bug
was deeper: `get_parent_child_map()` returned raw topology node_ids (e.g.
`"mist-ap-abc123"`) as child device_ids, while events use stripped canonical keys
(e.g. `"abc123"`). The cascade could never match.

Fix applied: explicit `links` table (`009_links.sql`) with `parent_node_id`/
`child_node_id`, migration from `topology_edges`, write path in `topology_sync.py`
now uses `_upsert_link()`, and `get_parent_child_map()` queries `links` and
resolves unknown children via `node_id_to_device_id()` — which strips known
prefixes so `"mist-ap-abc123"` becomes `"abc123"` for event matching.

### Incidents are snapshots, not objects — FIXED in WP-2.2.

Previously ~29,500 rows with zero ever updated.

Fix applied in WP-2.2:
- Identity is now deterministic fault fingerprint `(site_id | root_device_id | category)`.
- `upsert_incident` SQL uses `array_agg(DISTINCT x)` via `unnest()` to **MERGE** `related_event_ids`, `affected_*`, and `symptom_device_ids` across cycles so evidence accumulates.
- `severity` uses a `CASE` statement to only escalate (never downgrade).
- `created_at` is preserved on update (only `updated_at` advances).
- Terminal statuses (`resolved`, `closed`, `suppressed`) are preserved, and recurrences spawn a new incident via epoch-hour suffix in `_compute_incident_id_with_recurrence()`.

### "Multiple locations" is a missing-data artefact.

598,827 VeloCloud events have no `site_id`. They fall to the `device:` group key,
whose title generator emits "Multiple locations." It is not a real multi-site
incident.

### 39.5% of events are polled state, not state changes.

- `device_unreachable` — 448,812 rows. `mist_topology.py:157` writes a fresh
  CRITICAL row with a new UUID every 5 minutes per disconnected AP. One AP
  produced 335 identical rows.
- RF Stats — 784,869 rows of metrics stored as events.
- `"Edge New Device"` — 103,600 rows.
- VeloCloud re-ingests the same vendor event each poll: `source_event_id=12538`
  produced 336 rows with 336 distinct timestamps. 2,215,589 rows carry only
  1,675,011 distinct `source_event_id` values.

This violates the diff-on-write convention. Fix: state changes to
`device_state_history` / `link_state_history`, metrics to `metrics_rollup`, and
`events` holds only genuine alarms.

### RCA does not exist.

`probable_cause` is NULL on all ~29,500 incidents. Nothing is wired.

### Client tracking has never worked.

`client_mac` is NULL on all 2.2M events; `interface_name` likewise. The Mist
collector calls `/api/v1/orgs/{org_id}/clients`, which returns **404**. Client
topology has always returned 0 rows.

### Others

- `EVENT_RETENTION_DAYS=90` is wired; `INCIDENT_RETENTION_DAYS=180` (resolved
  incidents only) and `RAW_EVENT_DEBUG_DAYS=7` are also wired. `retention.py`
  `created_at` bug fixed.
- `mist-inventory` duration guard clamps negatives to 0; ledger now shows 0
  negatives and a positive average duration.
- `STORAGE_MODE` / `storage_mode` / `is_postgres_enabled` were removed — they had
  zero consumers and the DB connection is driven by `DATABASE_URL`.
- Worker healthcheck `start_period` is 300s.
- `/events` and `/devices` pages exist and are linked from nowhere.
- `syslog_receiver.py` and `snmp_trap_receiver.py` were deleted.
- All 418 backend tests pass; 16 historic `test_velocloud_collector.py` failures
  are resolved.

---

# 6. Storage and data policy

### What do you store, and why so little?

Governing rule: **cache what a vendor already knows; store only what Naxis
creates.**

Six things are stored, ever:

1. Cross-vendor identity map — no vendor knows a Mist AP and a DNAC switch port
   are the same adjacency
2. Events captured while nobody was watching (Phase 2+)
3. Incidents plus denormalised evidence (Phase 2+)
4. Baselines/rollups — only because "where can we improve connectivity" is in
   scope
5. Audit: logins, role changes, diagnostics run against gear
6. Users, roles, locations

Everything else is a 60-second TTL cache over live vendor APIs.

### Where did the current 10 GB go?

| Category | Rows | raw_event |
|---|---|---|
| performance | 884,163 | 4,963 MB |
| system | 832,573 | 3,046 MB |
| connectivity | 424,667 | 239 MB |
| application | 243,604 | 63 MB |
| security | 570 | 258 kB |
| configuration | 531 | 295 kB |

After WP-0 (2026-08-05): the events table is **2.10 GB** and `raw_event` is
**877 MB** (256,474 rows) — only vendor-sourced events keep raw payloads, and
only for a 7-day debug window. The old RF/uplink polled-state bloat
(1,124,128 rows / 5,207 MB) was stripped. Growth is now ~1 MB/day events at four
vendors (steady state, excluding one-time deploy baseline bursts). The WP-0
ingest gate (<100 MB/day) is closed.

Target: ~400 MB steady state, under 100 MB/day ingest.

### If you don't store events, how can you correlate?

You cannot, which is why Phase 2 is the one exception. A link that flaps at 03:00
and recovers by 03:02 does not exist to an on-demand query at 09:00.

`events` becomes a 24–48 h working buffer of genuine alarms with no `raw_event`.
Evidence is denormalised *into* the incident at creation — timestamp, device,
type, severity, title, vendor deep-link, ~200 bytes × ~50 events = ~10 KB per
incident, kept indefinitely. So an incident stays readable after the buffer rolls.

### Why not on-demand for everything?

Measured vendor latency:

| Collector | avg | max |
|---|---|---|
| `mist-inventory` | — | 252 s |
| `velocloud-links` | 1.7 s | 163 s |
| `mist-radio-neighbors` | 17 s | 67 s |
| `velocloud-apps` | 44.5 s | 56 s |

Mist alone is ~900 API calls per full pass (153 sites × 6 site loops). Four
concurrent dashboard users without a cache is 3,600 calls and vendor throttling.
The cache is mandatory, not an optimisation.

Consequence to state plainly: data is up to 60 s stale, and cold cache loads take
seconds. Every view carries an "as of HH:MM:SS" timestamp.

### What PII is in the database today?

None of it deliberate — it arrived because `raw_event` captured whole vendor
payloads verbatim. After stripping the RF/uplink bloat, the remaining vendor
`raw_event` payloads still carry a small amount of PII inside the 7-day debug
window:

| Key | Events | What |
|---|---|---|
| `xy_coords` | 0 | AP floor coordinates; stripped with the old bloat |
| `hostnames` | 9,225 | employee device names, typically `firstname-laptop` |
| `user_agent` | 2,297 | client OS/browser |
| `admin_name` | 2,262 | named admins from Mist audit logs |
| `username` | 0 | clean today; ClearPass will introduce it |

The 7-day `raw_event` debug window means this PII is bounded and ages out
automatically. Redaction is extended to strip `hostnames`, `user_agent`,
`admin_name` and hash client MACs at *ingest* — before write, never at read.
Once PII is written it is a compliance artefact regardless of whether anything
reads it.

### What is never stored?

Vendor credentials or tokens in any payload. Packet captures or flow payloads.
Netskope per-user URL/browsing history — aggregate tunnel health only. ClearPass
full auth transcripts — success/failure and method only. `raw_event`. Client PII
in any LLM payload.

---

# 7. Security

### How is the API authenticated today?

Shared secret in an `X-API-Key` header, compared with `secrets.compare_digest`
(constant-time). Applied as a router-level dependency on every route group.
`/health` is deliberately open for container healthchecks. Empty `API_KEY`
disables auth so local dev works without a key.

The SSE endpoint additionally accepts the key as a query parameter, because
`EventSource` in browsers cannot set headers.

### What changes with Keycloak?

OIDC authorisation-code flow with PKCE, confidential client. Backend validates
JWTs against Keycloak's JWKS. Three roles mapped from Keycloak groups: viewer,
operator, admin — enforced server-side, never in the UI only. The shared API key
demotes to machine clients. Every gear-touching call writes to `audit_log`.

Keycloak realm is owned by the Keycloak team; we implement the client side.

### What did the security review find?

An internal pass has been completed: authentication is enforced on every router,
TLS verification is on for all vendor HTTP clients, and datastore ports are bound
to loopback rather than `0.0.0.0` so Postgres and Redis are not LAN-reachable.

Outstanding and known:
- Credentials live in a plaintext `config/.env`; moving to **Azure Key Vault** via the
  VM's managed identity. Nothing reads Key Vault today.
- A rotated development API key exists in git history and would need a history
  rewrite to remove
- No rate limiting on the API
- ~~The database pool passes no `ssl=`~~ — fixed; `ssl='require'` when
  `POSTGRES_SSL=true`. Note it does not verify the server certificate.
- `raw_event` payloads inside the 7-day debug window still carry some PII
  (`hostnames`, `user_agent`, `admin_name`); ingest-time redaction is still limited to
  URL passwords

### What is the blast radius if the Naxis server is compromised?

Read-only credentials to eight platforms — an attacker gets a complete map of the
estate: every device, address, topology and weakness. That is why credentials move
to Key Vault, why there is no public ingress, and why Phase 4's diagnostic
actions are RBAC-gated and audited.

Naxis holds no configuration-change permission on any device in any phase, so the
compromise is disclosure, not control.

### Phase 5 sends data outside the boundary. How is that controlled?

Behind an `llm_enabled` flag; deterministic correlation still works when off. The
payload is a constructed evidence pack: incident metadata, device identifiers,
event types, timestamps, topology relationships. No raw vendor payloads, no
credentials, no client PII. Every call logged with request, response and cited
evidence IDs.

The model must cite an evidence ID for every claim, so the output is falsifiable —
a wrong answer can be checked against the row it claims to be based on.

---

# 8. Network and hosting

> Hosting is **Azure with a managed PostgreSQL**. `AZURE_HOSTING.md` is authoritative
> for resources, SKUs, networking and cost; this section covers the reasoning that is
> provider-independent. Where it still says RDS / Secrets Manager / CloudWatch, read
> Flexible Server / Key Vault / Azure Monitor.

### Why cloud, given half the estate is on-prem?

Six of eight controllers are internet-reachable (Mist, VeloCloud, Silver Peak,
Aruba Central, Cloudflare, Netskope). Only DNAC, Arista WLC, ClearPass and the
switches are on-prem. Hosting on-prem to reach the minority means fighting for
egress to the majority. Multi-cloud connect already exists, so the cloud host
reaches on-prem without a new circuit or an agent.

### Why not an on-prem collector agent?

It was the leading alternative. It would split the worker into two deployables,
breaking the one-image model, purely to avoid a firewall rule. Multi-cloud connect
removes the need.

### What ports are needed?

Inbound: 443 from corporate CIDRs (UI/API), 22 from the bastion. Nothing else. No
public ingress. Ports 8000 and 3000 stay on loopback behind the reverse proxy.

Outbound: 443 to six cloud controllers, 443 to four on-prem controllers over
multi-cloud connect, 5432 to the managed database's private IP, 443 to Key Vault and
Azure Monitor private endpoints, plus DNS 53, NTP 123, OS mirrors and registry. The
cloud-controller egress needs a **stable source IP** (NAT Gateway) because several
vendors allowlist it.

Optional, only if we ingest device telemetry directly: syslog 514/UDP and
1514/TCP, SNMP traps 162/UDP, SNMP polling 161/UDP.

### Why does NTP matter?

Cross-vendor correlation is timestamp-based. Clock drift between the Naxis host
and vendor timestamps puts events in the wrong 300-second window, producing wrong
incidents. It is a correctness dependency, not hygiene.

### Sizing?

**Azure, not AWS** — full requirement in `AZURE_HOSTING.md`.

Azure VM Standard_B2ms, 2 vCPU / 8 GB. Measured container usage: web 302 MB, worker
231 MB, api 71 MB — ~600 MB total. Headroom is for eight concurrent pollers and the
correlation cycle. B2s (4 GB) will OOM the Next.js build.

Azure Database for PostgreSQL Flexible Server, Burstable **B2s** (2 vCore / 4 GiB),
32 GiB. Not B1ms: `api` runs `--workers 2` and each process opens its own pool of up
to 10, plus the worker's pool and the migration job — 31 connections at peak against
a B1ms ceiling of about 35, which leaves nothing for a `psql` session or a monitoring
probe. HA disabled: this is an operations tool, not a revenue system, and an RTO of
hours is acceptable.

### Blockers for the managed-Postgres move

1. ~~`create_pool()` passes no `ssl=`~~ — **fixed.** `ssl='require'` when
   `POSTGRES_SSL=true` or `ENVIRONMENT=production`. It encrypts but does not verify the
   server certificate; acceptable behind a private endpoint, tighten with an
   `ssl.SSLContext` if policy requires.
2. `dns: 8.8.8.8` hardcoded in compose — **still open.** Present on `worker`/`web` in
   `docker-compose.yml` and `worker`/`api`/`web` in `docker-compose.dev.yml`. Breaks
   private-DNS resolution for the database FQDN and every on-prem controller name.
3. ~~Schema application is Docker-only~~ — **fixed.** `scripts/migrate.py` tracks applied
   files in `schema_migrations`, and it plus `schemas/` are copied into the image, so
   `make migrate` works against a managed server.
4. New: `NEXT_PUBLIC_API_URL` is inlined into the browser bundle at build time — a
   hosted deployment must be **rebuilt** with the real URL.
5. New: Key Vault is not wired into `settings.py`; credentials are still plaintext
   `config/.env`.
6. New: `DATABASE_URL` must be set explicitly. `client.py` reads it directly and never
   consults `settings.postgres_url`, so setting only `POSTGRES_HOST` silently leaves the
   pool pointed at localhost.

---

# 9. Scale and operations

### Does this scale to the full estate?

Today (2026-08-18): 2,750 topology nodes, 2,258 edges, 1,110 switch→AP links, 2,059
inventory rows, 2,059 canonical devices behind 4,021 vendor identities, 153 sites —
across two live vendors. Eight vendors is roughly 3–4× that; still small for Postgres.

The real constraint is not data volume but **API fan-out**. Collectors run
sequentially; `mist-inventory` peaks at 252 s and `velocloud-links` at 163 s. Eight
vendors serially risks the 600 s watchdog. Fix is concurrent execution inside the
existing worker — `asyncio.gather` with a semaphore and per-collector timeouts. Same
process, same image.

Note the watchdog has already fired in anger, though not for fan-out: an unbounded
retention statement could not complete inside the budget and, because cancellation
skipped its own last-run stamp, it was retried every pass indefinitely. Anything that
can take unbounded time inside `run_once()` needs a batch size and its own budget.

### What happens when a vendor API is down?

The collector returns an error outcome, the ledger records it, the other
collectors continue. After three failures in 30 minutes an alert fires. The UI
shows that vendor's data as stale with its last-success time. Nothing crashes and
no partial state is written.

This only holds if the collector actually reports the failure. The VeloCloud
Orchestrator answers an invalid API token with **HTTP 200** and a JSON-RPC error
envelope (`{"error": {"code": -32000, "message": "tokenError [Invalid API Token]"}}`),
so `raise_for_status()` passed, every VeloCloud collector reported `success` with
`rows_written=0`, and the alerting path above never fired despite the vendor being
completely unreachable. Every VCO response now goes through an envelope check
(`worker/collectors/velocloud_errors.py`). Treat "success with zero rows" as a smell
worth checking for in any new vendor integration.

### What happens when Redis is down?

The worker continues. Redis is optional and non-blocking — incidents still persist
to Postgres, they just do not push to the UI in real time. The UI falls back to
polling.

### How do you know Naxis itself is healthy?

`worker_heartbeat` per cycle, `collector_run_ledger` per collector run, a liveness
file for the container healthcheck, `correlation_telemetry` for engine stats, and
`/health` for the API. In Azure, Monitor alerts on worker liveness, disk, DB
connections and API 5xx.

The gap: a dead worker means silently stale data, which is why the liveness alarm
matters more than the API one.

### Test coverage?

542 tests: **540 passing, 2 failing** as of 2026-08-18. Both failures predate the
current work — `test_rca_engine::test_generate_rca_enforces_citations` and
`test_topology_api::TestGetSiteInternalTopology::test_not_found_returns_empty`.
Coverage is strongest where it matters: 110 tests on the correlation engine, 138 on
VeloCloud normalisation, retention batching + event dedup + telemetry guards, and the
full collector→event→incident pipeline.

Run them in the container — **host Python is 3.8 and cannot parse this code** (it uses
`tuple[...]` builtin generics), and the tests are not in the runtime image:

```
docker run --rm -v "$PWD":/repo -w /repo -e PYTHONPATH=/repo:/repo/backend \
  naxis-api python -m pytest backend/tests/ -q
```

`make test` does exactly this. `conftest.py` imports `backend.shared.correlation`, hence
the two-entry `PYTHONPATH`.

---

# 10. Roadmap defence

### Why is Phase 1 not just "connect the vendors"?

Because the write path has to be fixed first, or every integration built on it
gets rewritten. Two reasons:

- **Cost:** 2.5 GB/day at four vendors is ~6 GB/day at eight, ~180 GB/month of
  data that is 39.5% duplicate polled state and 76% raw vendor JSON. Fix first and
  the same eight vendors produce under 100 MB/day.
- **Correctness:** device references resolve at 3.1% today. A visibility platform
  with wrong device counts is not visibility. With eight vendors the problem
  triples.

### Why is correlation Phase 2 and not Phase 1?

It depends on identity resolution and correct topology direction, both of which
are Phase 1 work. Building correlation on a 3.1% join rate is why the current
engine has produced zero cascade incidents.

### Why is RCA last?

It needs everything else: correct incidents from Phase 2, path data from Phase 4,
state history from Phase 1. An LLM given today's data would reason over 29,500
duplicate incidents with no root cause, no path, and no state history. It would
produce confident nonsense.

### What is the biggest risk?

The correlation engine producing plausible but wrong root causes. It is worse than
no correlation, because engineers act on it and lose trust permanently after the
first wrong call.

Mitigation: a NOC engineer validates output during Phase 2 before it is shown as
authoritative; confidence is displayed honestly; the evidence chain for every
conclusion is visible so a claim can be checked.

### What would you cut if time were halved?

Phase 5 first — it is the highest-visibility and lowest-certainty item. Then the
map/floorplan half of Phase 3, keeping the hierarchy tree. Phases 1 and 2 are the
product; everything after is depth.

---

# 11. Numbers to know cold

| Fact | Value |
|---|---|
| Events stored | 1.38M |
| Of which polled state, not state change | <0.1% post-WP-0 (was 39.5%) |
| Database size | 2.1 GB |
| `raw_event` share | 877 MB (7-day debug window) |
| Growth, 4 vendors | ~1 MB/day events (steady state) |
| Target steady state | ~400 MB |
| Incidents | 11,085 |
| Incidents ever updated | 0 |
| Distinct incident titles | 89 |
| Most repeated title | 12,601 × |
| Cascade incidents ever | 0 |
| Device→topology resolution | 3.1% (54/1,715) |
| Resolution after fix | 1,480/1,715 |
| Topology nodes / edges | 2,731 / 3,442 |
| Collectors | 21 |
| Sites | 153 |
| Tests passing | 418/418 |
| Correlation cycle time | ~850 ms |
| Slowest collector | 252 s (`mist-inventory`) |
| Mist API calls per pass | ~900 |
| Container memory in use | ~600 MB |

---

# 12. Questions to ask back

Signals engagement rather than defensiveness:

- Is there an existing tool in the estate already attempting this that we should
  evaluate before building further?
- Who owns the authoritative site/facility list? Nobody currently does, and Phase 3
  needs it.
- What is the expected support posture — best-effort, or does someone get called?
- Is there a data classification precedent for sending telemetry to an external
  API? That determines whether Phase 5 is months or weeks.
- Do Arista WLC and ClearPass have APIs enabled and reachable today?
