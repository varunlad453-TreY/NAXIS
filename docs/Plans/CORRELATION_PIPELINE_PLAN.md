# Correlation Pipeline — Full Wiring Plan

> **Goal:** Wire the correlation engine into the worker pipeline so it produces real, correct incidents from live Mist data — with topology-aware root cause identification, blast radius computation, and production-grade reliability. No dangling threads, no workarounds, no "later."

**Date:** 2026-07-17
**Status:** Planned

---

## Current State

The correlation engine is already instantiated in `WorkerDaemon` (`worker/main.py:84-98`) and called in every cycle (`worker/main.py:132-149`). Engine has 78 passing unit tests. However, **8 defects** prevent it from producing correct incidents in production:

| # | Defect | File | Impact |
|---|--------|------|--------|
| 1 | Pipeline order: Topology sync runs AFTER correlation | `worker/main.py:132` vs `:152` | Stage 2 cascade finds empty topology every cycle |
| 2 | `DatabaseTopologyProvider` N+1 queries per device | `shared/database/topology.py:272-300` | ~100+ DB round trips per correlation group |
| 3 | `_processed_events` unbounded memory growth | `shared/correlation/engine.py:71` | Memory leak, ~8M IDs/day |
| 4 | No cross-cycle correlation — engine only sees current batch | `shared/correlation/engine.py:73-182` | Events spanning multiple collection cycles never form incidents |
| 5 | No worker restart resilience | `shared/correlation/engine.py:71` | Duplicate incidents on restart |
| 6 | `resolve_node_id()` missing prefix patterns | `shared/database/topology.py:28-46` | Switch/site events never resolve to topology nodes |
| 7 | `to_db_dict()` returns `event_count` not in DB schema | `shared/models/incident.py:217` | Schema mismatch, latent breakage risk |
| 8 | `probable_cause` sent as `""` instead of `None` | `shared/models/incident.py:215` | Frontend can't distinguish "not enriched" from "enriched empty" |

---

## Phase 1: Fix the Bugs (8 tasks)

### Task 1: Fix Pipeline Order

**File:** `worker/main.py`

**Current (broken):**
```
line 134: incidents = await self._correlation_engine.process_events(all_events)
line 153: await self._topology_sync.sync()
```

**Fix:** Swap the order so topology is populated before correlation runs:
```
line 134: await self._topology_sync.sync()
line 153: incidents = await self._correlation_engine.process_events(all_events)
```

**Why:** `TopologyCascadeRule.evaluate()` calls `provider.get_parent_child_map()` which queries `topology_edges`. If `TopologySync` hasn't run yet, the table is empty, the cascade finds no parent-child relationships, and falls back to device-type heuristics — or returns nothing.

**Verification:**
- Log line `"Topology sync complete"` appears before `"Processing N events for correlation"`
- `GET /topology` returns populated graph before incidents are computed

---

### Task 2: Batch DatabaseTopologyProvider Queries

**File:** `shared/database/topology.py` — `get_parent_child_map()` method (lines 272-300)

**Current (N+1 pattern):**
```python
for device_id in device_ids:
    node_id = await resolve_node_id(device_id)
    if not node_id:
        continue
    children = await get_children(node_id)  # 1 query per device
```

With 50 events in a group, this does 50 `resolve_node_id()` calls + 50 `get_children()` calls = 100+ serial DB round trips inside the correlation hot path.

**Fix — Single batch query:**
```python
async def get_parent_child_map(self, device_ids: Set[str]) -> Dict[str, List[str]]:
    if not device_ids or not db.pool:
        return {}

    # Single query: resolve all device_ids to node_ids
    rows = await db.fetch(
        """
        SELECT e.src_id, e.dst_id
        FROM topology_edges e
        WHERE e.src_id = ANY($1) OR e.dst_id = ANY($1)
        """,
        list(device_ids),
    )

    if not rows:
        return {}

    # Check which device_ids are children (have incoming edges)
    child_to_parent: Dict[str, List[str]] = {}
    for row in rows:
        src, dst = row["src_id"], row["dst_id"]
        if dst not in child_to_parent:
            child_to_parent[dst] = []
        child_to_parent[dst].append(src)

    # Build parent → children map: device_ids that appear as dst
    result: Dict[str, List[str]] = {}
    for device_id in device_ids:
        if device_id in child_to_parent:
            result[device_id] = child_to_parent[device_id]

    return result
```

