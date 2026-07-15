# Handoff Document — Session 9

**Date:** 2026-07-08
**Project:** Network Resilient Platform (Naxis)
**AI Agent:** opencode (deepseek-v4-flash-free)

---

## 1. Session Objective

Ship three major topology features and make the graph usable with real data:

1. **Blast Radius Side Panel** — show incident impact subgraph with root-cause/symptom coloring
2. **Health History Timeline** — per-node health trend chart over time
3. **Performance for Large Topologies** — make the ReactFlow graph usable at scale (~2500 nodes)

### Session 3 Addendum

Implemented the "real fix" for performance that was recommended in Session 2: **ReactFlow parent-child grouping with collapsible site containers**. Replaced the client-side site-filter-pill workaround with in-graph expand/collapse of site groups. All ~2,500 nodes are now sent to the browser simultaneously; only collapsed site headers render by default (60 groups), and expanding a site reveals its children inside the group container.

---

## 2. What Was Done & Why

### 2.1 Phase 1: Blast Radius Side Panel (Completed)

Already shipped before this session. Not modified.

**Files:** `topology-side-panel.tsx`, `blast-radius-panel.tsx`, `blast-radius-panel.test.tsx`

---

### 2.2 Phase 2: Health History Timeline (Completed)

#### 2.2.1 Backend — `node_health_snapshots` table & collector

**Why:** Need a historical record of per-node health so the frontend can render a timeline chart. The `events` table is append-only and health is ephemeral. A dedicated snapshot table stores the latest health state per node at periodic intervals.

**What:**
- Created `schemas/postgres/006_health_snapshots.sql` — `node_health_snapshots` table with `UNIQUE(node_id, snapshot_at)` constraint
- Created `backend/worker/collectors/health_snapshot.py` — `HealthSnapshotCollector` that runs every 5 minutes, derives health from recent events, writes to the snapshots table
- Created `backend/shared/health.py` — shared health derivation logic used by both the API route and the collector (avoids duplication)

#### 2.2.2 Frontend — `health-history-chart.tsx`

**Why:** Render a bar chart showing health status over time for a selected node.

**What:**
- Recharts `BarChart` with 3 stacked bars (critical/warning/healthy) per time bucket
- Range filter buttons (1h, 6h, 24h, 7d)
- Loading, error, empty states
- Refetches when range changes

**Fix — `Bar fill` prop → `<Cell>` children:**

**Why:** The original code used `<Bar dataKey="count" fill={(entry) => entry.color} />`. In newer Recharts (v2.15+), `fill` on `Bar` only accepts a color string, not a function. Using `<Cell fill={color} />` as children of `<Bar>` is the supported API for per-bar coloring.

**Files:** `frontend/src/components/topology/health-history-chart.tsx`, `health-history-chart.test.tsx`

**Test coverage:** 7 tests (loading, error, empty data, data rendering, range button clicks)

#### 2.2.3 Test fixes — `@tanstack/react-query` mocking

**Why:** `HealthHistoryChart` uses `useQuery` from `@tanstack/react-query`. When mounted inside `node-detail-panel` and `topology-side-panel` tests without a `QueryClientProvider`, React Query throws `No QueryClient set`. We mocked the entire module.

**Fix:** Added `vi.mock("@tanstack/react-query")` to both `node-detail-panel.test.tsx` and `topology-side-panel.test.tsx`.

**File:** `frontend/vitest.setup.ts` — imports `@testing-library/jest-dom` only (no global mock — mocks are per-test-file)

**Test results:** 66 tests pass, 0 TypeScript errors (across 7 test files)

---

### 2.3 Fix: Missing `await` in Worker (Critical Bug)

**File:** `backend/worker/main.py` line 132

**The bug:**
```python
# BEFORE (broken):
incidents = self._correlation_engine.process_events(all_events)
# Returns a coroutine object, NOT the result!

# AFTER (fixed):
incidents = await self._correlation_engine.process_events(all_events)
```

**Why it broke the topology:** `process_events()` is an `async` method. Without `await`, the call returned a `coroutine` object instead of a list of incidents. When the code iterated over the coroutine with `for incident in incidents:`, Python raised `TypeError: 'coroutine' object is not iterable`. This exception crashed the entire worker pass, and `TopologySync.sync()` (called after correlation) **never executed**. Result: `topology_nodes` and `topology_edges` tables remained empty even though collectors produced events successfully.

