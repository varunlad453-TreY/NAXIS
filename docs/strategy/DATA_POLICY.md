> **Appendix (2026-08-04) — current-state bridge.** Appended by the Naxis team (original text untouched); see `PLAN_GAP.md` for the gap map + execution plan.
>
> **Verified today:**
> - `raw_event` is **already 100% NULL** in the live DB — the 7.6 GB / PII exposure described below is effectively already gone (DB at **6.5 GB**, from 10). WP-0.4 formalizes it by removing the write path.
> - The polled-state emitters this doc warns about (39.5%, 448k reachability rows, 784k RF-stats-as-events, 103k "Edge New Device") **still run** → WP-0.3.
> - `retention.py` still errors every cycle (`created_at` vs `recorded_at`); `EVENT_RETENTION_DAYS=90` still read by no code → WP-0.1/0.2.
> - No `devices`/`device_identities`/`sites` identity tables yet → WP-1.
> - **Team decision:** the "Truncate events + incidents" item is deferred until after the Phase 2 identity/edge fixes (WP-2.3) — see `PLAN_GAP.md` §5.

---

# NAXIS.ai — Data Policy

What we store, what we cache, what we never store. Written 2026-07-31.

## The rule

**Cache what a vendor already knows. Store only what Naxis creates.**

A cache is a short-lived copy of vendor truth — TTL'd, disposable, rebuilt on
demand, loss costs nothing. A store is a system of record for something no
vendor console holds — loss is unrecoverable.

## Where the current 10 GB went

Measured 2026-07-31 against the live database.

| Category | Rows | raw_event | Verdict |
|---|---|---|---|
| performance | 884,163 | **4,963 MB** | metrics stored as events |
| system | 832,573 | **3,046 MB** | polled reachability re-emission |
| connectivity | 424,667 | 239 MB | genuine alarms — the valuable part |
| application | 243,604 | 63 MB | VeloCloud app visibility, low value |
| security | 570 | 258 kB | keep |
| configuration | 531 | 295 kB | keep |

8 GB of 10 GB is `raw_event` on two categories that should not be events at all.
The genuinely useful signal — connectivity, security, configuration — is under
240 MB.

39.5% of all 2,215,589 events are polled state re-emitted every cycle rather than
state changes:

- `device_unreachable` — 448,812 rows. `backend/worker/collectors/mist_topology.py:157`
  writes a fresh CRITICAL row with a new UUID every 5 minutes per disconnected
  AP. One AP produced 335 identical rows.
- `"Edge New Device"` — 103,600 rows.
- RF Stats — 784,869 rows of metrics stored as events.
- VeloCloud re-ingests the same vendor event each poll — `source_event_id=12538`
  produced 336 rows across 336 distinct timestamps.

Growth is 2.5 GB/day at four vendors. Eight vendors on the same write path is
roughly 6 GB/day. This violates the diff-on-write rule in `CLAUDE.md`.

## The six things we store

Nothing else is ever persisted.

| # | What | Phase | Why no vendor has it | Size |
|---|---|---|---|---|
| 1 | Cross-vendor identity map | 1 | No vendor knows a Mist AP MAC and a DNAC switch port are the same adjacency | ~5 MB |
| 2 | Events captured while nobody watched | 2 | A 03:00 flap that recovered by 03:02 does not exist to an on-demand query | ~50 MB rolling |
| 3 | Incidents + denormalized evidence | 2 | Naxis creates these | ~100 MB/yr |
| 4 | Baselines / rollups | 2 | Vendor consoles show current, not "3× normal for this link" | ~100 MB |
| 5 | Audit — logins, role changes, diagnostics run against gear | 1, 4 | Compliance | ~10 MB/yr |
| 6 | Users, roles, locations | 1, 3 | Ours | ~10 MB |

Item 4 is conditional. It exists only because Phase 2's goal includes "where can
we improve connectivity," which is a baseline question. ~100 MB buys hourly
WAN-link and daily AP trends for 90 days. Drop it and Phase 2 does fault
localization only — no trending, permanently.

### Retention

| Table | Retention |
|---|---|
| `devices`, `device_identities`, `sites`, `interfaces`, `links` | current state, indefinite |
| `device_state_history`, `link_state_history` | indefinite, diff-on-write only |
| `incidents`, `incident_evidence` | indefinite |
| `events` | 24–48h working buffer, alarms only, no `raw_event` |
| `metrics_rollup` | hourly 90d (WAN links), daily 90d (radios), daily 2y (sites) |
| `clients` | current association 7d, session history 30d |
| `audit_log`, `diagnostic_runs`, `llm_calls` | 1 year |
| `collector_run_ledger` | 7d |
| `raw_event` | **not stored** |

Steady state: ~400 MB, from 10 GB today. Ingest under 100 MB/day at eight
vendors, from 2.5 GB/day at four.

`EVENT_RETENTION_DAYS=90` exists in `config/.env` and is read by no code —
`events` has never been pruned. `backend/shared/database/retention.py` only trims
three telemetry tables. It also logs
`correlation_telemetry: column "created_at" does not exist` every cycle.

## Never stored

- Vendor credentials, tokens, session cookies in any payload
- Packet captures, flow payloads
- **Netskope per-user URL / browsing history.** Aggregate tunnel health only. A
  network platform holding employee browsing history changes what the platform
  legally is.
- **ClearPass full auth transcripts.** Auth success/failure and method only,
  never credentials.
- `raw_event` — dropped entirely
- Client PII in any LLM payload (Phase 5)

## PII currently in the database

None of this was a decision. It arrived because `raw_event` captures whole vendor
payloads verbatim.

| Key | Events | What it is |
|---|---|---|
| `xy_coords` | 510,285 | AP floor coordinates — with client association, physical people-location data |
| `hostnames` | 25,127 | employee device names, typically `firstname-laptop` |
| `user_agent` | 4,555 (15 distinct) | client OS / browser |
| `admin_name` | 3,924 (51 distinct) | named admins from Mist audit logs |
| `username` | 0 | clean today; ClearPass will introduce it |

Dropping `raw_event` removes all of it in one move. That is the single largest
privacy win available and it costs nothing we want to keep.

### Redaction at ingest

`backend/shared/utils/redaction.py` currently only scrubs URL passwords. Extend
it to strip `hostnames`, `user_agent`, `admin_name`, and to hash client MACs
where identity is not needed.

Ingest-time, before write — never read-time. Once PII is written it becomes a
compliance artifact regardless of whether anything reads it.

## Cached, not stored

Everything else. 60s TTL, Redis or a `cache_*` table, keyed by vendor + resource.

Device inventory, current reachability, per-site views, current metric values,
client current association, topology as the vendor reports it.

Cache-first is not free: measured vendor latency is up to 252 s for a full Mist
inventory pass and ~900 API calls across 153 sites. Naked pass-through per
dashboard load would get us throttled. The cache is mandatory, not an
optimization. See `ARCHITECTURE.md` for the measured numbers.

## Open questions

- **Client MAC.** Plaintext in the 7-day hot window then hashed (Phase 4's MAC
  lookup needs plaintext), or hashed throughout? Recommendation: plaintext 7d,
  then hashed. Policy call.
- **Netskope.** Confirm aggregate-only in writing. If per-user is ever wanted it
  should be an explicit decision, not drift.
