# VeloCloud End-to-End Verification Plan

## Objective
Verify the complete VeloCloud data pipeline end-to-end: API → collector → inventory DB → topology graph → correlation. Fix the `props` data gap that prevents WAN link edges from being created, and write comprehensive tests covering every normalization path, error mode, and edge case.

## Pipeline Trace

```
VCO API → VeloCloudCollector → UnifiedEvents (edges, events) → insert_events()
        → VelocloudInventoryCollector → inventory table
                                         ↓
                                       TopologySync._sync_velocloud_topology()
                                         ↓
                                       topology_nodes/edges (site, edge, wan_gateway nodes + site_membership, wan_link edges)
```

## Root Cause
`_build_rows()` in `velocloud_inventory.py` fetches edges with `recentLinks` from the VCO API but drops all link data — only the first link's `ipAddress` is extracted. The `props` column in the inventory table is never populated. `TopologySync._sync_velocloud_topology()` reads `props.links` which is always `[]` → zero WAN link edges ever created.

## Phases

### Phase 1 — Fix Data Gap
- `_build_rows()`: store link data in `props` with `{"links": [...], "velobrain_score": 0.0}`
- `_upsert_inventory()`: add `props` column to INSERT and UPDATE clauses
- Expected: WAN gateway nodes + WAN link edges appear in topology graph

### Phase 2 — Unit Tests (`test_velocloud_collector.py`, new, ~820 lines)
#### Section A: VeloCloudCollector (21 tests)
Constructor, is_configured, connect(), _get_enterprise_id(), collect_all() in all states

#### Section B: VeloCloudEdgesCollector (22 tests)
Edge states (connected/offline/degraded), site/model/SW metadata, error modes, retry, API errors

#### Section C: VeloCloudEventsCollector (35 tests)
Severity mapping (9 levels), event type mapping (11 types), normalization, bad elements skipped, retry

#### Section D: VelocloudInventoryCollector (25 tests)
Full collect flow, _build_rows() with props/link data, upsert verification, API failure modes

### Phase 3 — Topology Sync Tests (`test_topology_sync.py`, new, ~250 lines)
- 14 tests: _sync_velocloud_topology() with empty/single/multi edges, with/without WAN links, props edge cases

### Phase 4 — Pipeline Integration Tests (3 tests in `test_correlation_pipeline.py`)
- Pipeline with VeloCloud enabled, VeloCloud API failure is non-fatal

### Phase 5 — Metrics Cleanup
- Mark `velocloud_metrics.py` as dead code (logic merged into inventory)

## File Change Summary

| File | Action | Lines |
|------|--------|-------|
| `backend/worker/collectors/velocloud_inventory.py` | Edit | +12 |
| `backend/worker/collectors/velocloud_metrics.py` | Edit (ponytail marker) | +2 |
| `backend/tests/test_velocloud_collector.py` | **New** | ~820 |
| `backend/tests/test_topology_sync.py` | **New** | ~250 |
| `backend/tests/test_correlation_pipeline.py` | Edit | +60 |
| **Total** | | **~1,144 lines added, 0 deleted** |