**Bonus:** Also batch `resolve_node_id()`:
```python
async def batch_resolve_node_ids(device_ids: Set[str]) -> Dict[str, Optional[str]]:
    """Resolve multiple device_ids to node_ids in one query."""
    if not device_ids:
        return {}

    # Build all candidate patterns
    candidates = []
    for did in device_ids:
        for pattern in _known_node_id_patterns(did):
            candidates.append(pattern)

    if not candidates:
        return {}

    rows = await db.fetch(
        "SELECT node_id FROM topology_nodes WHERE node_id = ANY($1)",
        candidates,
    )
    resolved = {r["node_id"] for r in rows}

    result: Dict[str, Optional[str]] = {}
    for did in device_ids:
        for pattern in _known_node_id_patterns(did):
            if pattern in resolved:
                result[did] = pattern
                break
        else:
            result[did] = None

    return result
```

**Verification:**
- `get_parent_child_map()` executes exactly 1 SQL query regardless of device count
- Same results as the N+1 version for the same topology data

---

### Task 3: Cap and TTL `_processed_events`

**File:** `shared/correlation/engine.py:71` and `process_events()`

**Current:**
```python
self._processed_events: Set[str] = set()
```

Grows unbounded. With 5,577 events/cycle at 60s intervals, ~8M entries/day. No eviction.

**Fix — Use `OrderedDict` as LRU + persist to DB:**

```python
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

MAX_PROCESSED_EVENTS = 200_000
PROCESSED_TTL_HOURS = 24


class CorrelationEngine:
    def __init__(self, ...):
        ...
        self._processed_events: OrderedDict[str, datetime] = OrderedDict()
        self._max_processed = MAX_PROCESSED_EVENTS
        self._processed_ttl = timedelta(hours=PROCESSED_TTL_HOURS)

    def _is_event_processed(self, event_id: str) -> bool:
        return event_id in self._processed_events

    def _mark_processed(self, event_id: str) -> None:
        now = datetime.now(timezone.utc)
        self._processed_events[event_id] = now
        self._processed_events.move_to_end(event_id)

        # Evict oldest if over cap
        while len(self._processed_events) > self._max_processed:
            self._processed_events.popitem(last=False)

    def _evict_expired(self) -> None:
        """Remove events older than TTL."""
        cutoff = datetime.now(timezone.utc) - self._processed_ttl
        expired = [
            eid for eid, ts in self._processed_events.items()
            if ts < cutoff
        ]
        for eid in expired:
            del self._processed_events[eid]
```

Also call `_evict_expired()` at the start of each `process_events()` cycle.

**Verification:**
- `_processed_events` never exceeds `MAX_PROCESSED_EVENTS + batch_size`
- Events older than 24h are re-processable if they reappear
- Worker memory usage is stable over hours of operation

---

### Task 4: Cross-Cycle Correlation (Sliding Window)

**File:** `shared/correlation/engine.py:73-182`

**Current:** Engine only processes the current batch. Events from cycle A (t=0s) and cycle B (t=120s) in the same 5-min window are never correlated together.

**Fix — Query unlinked events in time window before processing:**

```python
async def process_events(self, events: List[UnifiedEvent]) -> List[Incident]:
    if not events:
        return []

    # Prune stale markers
    self._evict_expired()

    # Filter out already-processed
    new_events = [e for e in events if not self._is_event_processed(e.event_id)]
    if not new_events:
        return []

    # Query DB for recent unlinked events that might complete time windows
    try:
        from shared.database.client import db
        window_seconds = self.config.time_window_seconds
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=window_seconds * 2)
        db_events = await get_recent_events(since=cutoff)
        # Filter to only unprocessed, unlinked events
        for db_event in db_events:
            if (
                not self._is_event_processed(db_event.event_id)
                and db_event.event_id not in {e.event_id for e in new_events}
                and db_event.incident_id is None
            ):
                new_events.append(db_event)
    except Exception:
        logger.warning("Could not fetch recent DB events for cross-cycle correlation", exc_info=True)

    logger.info(
        "Processing %d events (%d new, %d from DB history)",
        len(new_events),
        len([e for e in events if not self._is_event_processed(e.event_id)]),
        max(0, len(new_events) - len([e for e in events if not self._is_event_processed(e.event_id)])),
    )

    # Proceed with existing Stage 1 → Stage 2 pipeline
    ...
```

