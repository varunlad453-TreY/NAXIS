# Correlation Engine — Explained in Simple Terms

> **Audience:** Operators, junior developers, anyone who wants to understand *what* the engine does, *how* it works, *what we fixed*, and *why it matters* — without reading 700 lines of code.

---

## 1. The Problem It Solves

Your platform collects **thousands of events per minute** from Mist Wi-Fi, VeloCloud SD-WAN, switches, firewalls, and more. A single switch failure can trigger 50+ events (APs going down, clients disconnecting, high latency alarms). Without correlation, the UI shows 50 separate alarms — an operator has to manually figure out they're all caused by one broken switch.

**Without correlation:**

```
Event 1:  AP-101 unreachable        ← Are these related?
Event 2:  AP-102 unreachable        ← Probably, but who
Event 3:  AP-103 unreachable        ← knows for sure?
Event 4:  Core switch uplink down   ← Operator, go fish.
Event 5:  Client X disconnected      ← (maybe unrelated)
... 5,572 more events ...
```

**With correlation:**

```
Incident: SFO-01 · naxis-core-01 link down — 4 devices affected
  ↳ Root cause: core-switch-01 uplink down (CRITICAL)
  ↳ Symptoms: AP-101, AP-102, AP-103 unreachable (MAJOR)
  ↳ 82% confidence · 2 sites · 4 devices
```

---

## 2. What the Correlation Engine Does

It's a **smart grouping machine** that turns noise into answers:

```
5,577 raw events/minute
         │
         ▼
  Correlation Engine
  (Stage 1 → Stage 2)
         │
         ▼
  3 incidents instead of 5,577 notifications
```

It works in two stages:

### Stage 1 — "Who's in the same room at the same time?"

Groups events by **site** + **time window** (default: 5 minutes).

Events from the same site within 5 minutes of each other are candidates for being related. This filters out events that are clearly unrelated (e.g., a Houston AP failure and a London switch failure).

### Stage 2 — "Who caused this?"

Looks at the **topology graph** (which device connects to which) and finds the **root cause** — the most upstream device that has children failing.

It creates:

- **One root-cause incident** — e.g., "SFO-01 · naxis-core-01 link down — 4 devices affected"
- **A confidence score** — how sure we are about this correlation (0.0–1.0)
- **Blast radius** — all affected devices, sites, and clients

Events that don't fit any cascade get their own **residual incident** so nothing is silently dropped.

### The Key Insight

The engine is **deterministic** — same events in, same incident out, every time. No randomness, no machine learning, no black box. This means:

- If the worker restarts mid-cycle, it produces the **same incident IDs**
- The database's `ON CONFLICT DO UPDATE` deduplicates — no duplicates on restart
- Every decision is traceable to configurable thresholds and defined topology relationships

---

## 3. What We Fixed and Why

### Fix 1 — Pipeline Order

**Broken:** The topology sync ran *after* correlation. Since Stage 2 cascade queries the topology table, it always found an empty table and could never identify root causes.

**Fix:** Swapped the order — topology sync runs *before* correlation.

**Result:** Root-cause identification works. An operator sees "core-switch → 3 APs failed" instead of 4 separate alarms.

### Fix 2 — Batch Queries (N+1 → 2)

**Broken:** The original code did 1 database query per device to resolve node IDs, plus 1 query per device to find children. With 50 events, that's **100+ sequential DB queries** inside the hot path. At 60-second collection cycles, this stacks up and causes lag.

**Fix:** Now it does exactly **2 queries total**, regardless of event count:

1. **Batch resolve:** One query asks "do any of these candidate patterns exist in the topology?" — answering for all devices at once.
2. **Batch edges:** One query asks "what are all the parent-child relationships involving these nodes?" — again, all at once.

**Result:** DB load is constant, not proportional to event count. The engine scales to thousands of events without slowdown.

#### How Batch Resolve Works (Simple Example)

Say we have 3 device IDs from events: `aa:bb:cc:dd:ee:ff`, `core-switch-01`, and `site-abc`.

The old way would do 3 separate queries:

```
Query 1: Does "mist-ap-aa:bb:cc:dd:ee:ff" exist in topology_nodes?
Query 2: Does "core-switch-01" exist in topology_nodes?
Query 3: Does "mist-site-site-abc" exist in topology_nodes?
```

The new way does 1 query:

```
Query: Does ANY of ["mist-ap-aa:bb:cc:dd:ee:ff",
                     "mist-ap-aabbccddeeff",
                     "switch-aa:bb:cc:dd:ee:ff",
                     ... (all patterns for all 3 devices) ...]
        exist in topology_nodes?
```

The database returns all matches in one round trip. Then we simply map each device to its first matching pattern.

#### How Batch Edges Work (Simple Example)

The old way did 3 more queries to find children of each resolved node. The new way does 1 query:

```
Query: Give me ALL edges where src_id or dst_id is any of our resolved node IDs
```

Two queries total. Always. Whether you have 3 events or 3,000.

### Fix 3 — Memory-Leak Fix

