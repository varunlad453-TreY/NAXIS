# Session 21 Handoff — Stage 2 Topology Cascade: Wire Real Topology, Kill Silent Fallbacks

> **Handoff Date:** July 30, 2026
> **Session Goal:** Wire real Postgres topology into the correlation cascade engine (Stage 2), fix the identifier mismatch bug that made it silently fall back to heuristics, remove heuristic fallback entirely, and audit + fix all silent `except Exception: pass` patterns across the codebase.
> **Status:** Stage 2 now uses real network edges. 11 silent fallbacks fixed. Heuristic fallback removed.

---

## 1. Executive Summary

The topology cascade system was designed but never worked: `DatabaseTopologyProvider.get_parent_child_map()` returned children as topology `node_id`s (`"mist-ap-abc123"`) but `TopologyCascadeRule._evaluate_with_topology()` compared them against event `device_id`s (`"abc123"`). No match ever occurred — cascade silently fell back to device-type heuristics on every production run. The correlation engine was theatre.

This session fixed that, removed the heuristic safety net so real failures are visible, and fixed 11 silent `except Exception: pass` patterns across the codebase so operators see what breaks.

---

## 2. Completed Items

### 2.1 Identifier Translation Fix (The Core Bug)

| Component | Before | After |
|-----------|--------|-------|
| `get_parent_child_map()` | Returns `{node_id: [child_node_id, ...]}` — cascade never matches | Returns `{device_id: [child_device_id, ...]}` via reverse index |
| `get_all_descendants()` | Returns raw topology node_ids | Returns event device_ids via `node_id_to_device_id()` |
| `_known_node_id_patterns()` | Only generates `mist-ap-` for MAC/UUID device_ids — misses short AP IDs | Tries **all** known prefixes for every device_id |
| `batch_resolve_node_ids()` | Misses APs with short device_ids | Now resolves correctly |

**The fix** (3 changes in `backend/shared/database/topology.py`):

1. **Reverse index** (`topology.py:438-441`): After building `parent_to_children` from edge rows, build `child_node_to_device` from the `resolved` dict so child node_ids are translated back to event device_ids before returning.

2. **`node_id_to_device_id()` helper** (`topology.py:107-120`): Strips known prefixes (`mist-ap-`, `switch-`, `velo-edge-`, etc.) from a node_id to reverse-resolve the original device_id. Used by `get_all_descendants()`.

3. **`_known_node_id_patterns()`** (`topology.py:30-87`): Replaced heuristic-gated prefix generation (MAC-only for `mist-ap-`, UUID-only for `mist-site-`) with unconditional all-prefix iteration. The DB cost of a few extra `ANY($1)` entries is negligible vs. the cost of silently missing matches.

### 2.2 Heuristic Fallback Removed

| What | Before | After |
|------|--------|-------|
| `topology_fallback_to_device_type` | `default=True` | `default=False` |
| `evaluate()` when provider is set | Tries topology → if empty, falls back to heuristics | Returns topology result only — no fallback |
| `evaluate()` when no provider | Falls back to heuristics | Returns `[]` — no cascade possible without data |

**Files changed:**
- `backend/shared/correlation/rules.py:36` — default flipped to `False`
- `backend/shared/correlation/rules.py:403-415` — `evaluate()` no longer calls `_evaluate_by_device_type()`

### 2.3 Cross-Vendor Logical Links

Added `_sync_cross_vendor_links()` to `TopologySync` (`backend/worker/collectors/topology_sync.py:347-449`). After each vendor sync, queries `topology_nodes` grouped by site/vendor and creates `logical_link` edges from infra devices to leaf devices of different vendors at the same site. This allows the cascade engine to traverse vendor boundaries (e.g. VeloCloud WAN edge → Mist AP).

Fixed: initial implementation ran unconditionally — now only runs when at least one vendor source is enabled (`topology_sync.py:63`).

### 2.4 11 Silent Fallbacks Fixed

Audited every `except Exception: pass` or unlogged `return []` in production code. Found 11 locations where errors were swallowed with zero visibility. All now log with `logger.warning(...)` or `logger.exception(...)`:

| # | File | Line | Context | Fix |
|---|------|------|---------|-----|
| 1 | `correlation/rules.py` | 468 | `get_all_descendants()` failure in cascade | Added `logger.warning(..., exc_info=True)` |
| 2 | `correlation/engine.py` | 213 | `_fetch_unlinked_events()` DB query fails | Added `logger.warning(..., exc_info=True)` before `return []` |
| 3 | `correlation/engine.py` | 222 | `_row_to_event()` per-row conversion fails | Added `logger.warning(..., exc_info=True)` before `continue` |
| 4 | `syslog_receiver.py` | 237 | Syslog UDP queue full | Added `logger.warning(...)` |
| 5 | `syslog_receiver.py` | 239 | Syslog UDP datagram decode fails | Added `logger.warning(..., exc_info=True)` |
| 6 | `syslog_receiver.py` | 264 | Syslog TCP queue full | Added `logger.warning(...)` with peer |
| 7 | `syslog_receiver.py` | 221 | Syslog shutdown flush fails | Added `logger.exception(...)` |
| 8 | `snmp_trap_receiver.py` | 160 | SNMP trap shutdown flush fails | Added `logger.exception(...)` |
| 9 | `mist_inventory.py` | 134 | Mist site stats API call fails | Added `logger.warning(..., exc_info=True)` |
| 10 | `correlation.py` (API) | 107 | SSE Redis pubsub error | Added `logger.warning(..., exc_info=True)` |
| 11 | `velocloud_events.py` | 157 | Bad timestamp parsing | Added `logger.warning(...)` with bad value |