**Why this is safe:**
- `incident_id IS NULL` ensures we don't re-process already-correlated events
- `get_recent_events` queries with `timestamp >= cutoff` — bounded query, not full table scan
- Engine's existing dedup (`_is_event_processed`) prevents duplicate processing

**Verification:**
- Insert 3 events at t=0s, t=90s, t=180s across 3 worker cycles
- All 3 are correlated into a single incident (not 0 or 3 separate)

---

### Task 5: Worker Restart Resilience

**Files:** `shared/correlation/engine.py`, `worker/main.py`

**Current:** On restart, `_processed_events` is empty. All past events re-processed, creating duplicate incidents with new IDs.

**Fix — Load processed event IDs from DB + deterministic incident IDs:**

**A. Load existing processed IDs on startup (in `CorrelationEngine.__init__`):**
```python
async def _load_processed_from_db(self) -> None:
    """On startup, load event IDs already linked to incidents so we
    don't re-process them."""
    try:
        rows = await db.fetch(
            "SELECT DISTINCT unnest(related_event_ids) AS eid FROM incidents"
        )
        now = datetime.now(timezone.utc)
        for row in rows:
            eid = row["eid"]
            if eid:
                self._processed_events[eid] = now
        logger.info(
            "Loaded %d processed event IDs from incidents table",
            len(self._processed_events),
        )
    except Exception:
        logger.info("No existing incidents found — starting fresh")
```

**B. Make incident_id deterministic from its root cause (implemented):**
```python
@staticmethod
def _compute_incident_id(events: List[UnifiedEvent], root_device_id: str = None) -> str:
    """Deterministic incident ID from the root-cause key:
    (site_id, root device, primary issue category).

    New events describing the same underlying failure (different cycles,
    different collectors) produce the same incident_id, so upsert_incident's
    ON CONFLICT DO UPDATE merges them into one live incident instead of
    creating duplicates."""
    site_id = next((e.device.site_id for e in events if e.device and e.device.site_id), "")
    if not root_device_id:
        root_device_id = CorrelationEngine._primary_device_id(events)
    category = Counter(e.category.value for e in events).most_common(1)[0][0]
    material = f"{site_id}|{root_device_id or 'unknown'}|{category}"
    return f"inc-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:16]}"
```

Flat incidents also set `root_device_ids` (the highest-severity device) so
recovery matching has a root to match against.

**Recovery resolution:** `DEVICE_REACHABLE` (INFO) events no longer form
incidents (they are filtered below `min_severity`). Instead `process_events`
collects them each cycle and resolves OPEN incidents whose root device
recovered via `resolve_open_incidents_for_devices()`:

```sql
UPDATE incidents
SET status = 'resolved', updated_at = NOW()
WHERE status = 'open' AND root_device_ids && $1::text[];
```

Only `open` incidents are auto-resolved; operator-managed states
(INVESTIGATING, MITIGATED, ...) are left alone.

**Verification (Phase 2):**
- Restart worker, same root cause flows repeatedly → incident count stays flat
- `device_unreachable` (root set) → `device_reachable` → incident status `resolved`
- Suite: 364 passed / 10 pre-existing failures

---

### Task 6: Expand `resolve_node_id()` Prefix Patterns

**File:** `shared/database/topology.py:28-46`

**Current patterns:**
```python
candidates = [device_id]
if _looks_like_mac(device_id):
    candidates.append(f"mist-ap-{device_id}")
if "edge" in device_id.lower():
    candidates.append(f"velo-edge-{device_id}")
```

