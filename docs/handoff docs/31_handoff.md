# Session 31 Handoff — WP-2.1 Fix inverted edge direction

> **Handoff Date:** Aug 5, 2026
> **Session Goal:** Fix the inverted `physical_link` direction defect that caused the topology cascade to produce zero incidents, by introducing an explicit `links` table with `parent_node_id`/`child_node_id`.
> **Status:** Done. Full suite: **432 backend passed / 0 failed**.

---

## 1. Executive Summary

The cascade engine (`TopologyCascadeRule`) was producing zero incidents because `get_parent_child_map()` returned raw topology node_ids (e.g., `"mist-ap-abc123"`) as child device_ids, while events use stripped canonical keys (e.g., `"abc123"`). The cascade could never match children to leaf events. WP-2.1 fixes this by:

1. Creating an explicit `links` table with unambiguous `parent_node_id`/`child_node_id`
2. Migrating existing `physical_link` edges from `topology_edges` to `links` with corrected direction
3. Fixing `get_parent_child_map()` to translate unknown child node_ids via `node_id_to_device_id()`
4. Updating the write path (`topology_sync.py`, `snmp_poller.py`) to write physical links to `links`
5. Updating the read path (API queries, `get_parents()`/`get_children()`) to read physical links from `links`

| Area | Before | After |
|---|---|---|
| Edge storage | `topology_edges` with ambiguous `src_id`/`dst_id` | `links` with explicit `parent_node_id`/`child_node_id` |
| Physical link direction | AP→switch (src=AP, dst=switch) — inverted | switch→AP (parent=switch, child=AP) — correct |
| Cascade child translation | raw node_id returned (e.g. `"mist-ap-abc123"`) | `node_id_to_device_id()` strips prefix → `"abc123"` |
| API edge queries | `topology_edges` only | `topology_edges` (non-physical) + `links` (physical) |
| SNMP poller | wrote `physical_link` to `topology_edges` only | writes to both `topology_edges` + `links` |
| Tests | 429 passed | **432 passed** (3 new: links write, no-uplink skip, child-translation fallback) |

---

## 2. Schema

### `schemas/postgres/009_links.sql`

- `links(id, parent_node_id, child_node_id, link_type, props, updated_at)`
- `uq_links_pair` unique constraint on `(parent_node_id, child_node_id, link_type)`
- Indexes: `idx_links_parent`, `idx_links_child`, `idx_links_type`
- Trigger `trg_links_updated_at` keeps `updated_at` current
- Migration: copies `physical_link` edges from `topology_edges` to `links` with `parent_node_id = dst_id`, `child_node_id = src_id`
- Cleanup: `DELETE FROM topology_edges WHERE edge_type = 'physical_link'` after migration

---

## 3. Write path

### `backend/worker/collectors/topology_sync.py`

- `_sync_mist_physical_links()` now calls `_upsert_link(parent_node_id=switch, child_node_id=AP, link_type="physical")` instead of `_upsert_edge(src=AP, dst=switch, edge_type="physical_link")`
- `_upsert_link()` helper added for explicit parent-child upserts
- `_upsert_edge()` retained for `site_membership` and `wan_link` in `topology_edges`
- Docstring corrected: "AP → switch" → "switch → AP"

### `backend/worker/collectors/snmp_poller.py`

- `_upsert_topology_edges()` now writes to both `topology_edges` (backward-compat) and `links` (cascade)
- `links` insert uses `parent_node_id = remote_node_id`, `child_node_id = local_node_id` to match migration semantics

---

## 4. Read path

### `backend/shared/database/topology.py`

- `DatabaseTopologyProvider.get_parent_child_map()`:
  - Queries `links` table instead of `topology_edges`
  - Translates unknown child node_ids via `node_id_to_device_id()` (strips known prefixes)
  - **This is the actual root-cause fix** — the cascade can now match leaf events

- `get_devices_under_node()`:
  - Replaced recursive Python calls with a recursive CTE against `links`
  - More efficient and correct for multi-hop blast radius

- `get_parents()` / `get_children()`:
  - Query `links` for physical relationships + `topology_edges` for `site_membership`/`wan_link`/`logical_link`
  - No double-counting: `physical_link` rows were deleted from `topology_edges` in migration

### `backend/api/routes/topology.py`

- `_INTER_SITE_EDGES_QUERY` and `_EDGES_FOR_SITE_IDS` now UNION ALL with `links` for physical edges
- Maps `child_node_id` → `src_id`, `parent_node_id` → `dst_id` to preserve API contract
- Non-physical edges still come from `topology_edges`

---

## 5. Tests

- `backend/tests/test_topology_sync.py` — 2 new tests:
  - `test_physical_link_writes_to_links_table`: verifies `_upsert_link` is called with parent=switch, child=AP
  - `test_no_uplink_events_skips_link_creation`: verifies no link inserts when uplink table is empty

- `backend/tests/test_topology_provider.py` — 1 new test + all existing updated:
  - `test_child_not_in_input_set_resolved_via_node_id_to_device_id`: the critical regression test proving the cascade fix
  - All existing tests updated from `_edge_row` (src/dst) to `_link_row` (parent/child) semantics
  - `get_all_descendants` mock updated to simulate the recursive CTE query shape

Full run: **432 passed / 0 failed**.

---

## 6. Documentation

All 4 strategy docs updated:

- `docs/strategy/PLAN_GAP.md` — WP-2.1 marked DONE; §7 metrics updated (432 tests, links table status)
- `docs/strategy/ROADMAP.md` — Phase 2 edge direction description updated; current-state bridge updated
- `docs/strategy/ARCHITECTURE.md` — cascade defect description updated
- `docs/strategy/TECHNICAL_QA.md` — "Cause 2 inverted edge direction" rewritten as FIXED

---

## 7. Watch items / deferred

- **Cross-vendor `logical_link` edges** (`topology_sync.py:_sync_cross_vendor_links`) still write to `topology_edges`. These should eventually move to `links` too, but they weren't migrated because the migration only handles `physical_link`. WP-2.9 will unify all parent-child edges into `links`.
- **API edge type naming**: `links` uses `link_type='physical'` while the API model still exposes `edge_type='physical_link'` to the frontend (via the UNION ALL mapping). This is an internal detail; the frontend doesn't reference it directly.
- **graphify update**: skipped — `graphify` CLI is not available in this environment.

---

## 8. Files changed

| File | Change |
|---|---|
| `schemas/postgres/009_links.sql` | new: explicit parent-child links table + migration + cleanup |
| `backend/worker/collectors/topology_sync.py` | writes switch→AP to `links`; `_upsert_link()` helper; docstring fix |
| `backend/worker/collectors/snmp_poller.py` | writes physical links to `links` in addition to `topology_edges` |
| `backend/shared/database/topology.py` | provider queries `links`; recursive CTE for descendants; `node_id_to_device_id()` fallback |
| `backend/api/routes/topology.py` | API edge queries UNION ALL with `links` for physical edges |
| `backend/tests/test_topology_sync.py` | 2 new tests for links write path |
| `backend/tests/test_topology_provider.py` | 1 new critical test + all existing updated for `links` schema |
| `docs/strategy/PLAN_GAP.md` | WP-2.1 done; metrics updated |
| `docs/strategy/ROADMAP.md` | current-state bridge + edge direction description |
| `docs/strategy/ARCHITECTURE.md` | defect status updated |
| `docs/strategy/TECHNICAL_QA.md` | Cause 2 rewritten as fixed |

## 9. Commands

```bash
python -m pytest backend/tests        # 432 passed / 0 failed
```

---

*Graphify update skipped: `graphify` CLI is not available in this environment.*
