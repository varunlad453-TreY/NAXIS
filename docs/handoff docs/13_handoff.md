# Handoff Document — Session 13

**Date:** 2026-07-15
**Project:** Network Resilient Platform (Naxis)


---

## 1. Session Objective

Fix two production bugs blocking the topology page ("Failed to load sites" 500 error, dark theme hydration mismatch), fix missing edges in site internal view (site_membership filtered out), then implement a three-mode topology architecture for large sites (385 devices) — Aggregated View → Device Browser → Context Graph — so users can navigate, filter, and investigate any device regardless of site size.

---

## 2. What Was Done

### 2.1 Backend — Fixed "Failed to load sites" (500 error)

**Root cause:** `_SITE_DEVICE_HEALTH_QUERY` in `backend/api/routes/topology.py` referenced `n.health_status` — but `health_status` is **not a DB column**. It's computed at runtime by `_enrich_health()` from events/inventory/topology props. Every backbone fetch hit that SQL, got a column-not-found error, and returned 500.

**Fix:** Removed `_SITE_DEVICE_HEALTH_QUERY`. Instead, the backbone endpoint fetches child devices per site via `_CHILD_NODES_BY_SITE`, calls `_enrich_health()` on them once (in Python), and counts `healthy`/`warning`/`critical`/`unknown` per site in memory. This is applied in `build_backbone_response_with_health()`. Same fix applied to the site summary endpoint (`GET /topology/sites/{site_id}/summary`) which also referenced the non-existent column.

**Files:**
- `backend/api/routes/topology.py:135-195` — `build_backbone_response_with_health()` replaces SQL health query with Python-based enrichment + per-site counting
- `backend/api/routes/topology.py:470-530` — site summary endpoint uses same pattern

### 2.2 Backend — Site Summary Endpoint

`GET /topology/sites/{site_id}/summary` returns device type breakdown, vendor breakdown, and health counts for a site. Uses the same Python-based health computation. Model: `SiteSummaryResponse` with `SiteHealthCounts` and `SiteDeviceTypeBreakdown`.

**Files:**
- `backend/api/models/topology_models.py` — Added `SiteHealthCounts`, `SiteDeviceTypeBreakdown`, `SiteSummaryResponse`
- `backend/api/routes/topology.py:470-530` — endpoint implementation

### 2.3 Backend — Fixed Missing Edges in Site Internal View

**Root cause:** `_EDGES_FOR_SITE_IDS` in `topology.py:178-186` explicitly filtered out `site_membership` edges (`AND e.edge_type != 'site_membership'`). In deployments without Mist Wired Assurance license, `site_membership` edges (device→site) are the ONLY edges in `topology_edges`. The filter killed them all, returning 0 edges. Dagre received no edges, so it laid out nodes in a horizontal line — isolated boxes with no connections.

**Fix:** Removed the `site_membership` filter from `_EDGES_FOR_SITE_IDS`. The query now returns all edge types within a site. The frontend's `buildLayout` (flat) handles edges correctly, creating a tree layout with the site node at top and devices hierarchically below.

**Files:** `backend/api/routes/topology.py:178-186` — removed `AND e.edge_type != 'site_membership'`

### 2.4 Frontend — Auto-Fit View on Initial Load

Added a `firstFitDone` ref and `useEffect` that calls `reactFlowInstance.fitView()` when the layout first completes with non-empty nodes. Previously the graph only auto-fitted for highlighted/blast-radius nodes. Now it smoothly zooms to fit the entire tree on first render.

**Files:** `frontend/src/components/topology/topology-graph.tsx` — auto-fit effect

### 2.5 Frontend — Flat Layout for Single-Site Internal View

When viewing a single site's internal topology, the graph now uses flat `buildLayout` (dagre tree) instead of `buildGroupedLayout` (site group wrapper). All node types are visible by default. The expand/collapse toolbar is hidden since there's nothing to group.

**Files:**
- `frontend/src/components/topology/use-topology-layout.ts` — `grouped` param
- `frontend/src/components/topology/topology-graph.tsx` — `singleSite` detection + flat layout
- `frontend/src/components/topology/layout.worker.ts` — `grouped` flag support

### 2.6 Frontend — Fixed Dark Theme Hydration Mismatch

**Root cause:** In `theme-toggle.tsx`, SSR always renders `resolvedTheme = "dark"` (showing the Sun icon), but `themeScript` in `layout.tsx` may set `data-theme="light"` before hydration. After hydration, the `useEffect` corrects it — causing a flash of inverted icon on first load.

**Fix:** Added a `mounted` state variable. During SSR (before mount), render an empty `<div>` placeholder. After mount, render the correct icon. No hydration mismatch, no flash.

**Files:**
- `frontend/src/components/ui/theme-toggle.tsx` — `mounted` guard

### 2.4 Frontend — URL-Synced Drill-Down

Drill-down state is now driven by `?site_id=` URL param, not React state:
- Clicking a site card calls `router.push("/topology?site_id=X")` — adds browser history entry
- Browser back/forward restores backbone view automatically
- Deep-linking works: `/topology?site_id=XXX` loads site internal directly
- "All sites" calls `router.push("/topology")` — clears param