This misses most node types that topology_sync creates:
- `mist-site-{uuid}` — site nodes
- `switch-{mac}` — SNMP/Mist-discovered switches
- `wan-gw-{name}` — internet gateways
- `velo-site-{id}` — VeloCloud site nodes

**Fix — Expand patterns to cover all node types:**
```python
def _known_node_id_patterns(device_id: str) -> List[str]:
    candidates = [device_id]

    cleaned = device_id.replace(":", "").replace("-", "").replace(".", "")
    is_mac = len(cleaned) == 12 and all(c in "0123456789abcdefABCDEF" for c in cleaned)

    if is_mac:
        candidates.append(f"mist-ap-{device_id}")
        candidates.append(f"switch-{device_id}")

    # Try vendor prefixes
    candidates.append(f"mist-site-{device_id}")
    candidates.append(f"velo-site-{device_id}")
    candidates.append(f"velo-edge-{device_id}")
    candidates.append(f"wan-gw-{device_id}")

    # Try as-is with common hyphens/colons stripped for MAC-based node IDs
    if is_mac:
        candidates.append(f"mist-ap-{cleaned}")
        candidates.append(f"switch-{cleaned}")

    # Try UUID-style patterns (site IDs, device UUIDs)
    if len(device_id) == 36 and device_id.count("-") == 4:
        candidates.append(f"mist-site-{device_id}")
        candidates.append(f"mist-ap-{device_id}")

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique
```

**Verification:**
- Events referencing switches (`device_id` = MAC) resolve to `switch-{mac}` nodes
- Events referencing sites resolve to `mist-site-{uuid}` nodes
- Events referencing edges resolve to `velo-edge-{id}` nodes
- All existing patterns (mist-ap-, velo-edge-) still work

---

### Task 7: Remove `event_count` from `to_db_dict()`

**File:** `shared/models/incident.py:217`

**Current:**
```python
def to_db_dict(self) -> Dict[str, Any]:
    return {
        ...
        "event_count": self.event_count(),  # NOT in DB schema
        ...
    }
```

The DB schema has no `event_count` column. The SQL in `upsert_incident` lists columns explicitly (not `**d` expansion), so this doesn't crash — but it's a latent breakage risk. If someone later switches to `**d` expansion, it will fail with `column "event_count" does not exist`.

**Fix:**
```python
def to_db_dict(self) -> Dict[str, Any]:
    return {
        "incident_id": self.incident_id,
        "title": self.title,
        "severity": self.severity.value,
        "status": self.status.value,
        "affected_sites": list(self.affected_sites),
        "affected_devices": list(self.affected_devices),
        "affected_clients": list(self.affected_clients),
        "related_event_ids": list(self.related_event_ids),
        "probable_cause": self.probable_cause or "",
        "confidence_score": float(self.confidence_score),
        "created_at": self.created_at,
        "updated_at": self.updated_at,
    }
```

The `event_count` is already available via `incident.event_count()` (computed from `len(related_event_ids)`) or from the API models (`incident_models.py` line 26 has `event_count` as a computed field).

**Verification:**
- `test_correlation_engine.py::TestIncidentModel::test_to_db_dict` updated to not expect `event_count`
- All 78 existing tests still pass

---

### Task 8: Fix `probable_cause` Sent as `""` Instead of `None`

**File:** `shared/models/incident.py:215`

**Current:**
```python
"probable_cause": self.probable_cause or "",
```

This converts `None` to `""`. The frontend and incident API check for `null`/`None` to determine if RCA has run. Empty string makes it look like "RCA completed but found nothing" vs "RCA hasn't run yet."

**Fix:**
```python
"probable_cause": self.probable_cause,
```

**Verification:**
- `GET /incidents/{id}` returns `"probable_cause": null` for not-yet-enriched incidents
- `"probable_cause": "string"` for enriched incidents
- Frontend can distinguish between "not enriched" and "enriched but no cause found"

---

## Phase 2: Integration Test (1 task)

### Task 9: Full Pipeline Integration Test

**New file:** `backend/tests/test_correlation_pipeline.py`