**Detection:** Worker heartbeat showed "error" cycles. Logs showed `TypeError` at the iteration point.

---

### 2.4 Fix: Mist Wired Uplink Collector (404 → LLDP Fallback)

**Problem:** `MistWiredUplinkCollector` called `GET /api/v1/orgs/{org_id}/wired/uplinks` which returned HTTP 404. This endpoint requires a Wired Assurance license on the Mist org, which was not available.

**Why we switched:** The AP-to-switch connectivity data is also available via `lldp_stat` / `lldp_stats` fields on the device stats endpoint (`/api/v1/sites/{site_id}/stats/devices`). Every AP reports its LLDP neighbor (the switch) back to Mist Cloud as part of normal telemetry — no extra license needed.

**What changed (file: `backend/worker/collectors/mist_topology.py`):**
- Removed the org-level endpoint call entirely (was a wasted API call every cycle)
- Changed `collect()` to accept `site_ids` (like the other site-scoped collectors)
- Added `_fetch_device_uplinks(site_ids)` — iterates sites, fetches device stats, extracts `lldp_stat` (single neighbor) and `lldp_stats` (per-port map)
- Normalizes each LLDP entry into the same `_normalize()` format so edge events are identical regardless of source
- Orchestrator (`MistTopologyCollector.collect_all()`) now passes `site_ids` to the wired uplink collector

**Note:** The wired uplink collector independently fetches device stats per site (same endpoint the AP history and AP RF collectors already call). This means duplicate API calls across collectors. A future optimization could share fetched data.

**Result:** `Mist wired uplinks: 1090 links collected` per cycle.

---

### 2.5 Fix: `\u0000` Null Byte in PostgreSQL Insert

**Problem:** The Mist device stats API occasionally returns strings containing `\u0000` (null byte) characters (e.g., in device names, LLDP system names). PostgreSQL text and JSON columns refuse null bytes with `UntranslatableCharacterError: \u0000 cannot be converted to text`. This crashed the entire worker pass because `insert_events()` failed.