### 2.5 Tests (30 new + 14 updated)

**`backend/tests/test_topology_provider.py`** — 30 tests across 3 test classes:
- `TestBatchResolveNodeIds` (13 tests): short IDs, UUIDs, MACs, cleaned MACs, all prefixes, mixed sets
- `TestGetParentChildMap` (12 tests): translation, fallback to raw node_id, multi-parent, cross-vendor, site edges, UUID/MAC inputs, DB error handling
- `TestGetAllDescendants` (5 tests): direct child, multi-hop, max_depth, cross-vendor chain

**Updated tests** (14 updated):
- `test_topology_sync.py` — all 13 non-empty tests use `side_effect=[rows, []]` for the two `db.fetch` calls
- `test_correlation_engine.py` — `test_cascade_no_provider_fallback_to_heuristics` → `test_cascade_no_provider_returns_empty`, others updated for new no-fallback behavior
- `test_correlation_pipeline.py` — `test_heuristic_fallback_no_topology` → `test_flat_incident_when_no_topology_match`
- `conftest.py` — `topology_aware_config` no longer sets `topology_fallback_to_device_type=True`

**Results:** 129 core tests pass. 10 pre-existing failures unchanged (unrelated: topology API backbone, VeloCloud collector mock issues, Redis pipeline test).

---

## 3. Architecture Decisions

### 3.1 Topology Is the Only Source of Truth for Cascade
**Decision:** When a `TopologyProvider` is configured, `evaluate()` returns whatever the provider returns — no fallback to heuristics. If topology returns empty, the cascade produces no groups and the engine creates flat Stage 1 incidents instead.

**Rationale:** The heuristic fallback silently "conned" operators into thinking cascade was working when it was always running the wrong path. Making failures visible (flat incidents instead of cascade) means the monitoring system at `main.py:185-189` ("No cascade incidents created") fires every cycle until topology is correctly wired.

### 3.2 All Prefixes, Every Time
**Decision:** `_known_node_id_patterns()` generates candidates with every known prefix for every device_id, regardless of format.

**Rationale:** The previous MAC/UUID heuristic gates were fragile and missed real matches (e.g., short Mist AP device_ids never generated `mist-ap-` candidates). The performance cost is negligible: for a batch of 20 device_ids, we generate ~180 candidates vs. ~80 before. A single `WHERE node_id = ANY($1)` query with 180 entries takes the same index lookup as 80.

### 3.3 Silent `except Exception: pass` → Always Log
**Decision:** Every caught exception in production code must log something. `pass` is no longer used for error handling.

**Rationale:** Silent fallbacks hide real operational failures — queue drops, API degradation, bad data, DB errors. Making them visible means operators see warnings in logs and can investigate before data loss accumulates.

---

## 4. Full Wiring Trace

```
worker/main.py:103-107   → DatabaseTopologyProvider() created
worker/main.py:108-111   → passed to CorrelationEngine()
engine.py:90-96          → creates TopologyCascadeRule(provider=...)
engine.py:338-343        → evaluate(group_events) called per site+time group
rules.py:403-409         → calls _evaluate_with_topology() only (no fallback)
rules.py:441-443         → calls provider.get_parent_child_map(all_device_ids)
rules.py:467-474         → calls provider.get_all_descendants(infra_dev_id)
topology.py:402-403      → batch_resolve_node_ids() resolves device_ids→node_ids
topology.py:408-415      → single edge query for resolved node_ids
topology.py:438-441      → reverse-index: child_node_id → child_device_id  ← THE FIX
topology.py:445-455      → returns {parent_device_id: [child_device_id, ...]}
topology.py:459-472      → get_all_descendants: resolves recursively, returns device_ids
rules.py:471             → child_device_ids = immediate | multi-hop descendants
rules.py:483-500         → leaf events matched against child_device_ids → symptoms
```

---

## 5. Worker Cycle — Updated

The `WorkerDaemon.run_once()` cycle has the same 12 steps as session 20, but step 6 now produces real topology-aware cascade incidents instead of heuristic-based ones. Step 5 creates cross-vendor `logical_link` edges for multi-vendor sites.

---

## 6. Files Modified

