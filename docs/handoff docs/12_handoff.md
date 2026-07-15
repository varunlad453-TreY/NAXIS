# Handoff Document — Session 12

**Date:** 2026-07-15
**Project:** Network Resilient Platform (Naxis)
**AI Agent:** opencode (deepseek-v4-flash-free)

---

## 1. Session Objective

Implement a drill-down topology architecture to handle the real-world dataset (2651 nodes, 3147 edges, 153 sites). The previous flat-all-at-once approach froze the browser and showed 153 tiny unreadable site boxes. The new design shows a backbone of site nodes + inter-site edges by default, and fetches per-site internal topology on click.

---

## 2. What Was Done

### 2.1 Backend — New Endpoints

**`GET /topology/backbone`** (`backend/api/routes/topology.py:286`)

Returns only site nodes (`WHERE node_type = 'site'`) and inter-site edges (`WHERE n1.site_id != n2.site_id`). Each site node includes `device_count` (number of child devices). Lightweight — ~153 nodes instead of 2651.

**`GET /topology/sites/{site_id}/internal`** (`backend/api/routes/topology.py:345`)

Returns all nodes in a site (`WHERE site_id = $1`) plus edges connecting them. Also appends the site node itself if it exists in `topology_nodes`. Single query per category, no full-table scans.

### 2.2 Backend — New Model

`TopologyBackboneNode` extends `TopologyNode` with `device_count`, `critical_count`, `warning_count`.

`TopologyBackboneResponse` wraps a list of `TopologyBackboneNode` + `TopologyEdge`.

### 2.3 Frontend — Drill-Down Data Flow

**`page.tsx` changes:**
- Maintains `drillDownSiteId` state (separate from URL `?site_id=`)
- Default (no URL param): fetches `api.getTopologyBackbone()` at 60s intervals
- On site click: sets `drillDownSiteId`, fetches `api.getSiteTopology(id)` at 30s intervals
- Shows "← All sites" back button in drill-down mode
- Passes `onSiteSelect` callback to `TopologyGraph`

**`topology-graph.tsx` changes:**
- New prop: `onSiteSelect?: (siteId: string) => void`
- Click on a `topologyNode` with `node_type === "site"` calls `onSiteSelect(siteId)` (drill-down)
- Click on a `siteGroup` still toggles expand/collapse (internal mode)
- `TopologyNodeComponent` shows `device_count` badge for site nodes

### 2.4 Frontend — Backbone SiteBrowser (replaced ReactFlow graph)

The backbone view no longer forces site nodes into a ReactFlow canvas with dagre (which produced a useless grid of 153 disconnected boxes with only 5 edges). Instead, `page.tsx` renders a **`SiteBrowser`** component: a searchable, vendor-filterable card grid showing site name, vendor icon (Mist/VeloCloud), device count, and health dot. Clicking a card drills into that site's internal topology using `TopologyGraph`.

**Files:**
- `page.tsx` — `SiteBrowser` + `SiteCard` inline components, conditional render vs `TopologyGraph`
- `types/topology.ts` — added `device_count`, `critical_count`, `warning_count` to `TopologyNode`

### 2.5 Frontend — Theme Toggle in Collapsed Sidebar

Removed `!collapsed &&` guard in `sidebar.tsx:120` so the dark/light toggle is always visible regardless of sidebar state.

### 2.6 Frontend — API Client

New methods in `frontend/src/lib/api.ts`:
- `api.getTopologyBackbone()` → `GET /topology/backbone`
- `api.getSiteTopology(siteId)` → `GET /topology/sites/{siteId}/internal`

### 2.6 Web Worker Fix (from Session 11, completed properly)

`use-topology-layout.ts` now actually creates a Web Worker from `layout.worker.ts` instead of just running `setTimeout(0)`. Dagre layout runs off the main thread.

### 2.7 Backend Performance Fix (from Session 11, completed)

When filtering by `site_id` or `node_type`, edges are queried with `WHERE src_id = ANY(...) OR dst_id = ANY(...)` instead of scanning the full `topology_edges` table.

---

## 3. Architecture

```
Default: /topology
  │
  ├── api.getTopologyBackbone()
  │   └── Site nodes + inter-site edges only
  │       └── Rendered as SiteBrowser (searchable card grid, not ReactFlow)
  │           └── User clicks a site card
  │               └── api.getSiteTopology(siteId)
  │                   └── TopologyGraph (ReactFlow + dagre) shows internal devices
  │
  └── "← All sites" button → back to SiteBrowser

Deep-link: /topology?site_id=XXX
  └── api.getTopology({ site_id }) → flat TopologyGraph for that site
```

---

## 4. Files Created/Modified

### Backend

| File | What Changed |
|---|---|
| `backend/api/models/topology_models.py` | Added `TopologyBackboneNode`, `TopologyBackboneResponse` |
| `backend/api/routes/topology.py` | Added `GET /topology/backbone`, `GET /topology/sites/{site_id}/internal`, 6 new SQL queries |
| `backend/tests/test_topology_api.py` | Added `TestGetTopologyBackbone` (4 tests), `TestGetSiteInternalTopology` (4 tests). Fixed `_default_fetch_sequence` for filtered queries. Fixed blast radius incident mock. |