This tests the entire flow end-to-end: topology setup → event insertion → correlation → incident creation → blast radius verification.

**What it tests:**

```python
"""
Test the full correlation pipeline end-to-end:

1. Topology setup:
   - Insert site, switch, and AP nodes into topology_nodes
   - Insert site_membership and physical_link edges into topology_edges

2. Event insertion:
   - Insert switch-failure event (CRITICAL, infrastructure device)
   - Insert AP-down events (MAJOR, leaf devices) at the same site
   - Events span a 3-minute window (within default 5-min window)

3. Correlation:
   - Initialize CorrelationEngine with DatabaseTopologyProvider
   - Process events
   - Verify Stage 2 topology cascade created root-cause + symptom incident

4. Incident verification:
   - Title contains root cause device name
   - Severity = CRITICAL (from root events)
   - affected_devices includes both switch and APs
   - related_event_ids includes all 4 events
   - confidence_score > 0

5. Blast radius:
   - topology_node_ids resolved correctly
   - GET /topology/blast-radius/{incident_id} returns subgraph

6. Cross-cycle correlation:
   - Insert 2 events in batch 1, 2 events in batch 2
   - Process batch 1 → no incident (below min_event_count)
   - Process batch 2 → incident from all 4 events (cross-cycle)

7. Heuristic fallback:
   - When no topology edges exist, engine falls back to device-type heuristic
   - Still creates an incident with flat title format

8. Dedup / restart resilience:
   - Process same events twice → same incident_id
   - No duplicate incidents in DB

9. Residual handling:
   - Events not assignable to any cascade group create a residual incident
"""
```

**Test structure:**
```
test_correlation_pipeline.py
├── conftest fixtures (mocked DB, topology seed data, event factory)
├── class TestFullPipeline
│   ├── test_topology_cascade_creates_root_cause_incident
│   ├── test_topology_cascade_title_identifies_root_cause
│   ├── test_topology_cascade_severity_from_root_events
│   ├── test_topology_cascade_blast_radius
│   ├── test_heuristic_fallback_when_no_topology
│   ├── test_residual_incident_for_unassigned_events
│   ├── test_cross_cycle_correlation
│   ├── test_restart_resilience_dedup
│   └── test_event_count_zero_for_new_incident
```

**Why this matters:**
- Without this test, we can't prove the pipeline actually works end-to-end
- Existing 78 tests are unit tests with mocks — they verify the algorithm, not the integration
- This test catches DB schema mismatches, query errors, and data flow bugs

---

## Phase 3: Monitoring & Observability (3 tasks)

### Task 10: Add Engine Telemetry Counters

**File:** `shared/correlation/engine.py`

Add metrics to `CorrelationEngine` so operators can see the engine is working:

```python
class CorrelationEngine:
    def __init__(self, ...):
        ...
        # Telemetry
        self._cycle_count: int = 0
        self._total_events_processed: int = 0
        self._total_incidents_created: int = 0
        self._total_cascade_incidents: int = 0
        self._total_residual_incidents: int = 0
        self._last_duration_ms: float = 0.0
        self._last_cycle_events: int = 0
        self._last_cycle_incidents: int = 0
```

Update `process_events()` to track metrics. Expose via:
```python
def get_stats(self) -> Dict[str, Any]:
    return {
        "cycle_count": self._cycle_count,
        "total_events_processed": self._total_events_processed,
        "total_incidents_created": self._total_incidents_created,
        "cascade_incidents": self._total_cascade_incidents,
        "residual_incidents": self._total_residual_incidents,
        "processed_set_size": len(self._processed_events),
        "last_duration_ms": self._last_duration_ms,
        "last_cycle_events": self._last_cycle_events,
        "last_cycle_incidents": self._last_cycle_incidents,
    }
```

---

### Task 11: Per-Cycle Correlation Logging

**File:** `worker/main.py:132-149`

Add structured logging so production debugging doesn't require adding print statements:

