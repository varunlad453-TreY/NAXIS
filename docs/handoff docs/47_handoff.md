# Backbone View Modes & Enterprise All-Sites Data Grid — Engineering Handoff

**Date:** 2026-08-13
**Scope:** Fix view mode reactivity in Backbone topology visualization, introduce custom cluster node visualizers, and build an enterprise-grade sortable/filterable data grid for managing 150+ sites in the `All Sites` view.

---

## 1. Accomplishments

### View Mode Reactivity Fix (`topology-graph-v2.tsx`)

- **Issue:** Switching between `Regional Hubs`, `Problem Sites`, and `All Sites (153)` updated toolbar stat counters but failed to update the graph canvas.
- **Root Cause:** `backboneViewMode` was missing from the `useMemo` dependency array on line 268 of `topology-graph-v2.tsx`.
- **Fix:** Added `backboneViewMode` to the dependency array, enabling immediate React Flow canvas re-computations upon mode selection.

### Custom Region & Status Nodes (`topology-node-types.tsx`)

- **`RegionalHubNodeComponent`:** High-impact 300 × 120 px cards rendered in `Regional Hubs` view:
  - Deep indigo theme (`#6366f1` / `#818cf8`) with glassmorphic backdrop.
  - Displays hub region name, total sub-sites count, AP capacity (e.g. 1,880 APs), and health status badge.
- **`StatusBannerNodeComponent`:** Renders in `Problem Sites` mode when 0 active incidents exist:
  - Clean emerald banner (`#10b981`) confirming zero critical/degraded sites across all enterprise hubs.

### Enterprise All-Sites Data Grid (`all-sites-grid.tsx`)

- **Problem:** Rendering 153 individual site nodes on a single graph canvas resulted in an unreadable "wall of micro-cards" unsuitable for NOC operations.
- **Solution:** Replaced canvas rendering in `All Sites` view mode with `AllSitesGrid`—a specialized data grid designed for enterprise scale:
  1. **Header Summary Bar:**
     - `Total Sites` (153)
     - `Operational` (healthy sites)
     - `Alerts` (warning/degraded)
     - `Critical` (critical sites)
     - `Total APs` (aggregated across network)
  2. **Search & Filter Suite:**
     - Live search by site name, ID, or region.
     - Region Filter: `North India`, `West India`, `South India`, `East India`, `Central India`, `Manufacturing`, `Other`.
     - Health Status Filter: `All Status`, `Healthy`, `Warning`, `Critical`, `Degraded`.
  3. **Multi-Column Sorting:**
     - Toggle sort direction (asc/desc) across 5 parameters: `Name`, `Status`, `Alerts`, `Devices (APs)`, `Region`.
  4. **Card UI:**
     - Left-border indicator color-coded to health status.
     - Hover elevation effect with glowing drop shadow matching health state.
     - AP count, alert badge, status indicator, and critical/warning chips.
  5. **Pagination:**
     - 24 sites per page (7 pages for 153 sites) to maintain smooth DOM rendering and quick scanability.

---

## 2. File Inventory

### New Files

| File | Responsibility |
|---|---|
| `src/components/topology/all-sites-grid.tsx` | Enterprise card grid with search, filter, sort, stats, and pagination for `All Sites` view |

### Modified Files

| File | Change |
|---|---|
| `src/components/topology/topology-graph-v2.tsx` | Added `backboneViewMode` to `useMemo` deps; conditionally renders `AllSitesGrid` when mode is `"all"` |
| `src/components/topology/topology-node-types.tsx` | Added `RegionalHubNodeComponent` and `StatusBannerNodeComponent` |
| `src/components/topology/topology-layout-engine.ts` | Added `buildRegionClustersLayout` for layout generation in regional hub view mode |
| `src/components/topology/topology-toolbar.tsx` | Added backbone view mode selector pills (`Regional Hubs`, `Problem Sites`, `All Sites`) and count badges |
| `src/components/topology/index.ts` | Exported `AllSitesGrid` and updated node type exports |

---

## 3. API Contracts Used

| Endpoint / Data Source | Usage in Views |
|---|---|
| `GET /topology/backbone` | Feeds site nodes + inter-site edges to layout engines & `AllSitesGrid` |
| `TopologyNode` fields (`health_status`, `device_count`, `critical_count`, `warning_count`, `site_id`, `site_name`) | Parsed in `AllSitesGrid` for health badges, region mapping, and metrics |

---

## 4. Verification

- **TypeScript:** `npx tsc --noEmit` → Clean (0 errors).
- **Git Push:** Successfully committed and pushed to `main` branch (`ced84f3`).
- **Interactive Verification:**
  - `Regional Hubs` → Displays regional hub nodes.
  - `Problem Sites` → Displays operational status banner when zero incidents present.
  - `All Sites (153)` → Displays 153-site enterprise data grid with live search, filtering, sorting, and pagination.

---

## 5. Next Steps

1. **Backend Region Tagging:** Expose explicit `region` fields in `topology_nodes` schema (currently derived via naming rules).
2. **Bulk Actions:** Add check-box selection in `AllSitesGrid` to allow NOC operators to run diagnostics or export reports for multiple sites simultaneously.
3. **Map Overlay:** Add a toggleable GIS map layer for regional hubs when geographic coordinate data is available.