| File | Change |
|------|--------|
| `backend/shared/database/topology.py` | Reverse index in `get_parent_child_map()` (lines 438-441); `node_id_to_device_id()` helper (lines 107-120); `_known_node_id_patterns()` simplified to try all prefixes (lines 30-87); `get_all_descendants()` returns device_ids (line 472) |
| `backend/shared/correlation/rules.py` | `evaluate()` no longer falls back to heuristics (lines 403-415); `get_all_descendants` failure now logs (line 468-473); added `logger`; default `topology_fallback_to_device_type` = `False` (line 36) |
| `backend/shared/correlation/engine.py` | `_fetch_unlinked_events()` DB failure logged (line 213); per-row conversion failure logged (line 222) |
| `backend/worker/collectors/topology_sync.py` | Added `_sync_cross_vendor_links()` (lines 347-449); guarded by `if self._mist_enabled or self._velo_enabled` (line 63) |
| `backend/worker/receivers/syslog_receiver.py` | Queue full logged (lines 237, 264); decode failure logged (line 239); shutdown flush logged (line 221) |
| `backend/worker/receivers/snmp_trap_receiver.py` | Shutdown flush logged (line 160) |
| `backend/worker/collectors/mist_inventory.py` | Site stats API failure logged (line 134) |
| `backend/worker/collectors/velocloud_events.py` | Bad timestamp logged (line 157) |
| `backend/api/routes/correlation.py` | SSE pubsub error logged (line 107) |
| `backend/tests/test_topology_provider.py` | **New** — 30 tests for DatabaseTopologyProvider identifier translation |
| `backend/tests/test_topology_sync.py` | Updated 13 tests for two `db.fetch` calls (side_effect) |
| `backend/tests/test_correlation_engine.py` | Updated 4 tests for no-fallback behavior |
| `backend/tests/test_correlation_pipeline.py` | Renamed 1 test |
| `backend/tests/conftest.py` | `topology_aware_config` no longer sets fallback flag |

---

## 7. Pending Items (by Impact)

### High Impact

| # | Item | Why High |
|---|------|----------|
| H1 | **Enable notification system** | `NOTIFICATION_ENABLED=false` by default. Must set `=true` + configure Slack URL or SMTP creds for collector failure alerts to actually send. |
| H2 | **Configure Arista WLC** | Collectors exist, wired, and tested — but `.env` has empty host/username/password. Once filled, 4 Arista WLC collectors activate. |

### Medium Impact

| # | Item | Why Medium |
|---|------|-----------|
| M1 | **SNMP credentials management UI** | Backend endpoints + frontend form needed. Blocks SNMP polling from being usable. |
| M2 | **Mist client tracking** (per site) | Mist API returns 0 clients. Requires Mist console config to enable client tracking. |
| M3 | **Mist radio scanning** (per site) | Mist API returns 0 neighbors. Requires Mist console config. |

### Low Impact

| # | Item | Why Low |
|---|------|---------|
| L1 | Backend dead code scan (`pyflakes`) | Quality only |
| L2 | Arista WLC cross-year timestamp | Edge case (Dec/Jan boundary) |
| L3 | DNAC Topology → Graph | Requires DNAC deployment |
| L4 | Pre-existing `toImage` TS error | `topology-graph.tsx:502` — ReactFlow types mismatch, non-blocking |

---

## 8. How to Pick Up — Next Developer

### Immediate (next session)
1. Enable notification system in production `.env`
2. Fill in Arista WLC credentials to activate 4 more collectors

### Integration testing (recommended)
3. Deploy to staging, verify cascade incidents appear with topology-aware titles ("failure cascading to N dependent devices")
4. Check logs for the new fallback warnings (`get_all_descendants failed`, `Syslog queue full`, etc.)
5. Verify cross-vendor logical_link edges appear in `topology_edges` via `SELECT edge_type, COUNT(*) FROM topology_edges GROUP BY edge_type`

### Maintenance
6. Run `pyflakes backend/` to find dead imports/functions
7. The `toImage` TS error persists if ReactFlow types aren't pinned — consider a type override or version bump

---

## 9. CHANGELOG Entry

```
## [21] — 2026-07-30 — Stage 2 Topology Cascade: Wire Real Topology, Kill Silent Fallbacks
- Fixed DatabaseTopologyProvider identifier mismatch: get_parent_child_map now returns event device_ids, not topology node_ids
- Added node_id_to_device_id() helper for reverse resolution
- Simplified _known_node_id_patterns() to try all prefixes unconditionally (was missing mist-ap- for short device_ids)
- Added _sync_cross_vendor_links() to TopologySync — creates logical_link edges between vendors at same site
- Removed heuristic fallback from TopologyCascadeRule — topology is now the only source of truth for cascade
- Flipped topology_fallback_to_device_type default to False
- Fixed 11 silent except Exception: pass patterns across correlation engine, syslog receiver, SNMP trap receiver, Mist inventory, VeloCloud events, and SSE endpoint — all now log with exc_info
- Added 30 tests for DatabaseTopologyProvider (batch_resolve, parent-child map, all_descendants) across UUID, MAC, short-ID, and cross-vendor formats
- Updated 14 existing tests for no-fallback behavior and dual db.fetch calls
```