```python
# After correlation
if incidents:
    cascade_count = sum(
        1 for i in incidents if i.symptom_device_ids
    )
    residual_count = len(incidents) - cascade_count
    logger.info(
        "Correlation: %d incidents from %d events "
        "(cascade=%d, residual=%d, heuristic=%s) "
        "in %.0fms",
        len(incidents),
        len(all_events),
        cascade_count,
        residual_count,
        "yes" if not self._correlation_engine._topology_cascade else "no",
        duration_ms,
    )
```

Also log a warning when cascade ratio is low (possible topology issue):
```python
if cascade_count == 0 and len(incidents) > 0:
    logger.warning(
        "No cascade incidents created — topology may be empty "
        "or cascade rule misconfigured"
    )
```

---

### Task 12: Expose Engine Stats via API

**File:** `backend/api/routes/*` or add to existing health route

Expose engine telemetry so the UI or monitoring tools can verify correlation is working:

```python
@router.get("/correlation/stats")
async def correlation_stats():
    """Return correlation engine telemetry."""
    return worker_daemon._correlation_engine.get_stats()
```

**Response shape:**
```json
{
  "cycle_count": 1423,
  "total_events_processed": 8452192,
  "total_incidents_created": 12453,
  "cascade_incidents": 8902,
  "residual_incidents": 3551,
  "processed_set_size": 184512,
  "last_duration_ms": 234.5,
  "last_cycle_events": 125,
  "last_cycle_incidents": 3
}
```

---

## Phase 4: Close Dangling Threads (2 tasks)

### Task 13: Verify Redis Pub/Sub for New Incidents

**Files:** `worker/main.py:146-149`, `shared/database/redis.py`

The worker already has:
```python
if self._redis_client:
    await self._redis_client.publish_incident(incident.to_db_dict())
```

But this has never been verified with a running Redis instance. Tasks:
1. Add a unit test for `publish_incident()` with a mock Redis client
2. Integration test: start Redis, start worker, verify incidents appear on Redis channel
3. Add a `redis_enabled` check in `WorkerDaemon.__init__` that logs whether Redis pub/sub is active
4. If `redis_enabled=True` but connection fails, log warning and continue (non-blocking)

---

### Task 14: Update `CORRELATION_ARCHITECTURE.md`

**File:** `docs/CORRELATION_ARCHITECTURE.md`

Update with the complete, accurate pipeline that now exists:

1. **Pipeline flow diagram** showing:
   - Collector loop → event persistence → topology sync → correlation → incident persistence → Redis pub/sub
   - Stage 1: site+time window grouping
   - Stage 2: topology cascade with `DatabaseTopologyProvider`
   - Cross-cycle correlation via DB sliding window
   - Residual incident creation

2. **`DatabaseTopologyProvider` details**:
   - Batch query strategy (not N+1)
   - Node ID resolution with all prefix patterns
   - Edge direction conventions

3. **Deterministic incident_id strategy**:
   - `inc-{sha256(site_id | root device | primary issue category)[:16]}` — root-cause key, implemented in Phase 2
   - Recurring failures (new event IDs each poll) merge into one incident via `ON CONFLICT DO UPDATE` instead of flooding the table
   - Recovery: `DEVICE_REACHABLE` events auto-resolve OPEN incidents whose root device recovered (`resolve_open_incidents_for_devices`)

4. **Processed event tracking**:
   - `OrderedDict[str, datetime]` with TTL + capacity cap
   - Startup loading from incidents table
   - Why: memory safety, cross-cycle dedup

5. **Operational metrics**:
   - Available via API
   - What each counter means
   - How to alert on correlation stall (zero incidents in 5 cycles)

6. **Troubleshooting guide**:
   - "No incidents being created" → check topology is populated, check min_event_count
   - "All incidents are residual" → check `resolve_node_id()` patterns
   - "Duplicate incidents on restart" → check deterministic ID implementation
   - "Memory growing" → check `_processed_events` cap

---

## Execution Order

| Phase | Tasks | Dependencies |
|-------|-------|-------------|
| Phase 1 | 1-8 | None |
| Phase 2 | 9 | 1-8 complete |
| Phase 3 | 10-12 | 1-8, 9 (can start after 3,4,5) |
| Phase 4 | 13-14 | 1-8 |