**Fix (file: `backend/shared/models/event.py`):**
- Added `_strip_null()` static method that recursively removes `\u0000` from strings, dicts, and lists
- Applied `_strip_null()` to every string field in `to_db_row()` including the `metadata` and `raw_event` JSON dicts (which are `json.dumps()`'d before insert)

**Why this approach:** The cleanest place to sanitize is at the model layer (`to_db_row()`), not at individual collectors. This catches null bytes from any source (Mist, VeloCloud, SNMP, etc.).

---

### 2.6 Fix: Foreign Key Violation — Topology Edge AP Node ID Mismatch

**Problem:** After fixing the null byte bug, the worker crashed with:
```
ForeignKeyViolationError: insert or update on table "topology_edges"
violates foreign key constraint "topology_edges_src_id_fkey"
Key (src_id)=(mist-ap-003e73006112) is not present in table "topology_nodes"
```

**Root cause — ID format mismatch:**

- **Inventory `device_id`** is the Mist internal UUID (e.g., `00000000-0000-0000-1000-003e73006112`) — set by `MistInventoryCollector` in `mist_inventory.py:168`: `"device_id": d.get("id", "")` (the Mist API `id` field)
- **Event `device_id`** is the AP MAC address (e.g., `003e73006112`) — set by `MistWiredUplinkCollector._normalize()`: `device_id=ap_mac`

When `TopologySync._sync_mist_topology()` creates AP nodes from inventory, it uses `node_id = f"mist-ap-{row['device_id']}"` which produces `mist-ap-00000000-0000-0000-1000-003e73006112`. But when `_sync_mist_physical_links()` tries to create the edge, it looks up `ap_node_ids[ap_dev_id]` where `ap_dev_id` is the MAC from the event (`003e73006112`), which doesn't match the UUID key. The fallback `f"mist-ap-{ap_dev_id}"` produces `mist-ap-003e73006112`, which doesn't exist in `topology_nodes`.

**Fix (file: `backend/worker/collectors/topology_sync.py`):**
- Added `mac` column to the inventory query: `SELECT ..., mac FROM inventory WHERE platform = 'mist'`
- Built a `mac_to_ap_node_id: Dict[str, str]` mapping MAC addresses to the correct `node_id` (the UUID-based one)
- Updated `_sync_mist_physical_links()` to accept `mac_to_ap_node_id` and look up by MAC first, then by UUID, then fallback

---

### 2.7 Phase 3: Performance — Site Drill-Down UX

**Session 2 (replaced):** Client-side site-filter-pill workaround — `selectedSiteId` state filtered to 30-80 nodes per site. Single-site-at-a-time. Broken for multi-site views.

**Session 3 (current):** ReactFlow parent-child grouping with collapsible site groups.

#### Problem

ReactFlow renders all ~2,500 nodes (1,947 APs + 450 switches + 60 sites) simultaneously. dagre layout computation on 2,500 nodes takes seconds, and the DOM has 2,500+ node elements making pan/zoom/click unusably laggy. The graph was completely non-interactive.

#### Solution: `buildGroupedLayout()` + `SiteGroupNode`

**Architecture:**

1. **`layout.ts` — `buildGroupedLayout()`:** Runs flat dagre on all nodes (same as before), then groups children (APs, switches) by `site_id` into parent group nodes. Collapsed groups render as small header-only nodes (`GROUP_HEADER_HEIGHT = 44px`). Expanded groups render as full-size containers with children positioned relative to the parent via `parentId` + `extent: "parent"`. Edges whose endpoints are hidden (children inside collapsed groups) are filtered out. `site_membership` edges are removed (replaced by containment).

2. **`topology-graph.tsx` — `SiteGroupNode` component:** Renders differently based on collapsed/expanded state:
   - **Collapsed:** Compact card with site name, device count badge, health dot, `▸` chevron
   - **Expanded:** Large container with subtle background/border — the group background itself. A header bar with site name, count, and `▾` chevron

3. **`expandedSites: Set<string>` state:** Managed in `TopologyGraph`. Clicking a `siteGroup` node calls `toggleSite(siteId)` which adds/removes the site from the set. This triggers a re-memo of `buildGroupedLayout()`, which either includes or excludes child nodes.

4. **`page.tsx` simplified:** Removed `selectedSiteId`, `sites`, `filteredNodes`, `filteredEdges`, `handleSiteClick`, `handleBackToOverview`, and the entire site filter pills JSX. Now passes full `graphData` directly to `TopologyGraph`.

**Performance characteristics after the fix:**

| Scenario | Before (Session 2 workaround) | After (Session 3) | Notes |
|---|---|---|---|
| Show all sites | 60 site nodes — OK | 60 collapsed group nodes — OK | Same, but groups have richer appearance |
| Show one site's devices | 30-80 nodes — OK | Collapsed: 60 group nodes. Expand one: +30-80 child nodes | Actually better — stays in same view |
| Show ALL devices ALL sites | Broken — only one site | 2,500 nodes sent to browser but ReactFlow `onlyRenderVisibleElements` keeps DOM small. Only expanded sites + nearby nodes render DOM elements | **Usable but zoomed out will show all group headers** |
| Compare two sites side-by-side | Broken — single-site only | Expand both sites, zoom to fit both | **Now possible** |
| Cross-site edges | Hidden | Filtered to visible endpoints — edges between collapsed groups are hidden, edges to expanded groups show | Reasonable |

**How `buildGroupedLayout` works (file: `frontend/src/components/topology/layout.ts` lines 102-213):**

1. Call `buildLayout()` (unchanged flat dagre) to get positioned nodes and edges
2. Build maps: `childParentId` (node_id → site_id), `siteNodeMap` (site_id → site TopologyNode)
3. Iterate flat RF nodes: site nodes are discarded (replaced by group nodes); child nodes with a `site_id` are grouped into `siteChildren`; ungrouped nodes (no site_id) are kept as-is
4. For each site with children:
   - Compute bounding box of all children
   - Create a group node with `type: "siteGroup"`, positioned at bbox origin minus padding
   - If expanded: add children with `parentId: groupId` and relative positions + `extent: "parent"`
   - If collapsed: set `height: GROUP_HEADER_HEIGHT` (makes the group a thin header bar)
5. Filter edges to only those whose both endpoints appear in the result node set
6. Return the combined nodes + edges array

**Edge cases handled:**
- Sites with no children (empty site) — not emitted
- Nodes with no `site_id` — rendered as top-level ungrouped nodes
- Duplicate API calls to `buildGroupedLayout` — `useMemo` caches unless `expandedSites` changes

**Files modified (Session 3):**
- `frontend/src/components/topology/layout.ts` — added `GROUP_PADDING`, `GROUP_HEADER_HEIGHT` constants and `buildGroupedLayout()` function
- `frontend/src/components/topology/topology-graph.tsx` — added `SiteGroupNode` component, `expandedSites` state, `buildGroupedLayout` call, site toggle in `onNodeClick`, `onlyRenderVisibleElements`
- `frontend/src/app/topology/page.tsx` — removed `selectedSiteId`, filter pills, client-side filtering; passes `graphData` directly

---

## 3. Current State of the Database

**Query result (post-cycle, working):**

| Table | Data |
|---|---|
| `topology_nodes` | 1,947 APs + 450 switches + 60 sites = 2,457 nodes |
| `topology_edges` | 1,947 site_membership + 1,090 physical_link = 3,037 edges |
| `events` | ~5,577 events per cycle (527 Mist alarms, 1,383 AP history, 1,090 wired uplinks, etc.) |
| `incidents` | ~440 correlated incidents per cycle |

**Inventory:** 1,947 Mist devices (APs)

---

## 4. What Is Still Left / Known Issues

### 4.1 Performance — Parent-Child Grouping Implemented (Session 3)

**Status: RESOLVED.** Replaced the Session 2 filter-pill workaround with ReactFlow `parentId`-based grouping (see 2.7 for details).

What is now possible:
- **See ALL devices across ALL sites** — all 2,500 nodes are sent to the browser. By default only 60 collapsed group headers render. Expanding a site reveals its children.
- **In-graph expand/collapse** — clicking a site group node toggles it.
- **Multi-site comparison** — expand multiple sites simultaneously, zoom to fit.
- **Blast radius across sites** — highlighted nodes appear inside their expanded groups.

**Still left (minor improvements):**
- **Type filter toggles** — "show only switches", "hide APs" checkbox filters would let users declutter further. Currently all nodes within expanded sites are visible.
- **Search/zoom-to-node** — a search box that finds a node and auto-expands its parent site, then fits view on the node. Requires `site_id` lookup from the TopologyNode data.
- **Collapse-all / expand-all** — one-click button to collapse or expand every site. Currently each site must be clicked individually.
- **Auto-layout on expand** — when expanding a site with many children inside a small viewport, the child nodes may overflow the visible area. `reactFlowInstance.fitView({nodes: expandedChildren})` on expand would help.
- **Edge aggregation** — collapsed sites currently lose all cross-site edges. Showing a "count" badge or summary edges between site groups would give users signal about inter-site connectivity.

### 4.2 VeloCloud Collector is Broken

- **Error:** `AttributeError: 'VeloCloudCollector' object has no attribute '_base'`
- `_base_url` is referenced as `_base` in one code path in `velocloud.py`
- No VeloCloud edges, sites, or WAN links in topology — the worker continues past this error
- **Impact:** SD-WAN topology is completely missing. If VeloCloud is your primary WAN, the graph shows no WAN links, no edge devices, no internet gateways.

### 4.3 Mist Radio Neighbors Collector Returns 404

- `/api/v1/sites/{site_id}/radio/neighbors` returns 404 for all sites
- Likely requires an additional Mist subscription tier (maybe Wired Assurance or Marvis)
- **Impact:** No RF interference edges — minor, the data is additive

### 4.4 Slow Collection Cycle Due to Duplicate API Calls

- Three Mist sub-collectors independently fetch `GET /api/v1/sites/{site_id}/stats/devices` (same endpoint, same response)
- 61 sites × 3 collectors = 183 serial API calls per cycle
- **Result:** 3-4 minute collection cycle
- **Fix:** Pre-fetch device stats once in the orchestrator and pass to each sub-collector
- **Alternative:** Cache the httpx response in-memory keyed by URL during a single `collect_all()` call

### 4.5 Worker Health Check Mismatch

- Container STATUS shows "(unhealthy)" despite working correctly
- The Docker health check period is shorter than the actual collection cycle (~3 min)
- **Fix:** Either increase the health check interval/retries in `docker-compose.yml` or use a lightweight health endpoint (e.g., `GET /health` that just confirms the event loop is alive, not that a full cycle completed)

### 4.6 No SNMP, DNAC, or Arista WLC Configured

| Source | Config Status | Impact |
|---|---|---|
| DNAC | `dnac_enabled = False` | No Cisco network device health/events |
| SNMP | No credentials configured | No switch/router LLDP polling — switches are only discovered via Mist AP LLDP reports |
| Arista WLC | `arista_wlc_enabled = False` | No Arista wireless controller events |

Without these, the only switches in topology are the 450 discovered passively via Mist APs' LLDP. No core switches, no routers, no firewalls.

### 4.7 Docker Build Fails (pip Network Issue)

- `pip install` during `docker compose build` fails with `Temporary failure in name resolution` to `files.pythonhosted.org`
- **Workaround:** `docker cp` modified files into the running container (since dev compose uses volume mounts for code, this works for the frontend; backend containers need a rebuild or manual copy)
- **Fix:** Docker DNS configuration or host proxy settings — or pre-build images with a registry

### 4.8 No Collector Unit Tests

- `MistWiredUplinkCollector`, `MistApHistoryCollector`, `TopologySync`, and all other collectors have **zero unit tests**
- 1 pre-existing test failure in `test_topology_api.py::TestBlastRadius::test_returns_subgraph_with_root_cause` — `AsyncMock` doesn't return proper attribute values
- 98/99 tests pass (all 78 correlation tests, 20/21 topology API tests)

### 4.9 Single Worker = No Fault Isolation

- All collectors run in one process. A crash in any collector (like VeloCloud's `_base` error) doesn't stop others from running, but an unhandled exception in `insert_events()` or the correlation engine crashes the entire cycle.
- No retry-per-collector — if one API is down, the whole cycle is slower
- **Fix:** Wrap each collector in its own try/except (most already are), add per-collector timeouts, and eventually move to a task queue

---

## 5. Relevant Files

### Frontend
| File | Purpose |
|---|---|
| `frontend/src/app/topology/page.tsx` | Topology page — passes full graphData to TopologyGraph (no client-side filtering) |
| `frontend/src/components/topology/topology-graph.tsx` | ReactFlow graph with `SiteGroupNode`, `expandedSites` state, `buildGroupedLayout`, `onlyRenderVisibleElements` |
| `frontend/src/components/topology/layout.ts` | dagre layout engine with `buildLayout()` (flat) and `buildGroupedLayout()` (hierarchical with parent-child grouping) |
| `frontend/src/components/topology/topology-side-panel.tsx` | Context-switching panel (Blast Radius / Node Detail) |
| `frontend/src/components/topology/health-history-chart.tsx` | Health trend bar chart |
| `frontend/src/components/topology/health-history-chart.test.tsx` | 7 tests for health chart |
| `frontend/src/components/topology/node-detail-panel.tsx` | Node detail panel |
| `frontend/src/components/topology/blast-radius-panel.tsx` | Blast radius subgraph panel |
| `frontend/src/types/topology.ts` | TypeScript types for topology data |
| `frontend/src/lib/api.ts` | API client (`getTopology`, `getTopologyNode`, etc.) |
| `frontend/vitest.setup.ts` | Test setup (jest-dom import only) |
| `frontend/vitest.config.ts` | Vitest config — `oxc` JSX runtime configured |

### Backend
| File | Purpose |
|---|---|
| `backend/worker/main.py:132` | Fixed missing `await` on `process_events()` |
| `backend/worker/collectors/mist_topology.py` | 5 sub-collectors (AP history, AP RF, client topology, wired uplink, radio neighbors) + orchestrator |
| `backend/worker/collectors/topology_sync.py` | Builds `topology_nodes` + `topology_edges` from inventory + events; fixed MAC→UUID node mapping |
| `backend/worker/collectors/health_snapshot.py` | Health snapshot collector (per-node health state every 5 min) |
| `backend/shared/models/event.py` | UnifiedEvent model — added `_strip_null()` sanitizer |
| `backend/shared/health.py` | Shared health derivation logic |
| `backend/shared/database/events.py` | Event CRUD — `insert_event`, `insert_events`, `get_event`, etc. |
| `backend/api/routes/topology.py` | Topology API routes (get graph, summary, node detail, blast radius) |
| `backend/worker/collectors/mist_inventory.py` | Mist inventory collector (stores `device_id` as Mist UUID) |

### Config & Infra
| File | Purpose |
|---|---|
| `docker-compose.yml` | Production Docker Compose |
| `docker-compose.dev.yml` | Dev overrides with volume mounts for hot-reload |
| `config/.env` | Environment config (Mist API key, org ID, etc.) |
| `AGENTS.md` | AI agent instructions — includes graphify workflow |

---

## 6. How to Test / Verify

### Worker collects wired uplinks
```bash
docker compose logs worker | grep "Mist wired uplinks"
# Expected: "Mist wired uplinks: 1090 links collected"
```

### Topography sync completes
```bash
docker compose logs worker | grep "Mist physical links"
# Expected: "Mist physical links: 1090 AP→switch edges from wired uplink data"
docker compose logs worker | grep "Topology sync complete"
# Expected: "Topology sync complete"
```

### Database has topology data
```bash
docker compose exec postgres psql -U naxis -d naxis -c \
  "SELECT node_type, COUNT(*) FROM topology_nodes GROUP BY node_type ORDER BY COUNT DESC"
docker compose exec postgres psql -U naxis -d naxis -c \
  "SELECT edge_type, COUNT(*) FROM topology_edges GROUP BY edge_type ORDER BY COUNT DESC"
```

### Frontend — topology page
- Open `http://localhost:3000/topology`
- Default view: 60 site nodes, fast and responsive
- Click a site pill: drill into that site's APs and switches
- Click "All sites": back to overview

### Tests
```bash
# PowerShell:
$env:PYTHONPATH = "E:\Network Resilient Platform"; pytest backend\tests\ -v

# Frontend (with dev compose running):
docker compose exec web npm test
```

---

## 7. Commands Cheat Sheet

```bash
# View worker logs (real-time follow)
docker compose logs -f worker

# Copy file into running container (Docker build broken workaround)
docker cp "E:\path\to\file.py" naxis-worker:/app/path/to/file.py

# Restart worker after code change
docker compose restart worker

# Query topology database
docker compose exec postgres psql -U naxis -d naxis

# Rebuild worker image
docker compose build worker
```

---

## 8. Architecture

### 8.1 Design: Single Worker Process

All collectors run inside **one Python process** (`python -u -m worker.main` inside the `naxis-worker` container). There is no horizontal scaling, no worker queues, no separate worker per vendor.

**Why single worker?**

The codebase started as a prototype/MVP. The trade-offs:

- **Pros:** Simple deployment (one container), sequential execution guarantees no race conditions on shared state, easy to debug (single log stream), no need for message queue infrastructure
- **Cons:** Any collector crash takes down ALL collectors in that cycle, collection is serial (slow — 3-4 min per cycle with 61 Mist sites), no parallelism for independent data sources, not horizontally scalable

**What it would take to split:** Move to a task-queue architecture (Celery + Redis or RabbitMQ). Each collector becomes an independent task. The `TopologySync` runs after all collector tasks complete. This adds significant complexity (task serialization, result aggregation, failure handling, queue management) — overkill for the current data volume (~5,000 events/cycle).

### 8.2 Full Collector Inventory

Every collector listed below runs sequentially within the single worker process.

| Collector | Source | Purpose | Status |
|---|---|---|---|
| `mist.py` — `MistCollector` | Mist API (alarms + logs) | Ingests Mist alarms and audit logs as UnifiedEvents | Working |
| `mist_inventory.py` — `MistCollector` | Mist API (inventory + stats) | Maintains device inventory table from Mist | Working |
| `mist_topology.py` — `MistTopologyCollector` | Mist API (device stats) | 5 sub-collectors: AP history, AP RF, client topology, wired uplink, radio neighbors | Working (radio neighbors 404s) |
| `health_snapshot.py` — `HealthSnapshotCollector` | events + inventory tables | Per-node health snapshots every 5 minutes | Working |
| `velocloud.py` — `VeloCloudCollector` | VeloCloud API | VeloCloud events (alerts, edge status) | **Broken** — `AttributeError: 'VeloCloudCollector' object has no attribute '_base'` |
| `velocloud_inventory.py` — `VeloCloudCollector` | VeloCloud API | VeloCloud device inventory | Unknown |
| `velocloud_metrics.py` — `VeloCloudMetricsCollector` | VeloCloud API | WAN link metrics per edge | Unknown |
| `snmp_poller.py` — `SnmpPoller` | SNMP (network devices) | Polls LLDP/CDP neighbor tables from switches/routers | Not configured |
| `dnac.py` — `DNACCollector` | Cisco DNAC API | Cisco network device health and topology | Not enabled |
| `arista_wlc.py` — `AristaWlcCollector` | Arista WLC API | Arista wireless controller events | Not enabled |

### 8.3 Shared Data Schema

All collectors write into the same schema, making the topology graph vendor-agnostic:

```
events table                      topology_nodes           topology_edges
┌──────────────────────┐          ┌──────────────┐         ┌──────────────┐
│ event_id (PK)        │          │ node_id (PK) │         │ src_id (FK)  │
│ source (mist/velo…)  │          │ node_type    │         │ dst_id (FK)  │
│ device_id            │          │ site_id      │         │ edge_type    │
│ metadata (JSONB)     │          │ vendor       │         │ props (JSONB)│
│ raw_event (JSONB)    │          │ props (JSONB)│         └──────────────┘
│ incident_id (FK)     │          └──────────────┘
│ ...                  │
└──────────────────────┘
```

- **`events`** — every collector writes normalized events here
- **`topology_nodes`** — `TopologySync` reads inventory + events, builds nodes (site, ap, switch, edge, wan_gateway)
- **`topology_edges`** — `TopologySync` builds edges (site_membership, physical_link, wan_link)
- Node IDs use a `{vendor}-{type}-{id}` prefix convention: `mist-site-{uuid}`, `mist-ap-{uuid}`, `switch-{mac}`, `velo-edge-{id}`, `wan-gw-{name}`

### 8.4 Complete Data Flow

```
 ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────────┐
 │     Mist API         │    │   VeloCloud API      │    │  SNMP / DNAC / Arista    │
 │                      │    │                      │    │                          │
 │  ✓ Mist Collector    │    │  ✓ VeloCloud Col.    │    │  ✗ DNAC Collector (dis.) │
 │  ✓ Mist Inventory    │    │  ✓ VeloCloud Inv.    │    │  ✗ SnmpPoller (no creds) │
 │  ✓ Mist Topology     │    │  ✓ VeloCloud Metrics │    │  ✗ Arista WLC (disabled) │
 └────────┬─────────────┘    └──────────┬───────────┘    └──────────────────────────┘
          │                             │
          └──────────────┬──────────────┘
                         ▼
          ┌──────────────────────────────────────┐
          │   Worker main.py (single process)    │
          │                                      │
          │  1. Run all collectors sequentially  │
          │     → each returns CollectorOutcome  │
          │                                      │
          │  2. insert_events(all_events)        │
          │                                      │
          │  3. Correlation Engine               │
          │     ├── Flat rules (by site/device)  │
          │     └── TopologyCascadeRule          │
          │                                      │
          │  4. TopologySync.sync()              │
          │     ├── _sync_mist_topology          │
          │     ├── _sync_mist_physical_links    │
          │     └── _sync_velocloud_topology     │
          └──────────────────┬───────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │     Postgres Database        │
          │  events / topology_nodes     │
          │  topology_edges / inventory  │
          └──────────────┬───────────────┘
                         ▼
          ┌──────────────────────────────┐
          │  Topology API (FastAPI)      │
          │  GET /topology               │
          │  GET /topology/nodes/{id}    │
          │  GET /topology/blast-radius  │
          └──────────────┬───────────────┘
                         ▼
          ┌──────────────────────────────┐
          │  Frontend TopologyPage       │
          │  TopologyGraph (ReactFlow)   │
          │  TopologySidePanel           │
          │  HealthHistoryChart          │
          └──────────────────────────────┘
```