### 2.5 Frontend — Breadcrumbs + SiteHealthSummary + Filter Chips

- Breadcrumbs: "Topology / Site Name" shown when drilled into a site
- `SiteHealthSummary`: health breakdown bar with critical/warning/healthy/unknown counts
- Device type filter chips + vendor breakdown chips in internal view

### 2.6 Frontend — Aggregated Site Health in SiteCard

`SiteCard` no longer shows the raw site node `health_status` (always `"unknown"` because site nodes don't appear in events). Instead, `deriveAggregatedHealth()` derives health from child device counts:
```
if device_count == 0 → "unknown"
if critical_count > 0 → "critical"
if warning_count > 0 → "warning"
else → "healthy"
```

### 2.7 Frontend — Three-Mode Topology Architecture (Large Sites)

For sites with ≥50 devices, the graph now uses a three-mode system instead of rendering all 385+ nodes at once:

**Mode 1: Aggregated View** (default for large sites)
Devices are grouped into category clusters (Infrastructure, Wireless, Edge, Leaf) with aggregated health distribution. Each cluster shows total count, health dot (worst-child), and critical/warning/healthy badges. Clusters are connected to the site node via dashed edges. 4-8 cluster nodes replace 385 individual boxes.

**Mode 2: Device Browser** (click a cluster)
Side panel opens with a searchable, filterable device list for the selected category. Supports search by name/ID/IP, filter by health status, filter by vendor, sort by multiple columns. Click any device to open its network connections.

**Mode 3: Context Graph** (click a device)
Shows a focused ReactFlow graph with the selected device, its parents (upstream), and children (downstream) in a three-level hierarchy with health-colored borders. Click any node to re-focus. Back button returns to aggregated view.

**Auto-threshold:** Sites <50 devices keep the existing flat dagre graph (no regression). Sites ≥50 auto-switch to Aggregated View. "Show all devices" button in aggregated view switches to flat graph on demand.

**Files:**
- `frontend/src/components/topology/aggregated-view.tsx` — cluster layout + canvas
- `frontend/src/components/topology/type-cluster-node.tsx` — cluster ReactFlow node
- `frontend/src/components/topology/device-browser.tsx` — searchable/filterable list
- `frontend/src/components/topology/context-graph.tsx` — 1-hop neighborhood graph
- `frontend/src/components/topology/topology-graph.tsx` — three-mode integration
- `frontend/src/types/topology.ts` — DeviceCategoryCluster, TopologyMode, threshold constant
- `frontend/src/lib/topology-utils.ts` — aggregateByCategory, computeHealthDistribution, getDeviceCategory

### 2.8 Frontend — Client-Side Caching (React Query)

| Query | staleTime | gcTime | refetchInterval |
|-------|-----------|--------|-----------------|
| Backbone | 30s | — | 60s |
| Site internal | 15s | 5 min | 30s |
| Site summary | 30s | 5 min | — |

The 5min `gcTime` means recently viewed sites render instantly when navigating back.

---

## 3. Dynamic Data Audit

**Verdict: No hardcoded/mock data in production code.** Every node, edge, and health count flows from real DB queries through live API endpoints.

**One minor finding:** `frontend/src/components/topology/layout.ts:224` — `vendor: siteNode?.vendor ?? "mist"` — sites without a vendor would display "mist". Fix: change `"mist"` to `""` or `"Unknown"`.

---

## 4. Files Created/Modified

### Backend

| File | What Changed |
|---|---|
| `backend/api/routes/topology.py` | Removed `_SITE_DEVICE_HEALTH_QUERY`, removed `_SITE_DEVICE_HEALTH_BREAKDOWN`, added `build_backbone_response_with_health()`, fixed site summary to use Python health computation |
| `backend/api/models/topology_models.py` | Added `SiteHealthCounts`, `SiteDeviceTypeBreakdown`, `SiteSummaryResponse` |
| `backend/tests/test_topology_api.py` | Added 4 tests for site summary endpoint; updated mock chains for backbone health |

### Frontend

| File | What Changed |
|---|---|
| `frontend/src/components/ui/theme-toggle.tsx` | Added `mounted` state guard against hydration mismatch |
| `frontend/src/app/topology/page.tsx` | URL-synced drill-down via `router.push("?site_id=X")`, breadcrumbs, `SiteHealthSummary`, type/vendor chips, aggregated site cards, client-side caching |
| `frontend/src/lib/topology-utils.ts` | Extracted `deriveAggregatedHealth()`, added `aggregateByCategory()`, `computeHealthDistribution()`, `getDeviceCategory()` |
| `frontend/src/lib/api.ts` | Added `getSiteSummary()` method |
| `frontend/src/components/topology/aggregated-view.tsx` | New: cluster layout + ReactFlow canvas with category cluster nodes |
| `frontend/src/components/topology/type-cluster-node.tsx` | New: cluster ReactFlow node component (icon, count, health badges) |
| `frontend/src/components/topology/device-browser.tsx` | New: searchable/filterable device list side panel |
| `frontend/src/components/topology/context-graph.tsx` | New: 1-hop neighborhood ReactFlow graph (parents → selected → children) |
| `frontend/src/components/topology/topology-graph.tsx` | Three-mode integration: auto-detect large sites, mode switching |
| `frontend/src/types/topology.ts` | Added `DeviceCategoryCluster`, `TopologyMode`, `CATEGORY_META`, `AGGREGATED_VIEW_THRESHOLD` |
| `frontend/src/lib/topology-utils.test.ts` | 15 tests for aggregation utilities |
| `frontend/src/app/topology/page.test.tsx` | 5 tests for `deriveAggregatedHealth` |

### Documentation

| File | What Changed |
|---|---|
| `docs/TOPOLOGY_VISUALIZATION.md` | Updated: new endpoints, UX flow, caching strategy, aggregated health derivation, data sources, test counts |
| `docs/handoff docs/13_handoff.md` | This file |

---

## 5. Architecture

```
/topology
  │
  ├── (no site_id) ──► GET /topology/backbone ──► SiteBrowser
  │       ├─ Search + vendor filter
  │       └─ SiteCard with aggregated health (derived from child devices)
  │           └─ Click → router.push("?site_id=X")
  │
  └── (?site_id=X) ──► GET /topology/sites/{id}/internal
                       GET /topology/sites/{id}/summary
                       ├─ Breadcrumbs: Topology / Site Name
                       ├─ SiteHealthSummary bar
                       ├─ Device type + vendor filter chips
                       └─ TopologyGraph
                           ├── < 50 devices: Flat dagre graph (existing)
                           └── ≥ 50 devices: Three-mode system
                               ├── Aggregated View (default)
                               │   └─ Click cluster → Device Browser
                               │       └─ Click device → Context Graph
                               └── "Show all devices" → Flat graph (opt-in)

Health computation (Python, not SQL):
  _enrich_health(node) → health_status
  Per-site: fetch child nodes → enrich each → count statuses → attach to backbone node

Theme toggle:
  mounted guard → empty div during SSR → correct icon after mount
```

---

## 6. Testing

```
Backend:  34 passed (34)
Frontend: 100 passed (100)
Total:   134 passed (134)
TypeScript: 0 errors (tsc --noEmit)
```

### Test Breakdown

| Test File | Tests | Notes |
|---|---|---|
| `test_topology_api.py` — existing | 21 | Blast radius, filters, enrichment |
| `test_topology_api.py` — backbone | 4 | Health count verification |
| `test_topology_api.py` — site internal | 5 | Empty DB, returns nodes+edges, appends site, membership edges, not found |
| `test_topology_api.py` — site summary | 4 | Type/health/vendor breakdown, empty DB, empty site, name resolution |
| `layout.test.ts` | 21 | Layout algorithms |
| `use-topology-layout.test.ts` | 4 | Web Worker fallback |
| `blast-radius-panel.test.tsx` | 10 | |
| `node-detail-panel.test.tsx` | 10 | |
| `topology-side-panel.test.tsx` | 6 | |
| `health-history-chart.test.tsx` | 6 | |
| `topology.test.ts` | 2 | |
| `page.test.tsx` (topology) | 5 | deriveAggregatedHealth |
| `topology-utils.test.ts` | 15 | aggregateByCategory, computeHealthDistribution, getDeviceCategory, aggregateHealth |
| Other frontend tests | 23 | Remaining across the app |

---

## 7. Known Caveats

- **Hardcoded vendor fallback:** `layout.ts:224` — `vendor: siteNode?.vendor ?? "mist"` shows "mist" for sites with no vendor. Should be `""` or `"Unknown"`.
- **Site node naming:** Some sites are named `"null, null (Mumbai, IN)"` or `"site-xxxxx"` — these come from Mist API / inventory data, not the codebase.
- **Empty-state returns:** Backend returns empty Pydantic models (empty lists, zero counts) when DB is unreachable or no data found — frontend handles these with loading/empty/error states. No mock data is injected.
- **SNMP node site_id:** SNMP-polled nodes (prefix `snmp-`) have NULL `site_id` — their edges are not found by site-scoped queries. Requires collector fix or correlation logic to assign site_id.
- **resolve_node_id() coverage:** `shared/database/topology.py:resolve_node_id()` only knows `mist-ap-` and `velo-edge-` patterns. Unknown patterns (`snmp-`, `switch-`, `wan-gw-`) fall through to return None.

---

## 8. Future Improvements

- **Cross-site device view:** A mode that shows all devices across all sites (not grouped by site), filtered by type/vendor.
- **Export topology:** Download current graph as PNG/SVG from the ReactFlow canvas.
- **Fix the vendor fallback:** Change `"mist"` to `""` in `layout.ts:224`.
- **Real-time updates:** Consider WebSocket push for health status changes instead of polling.
- **SNMP site correlation:** Assign `site_id` to SNMP nodes during collection via matching IP/subnet to known site ranges.
- **resolve_node_id expansion:** Add `snmp-{ip}`, `switch-{mac}`, `wan-gw-{isp}` patterns so the correlation engine can resolve all device types.