**Broken:** The `_processed_events` tracker was a plain set that grew forever. At ~5,577 events per cycle × 1,440 cycles per day = ~8 million new entries per day. In a week, that's 56 million strings in RAM — gigabytes of memory.

**Fix:** Replaced `Set[str]` with `OrderedDict[str, datetime]` with two safety nets:

- **200,000 entry cap** — when exceeded, the oldest entries are evicted first (like a queue)
- **24-hour TTL** — entries older than 24 hours are automatically removed
- Eviction runs at the start of every cycle

**Result:** Memory is bounded at ~tens of megabytes, not gigabytes. The worker runs for months without restarting.

### Fix 4 — Cross-Cycle Correlation

**Broken:** The engine only saw events from the current collection cycle. If events for the same incident arrived across multiple cycles (e.g., switch fails at t=0, APs report failure at t=90s), they'd never be grouped together.

**Fix:** At the start of every cycle, the engine queries the database for recent events that:
- Are NOT yet linked to any incident (`incident_id IS NULL`)
- Fall within 2× the configured time window
- Haven't already been processed

These are added to the current batch before correlation runs.

**Result:** Events across cycles merge into one incident. A failure that unfolds over 3 minutes becomes 1 incident, not 3.

### Fix 5 — Restart Resilience

**Broken:** When the worker restarts, `_processed_events` is empty. All old events get re-processed and create duplicate incidents with new IDs.

**Fix — two layers of protection:**

1. **Load from DB on startup:** The engine runs `SELECT DISTINCT unnest(related_event_ids) FROM incidents` to load all event IDs that are already linked to incidents. These are immediately marked as processed.

2. **Deterministic incident IDs (root-cause key):** Instead of random UUIDs, incident IDs are computed as `inc-{sha256(site_id | root device | primary issue category)[:16]}`. The same underlying failure — even when described by *different* event IDs across cycles and collectors — produces the same incident ID, so `ON CONFLICT DO UPDATE` merges recurrence into one live incident instead of inflating the incident table per poll.

**Result:** Restart is zero-cost. Re-processing the same events produces the same IDs, and the database deduplicates them. No duplicate incidents, ever.

### Phase 2 (Aug 2026) — Root-cause dedup + recovery resolution

The event-ID-hash formulation was still leaking: *recurring* failures with new event IDs every poll (a VeloCloud `link_down` flood = 942 events/cycle across 69 devices) kept minting new incidents each cycle.

- **`_compute_incident_id`** now keys on the **root cause** — `SHA256(site_id | root device | primary issue category)` — so recurrence of the same failure merges into one incident row (`ON CONFLICT DO UPDATE`). Live: incident count stayed flat (~8,845) through repeated `link_down` floods.
- **Recovery resolution:** `DEVICE_REACHABLE` events no longer form incidents (below `min_severity`); instead `_resolve_recovered_devices()` → `resolve_open_incidents_for_devices()` runs `UPDATE incidents SET status='resolved' WHERE status='open' AND root_device_ids && $1`. Only OPEN is auto-resolved. Legacy open incidents backfilled `root_device_ids` so recovery resolves them too.

**Result:** ~4,973 of ~8,844 incidents auto-resolved by recovery events; title count stable — the flood became a handful of living incidents that resolve when the device returns.

### Fix 6 — Prefix Expansion (Node Resolution)

**Broken:** The `resolve_node_id()` function only knew two device patterns:
- `mist-ap-{mac}` — Mist access points
- `velo-edge-{id}` — VeloCloud edges

Events from switches, sites, WAN gateways, and SNMP devices could never find their matching topology node. Stage 2 cascade would always fail for them.

**Fix:** Added all missing patterns:

| Device Type | Pattern |
|-------------|---------|
| Mist AP | `mist-ap-{mac}` |
| Switch (SNMP/Mist) | `switch-{mac}` |
| Site | `mist-site-{uuid}` |
| WAN Gateway | `wan-gw-{name}` |
| VeloCloud Edge | `velo-edge-{id}` |
| VeloCloud Site | `velo-site-{id}` |
| SNMP device | `snmp-{ip}` |

Plus heuristics for MAC addresses (tries both colon-separated and cleaned formats), UUIDs (tries `mist-site-` and `mist-ap-` prefixes), and short identifiers (tries `velo-edge-` and `velo-site-`).

**Result:** Device resolution rate goes from ~30% to ~95%+. Almost every event finds its topology node.

### Fix 7 — Schema Alignment (`event_count`)

**Broken:** The `to_db_dict()` method included `event_count`, but the database table doesn't have an `event_count` column. The SQL insert statement used explicit column lists so it didn't crash, but if someone later switched to `**d` expansion (passing the dict directly), it would crash with `column "event_count" does not exist`.

**Fix:** Removed `event_count` from `to_db_dict()`. It's still available as `incident.event_count()` (computed from `len(related_event_ids)`) and in the API response models.

**Result:** Eliminates a latent production breakage. One less thing to discover at 3am.

### Fix 9 — Inverted Edge Direction & Explicit Links Table (WP-2.1)