### Frontend

| File | What Changed |
|---|---|
| `frontend/src/lib/api.ts` | Added `getTopologyBackbone()`, `getSiteTopology(id)` |
| `frontend/src/app/topology/page.tsx` | `SiteBrowser` + `SiteCard` components, backbone renders card grid instead of ReactFlow, drill-down state machine |
| `frontend/src/components/topology/topology-graph.tsx` | Added `onSiteSelect` prop, site click handling in drill-down, device_count display |
| `frontend/src/components/layout/sidebar.tsx` | Theme toggle now always visible (removed `!collapsed` guard) |
| `frontend/src/types/topology.ts` | Added `device_count`, `critical_count`, `warning_count` to `TopologyNode` |
| `frontend/src/components/topology/layout.ts` | Added early return for pure-site input (backbone dagre fallback) |
| `frontend/src/components/topology/layout.test.ts` | Added test: "returns flat layout when all nodes are sites" |

### Documentation

| File | What Changed |
|---|---|
| `docs/TOPOLOGY_VISUALIZATION.md` | Full rewrite — drill-down architecture, new endpoints, updated component tree, new test counts |
| `docs/handoff docs/12_handoff.md` | This file |

---

## 5. How to Verify

### Backend tests
```bash
cd backend && python -m pytest tests/test_topology_api.py -v
# 29 tests, all pass
```

### Frontend tests
```bash
cd frontend && npx vitest run src/components/topology/
# 57 tests, all pass
```

### Manual test
```bash
# Start the platform
.\start-dev.ps1

# 1. Open http://localhost:3000/topology
# 2. Should see SiteBrowser — searchable card grid of ~153 sites with vendor icon, device count, health dot
# 3. Search for "Lucknow" → filters cards in real-time
# 4. Filter by vendor dropdown → narrows to Mist/VeloCloud sites
# 5. Click "Lucknow Mesh" card → loads internal topology for that site (actual ReactFlow graph)
# 6. Shows "← All sites" button → click it → back to SiteBrowser
# 7. Try /topology?site_id=aae2bc9a-a3bf-42d3-8055-2bbe3af7d0fb → direct deep-link to Lucknow Mesh

# Old endpoints still work
# 6. /topology?site_id=f01c4f35-e780-45e4-bd77-b5a478c3e5a9 → shows "Lucknow : Factory (A05)" with all 100+ devices
# 7. /topology?incident=xxx&highlight=node1,node2 → blast radius view
```

---

## 6. Trade-offs

| Before | After |
|---|---|---|
| 2651 nodes in one dagre layout → 2-10s freeze | Backbone SiteBrowser (instant render) → dagre only for ~20-50 devices per site |
| All 153 sites as ReactFlow nodes → unreadable | SiteBrowser card grid with search + vendor filter → usable |
| Single `GET /topology` poll every 30s (2-5 MB) | Backbone poll every 60s (~50 KB) + on-demand per site (~100 KB) |
| One query path | Two query paths (SiteBrowser + TopologyGraph) |
| dagre layout on every render | dagre only when drilling into a site with actual edges |

---

## 7. Known Caveats

- **Backbone health:** Site health in backbone view is derived from the site node's own health status, not aggregated from children. Site nodes may show "unknown" health since they don't appear in events/inventory. Future: aggregate child device health per-site.
- **Browser back button:** Navigating "back" after drill-down doesn't restore the backbone view — URL doesn't change. Future: use `history.replaceState` or query params for drill-down state.
- **Site node naming:** Some sites have names like "null, null (Mumbai, IN)" or "site-xxxxx". These come from the Mist API / inventory data. The topology visualization just displays what the data has.

---

## 8. Test Results

```
Backend: 29 passed (29)
Frontend (topology): 57 passed (57)
Frontend (total): 80 passed (80)
```

### Test Breakdown

| Test File | Tests |
|---|---|
| `test_topology_api.py` — existing | 21 |
| `test_topology_api.py` — backbone | 4 |
| `test_topology_api.py` — site internal | 4 |
| `layout.test.ts` | 21 |
| `use-topology-layout.test.ts` | 4 |
| `blast-radius-panel.test.tsx` | 10 |
| `node-detail-panel.test.tsx` | 10 |
| `topology-side-panel.test.tsx` | 6 |
| `health-history-chart.test.tsx` | 6 |
| `topology.test.ts` | 2 |
| `app/topology page tests` | 1+ |

---

## 9. Future Improvements

- **Aggregate site health:** Query child device health per-site and roll up to site health in backbone view.
- **URL-synced drill-down:** When drilling into a site, update URL to `?site_id=X` so browser back/forward works and the state is shareable.
- ~~**Search across backbone:**~~ ✅ Done — SiteBrowser has real-time search + vendor filter.
- **Breadcrumbs:** Show "Topology > Lucknow Mesh" breadcrumb when drilling down.
- **Client-side caching:** Cache site internal data for recently viewed sites so clicking back-and-forth is instant.