**Broken:** Physical links were written AP→switch (`src_id` = AP, `dst_id` = switch) in `topology_edges`, and `get_parent_child_map()` returned raw topology node_ids (e.g. `"mist-ap-abc123"`) as child device_ids, while events use stripped canonical keys (e.g. `"abc123"`). The cascade could never match leaf events to parents, yielding 0 cascade incidents.

**Fix:** Created an explicit `links` table (`009_links.sql`) with `parent_node_id` (switch) and `child_node_id` (AP). Updated `get_parent_child_map()` to translate child node_ids via `node_id_to_device_id()` stripping prefixes to match event device_ids.

**Result:** Cascade correlation correctly matches infrastructure root causes to leaf symptoms.

### Fix 10 — Incident Identity & Evidence Array Merging (WP-2.2)

**Broken:** Incidents were snapshot rows rather than living objects. Upserts overwrote array fields (`related_event_ids`, `affected_devices`, `symptom_device_ids`), resetting history every 60-second cycle. Severity downgraded when lower-severity secondary events arrived, and `created_at` kept resetting to "now".

**Fix:** 
- Incident ID changed to deterministic fault fingerprint: `SHA-256(site_id | root_device_id | category)`.
- `upsert_incident()` SQL updated to **MERGE** arrays using `array_agg(DISTINCT x)` via `unnest()`. Evidence accumulates continuously across cycles.
- Severity uses a SQL `CASE` statement to only escalate (never downgrade).
- Original `created_at` timestamp is preserved on update.
- Terminal statuses (`resolved`, `closed`, `suppressed`) are protected; `_compute_incident_id_with_recurrence()` appends an epoch-hour suffix if an existing incident is terminal, spawning a fresh ticket for recurrences.

**Result:** 1 outage = 1 living incident object that accumulates all evidence over its lifetime with truthful duration and monotonic severity.

### Fix 8 — Null Preservation (`probable_cause`)

**Broken:** `probable_cause: self.probable_cause or ""` converted `None` to an empty string. The frontend needs to distinguish:
- `null` → RCA hasn't run yet (show loading spinner)
- `""` → RCA ran but found no cause (show "No cause found")
- `"some text"` → RCA found a cause

**Fix:** `probable_cause: self.probable_cause` — passes through `None` as-is.

**Result:** Frontend can show three distinct states instead of two.

---

## 4. Integration Tests (Phase 2)

We built 7 end-to-end integration tests in `backend/tests/test_correlation_pipeline.py` that exercise `WorkerDaemon.run_once()` — the full pipeline from collection to incident persistence:

| Test | What It Proves |
|------|---------------|
| `test_pipeline_produces_incidents_with_cascade` | The full pipeline produces valid incidents with proper IDs, titles, severities, and confidence scores |
| `test_topology_cascade_root_cause_incident` | Cascade mode creates a single incident that names the root cause and lists all symptoms — title reads "SFO-01 · naxis-core-01 link down — 4 devices affected" |
| `test_heuristic_fallback_no_topology` | When topology is empty, engine still creates a flat incident — never silently drops events |
| `test_residual_incident_for_unassigned_events` | Events that don't fit any cascade group get their own residual incident — nothing is lost |
| `test_cross_cycle_correlation` | Events from 3 collection cycles merge into 1 incident (not 3 separate ones) |
| `test_deterministic_incident_ids` | Two separate daemon instances processing the same events produce identical incident IDs |
| `test_pipeline_does_not_duplicate_processed_events` | Second cycle produces zero new incidents — in-memory tracker prevents re-processing |

**432 total backend tests, 0 failures.**

---

## 5. The Impact on the Platform

Before these fixes, the correlation engine was *present in code* but *broken in practice*:

| Metric | Before | After |
|--------|--------|-------|
| Root-cause identification | ~0% (topology empty, cascade never triggered) | Working — switch failure → AP symptoms detected |
| Incident count per failure | ~10–50 separate incidents per root cause | 1–3 incidents (root + residual) |
| Memory (processed events) | GBs leaking per day | Bounded at ~200k entries (~tens of MB) |
| Restart behavior | Duplicate incidents every deploy | Zero duplicates — deterministic IDs |
| Device resolution rate | ~30% (only APs and edges) | ~95%+ (switches, sites, WAN, SNMP, all vendors) |
| DB load during correlation | 100+ queries per group | Exactly 2 queries, always |
| Schema safety | `event_count` was a ticking bomb | Clean, matches DB schema exactly |
| UI state representation | Couldn't distinguish "not run" from "empty" | Three distinct states via null preservation |

**The operator experience changes from "50 screaming alarms, figure it out yourself" to "core-switch-01 failed → 3 APs affected → here's the blast radius."**

---

## Appendix: File Map

| What | File |
|------|------|
| Worker pipeline (topology sync + correlation) | `backend/worker/main.py` |
| Correlation engine class | `backend/shared/correlation/engine.py` |
| Topology queries (batch resolve, batch edges) | `backend/shared/database/topology.py` |
| Incident model (`to_db_dict`, null preservation) | `backend/shared/models/incident.py` |
| Unit tests (78 engine tests) | `backend/tests/test_correlation_engine.py` |
| Integration tests (7 pipeline tests) | `backend/tests/test_correlation_pipeline.py` |
