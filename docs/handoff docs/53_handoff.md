# Topology Routing Refactor, Context Graph Redesign & Site Graph Readability — Engineering Handoff

**Date:** 2026-08-16
**Scope:** Implement the 4-phase topology routing refactor from handoff 52's plan doc; redesign the device context graph page with rich node cards and a detail panel; fix the "hairball" graph at medium-sized sites (30–100 devices) with alerting-scope filtering, bigger node cards, and edge bundling.
**Author:** varun

---

## 1. Phase 1–4 Routing Refactor (from plan doc 52)

### 1.1 What was built

Three new Next.js routes replace the single monolithic `/topology?site_id=` URL:

```
/topology                            →  Backbone / global network (new TopologyBackboneView)
/topology/sites/[site_id]            →  Single-site operational view (new TopologySiteShell)
/topology/context/[node_id]          →  Device context graph (new page)
```

**URL state contract** — all view state survives refresh and is shareable:

| Param | Values | Page |
|---|---|---|
| `view` | `impact \| clusters \| graph` | `/topology/sites/[site_id]` |
| `view` | `regions \| degraded \| all` | `/topology` (backbone) |
| `scope` | `alerting \| all` | `/topology/sites/[site_id]` |
| `layout` | `readable \| readable-lr \| hierarchical \| flat` | `/topology/sites/[site_id]` |
| `highlight` | comma-separated node IDs | all pages |
| `incident` | incident UUID | all pages |

**Redirect:** `/topology?site_id=xyz` automatically redirects to `/topology/sites/xyz`, preserving all other query params. All internal links updated.

### 1.2 Extracted components

| Component | File | Responsibility |
|---|---|---|
| `TopologyGraphCanvas` | `topology-graph-canvas.tsx` | Pure ReactFlow wrapper (canvas + minimap + controls + legend). Accepts `children` for overlaid panels. No state. |
| `TopologyBackboneView` | `topology-backbone-view.tsx` | Backbone view: state, queries (incident/blast-radius/node), layout computation, region hub side panel, AllSitesGrid. |
| `TopologySiteShell` | `topology-site-shell.tsx` | Site view: all UI state, queries, layout computation, path trace, view switcher, health scope, rank toggles, WorstOffendersStrip, HostMapView / AggregatedView / canvas rendering. |

`TopologyGraphV2` is preserved in place but no longer imported by any page. Safe to delete after NOC verification.

### 1.3 New page files

- `frontend/src/app/topology/sites/[site_id]/page.tsx` — fetches site data + summary, manages URL state, renders `TopologySiteShell`.
- `frontend/src/app/topology/context/[node_id]/page.tsx` — fetches node detail, renders split layout (context graph + detail panel).
- `frontend/src/app/topology/page.tsx` — rewritten to backbone-only; `?site_id=` redirect; backbone view mode URL-backed.

### 1.4 Link updates

- `frontend/src/app/locations/page.tsx`: "Topology Graph" link → `/topology/sites/[location_id]`
- `frontend/src/app/incidents/[id]/page.tsx`: "View in Topology" link unchanged (targets backbone `/topology?highlight=...&incident=...`, which is still correct)

---

## 2. Context Graph Page Redesign

### 2.1 Before

The `/topology/context/[node_id]` page rendered a small ReactFlow graph with generic `type: "default"` boxes: plain dark rectangles showing only the device name. No health status, no IP, no vendor/model, no actionable information.

### 2.2 After

**Custom `ContextNodeCard` component** (in `context-graph.tsx`):
- 220×110 px card with 3px health-color bar at top
- Device type icon (Wifi, Network, Server, etc.) + type label + health badge (colored)
- Device name (word-break all to handle long IDs)
- IP address in monospace
- Vendor · Model line
- Focus device gets a glow ring in its health color + "← Focus device" tag

**Better layout:**
- Parents row at top, focus node in center, children row at bottom
- Parent edges: dashed indigo with "upstream" label
- Child edges: solid slate with arrow
- Layer legend strip above the canvas

**Split page layout** (two-column grid on `lg:` viewports):
- Left: context graph
- Right: detail panel with **Device Info** (IP, vendor, model, site, node ID, health label, props), **Connections** (clickable upstream/downstream device list), **Health History** chart

Clicking any node in the panel or graph navigates to that device's context page.

---

## 3. Site Graph Readability Fixes

### 3.1 Problem

A 48-device site (e.g. Thane: Regional Office A13) produced a hairball identical to a 155-device site:
- Scope filtering was gated on `isLargeSite` (threshold 50), so 48 devices bypassed it entirely
- Node cards were 170×42px — names truncated, zero additional info
- View switcher (Impact map / Clusters / Device graph) hidden for non-large sites
- 42 individual AP→switch edge lines drawn independently

### 3.2 Fixes

**Scope filtering for all sites** (`topology-site-shell.tsx`):
- Moved `computeAlertScope` outside the `isLargeSite` guard
- All sites now respect the `scope` param — `alerting` shows only critical/warning devices + their upstream path; `all` shows everything

**Bigger site-view node cards** (`topology-node-types.tsx`):
- New `SiteViewNodeCard` component: 220×86px, health bar, type icon, health badge, name, IP
- Used by `buildReadableHierarchicalLayout` when `siteView: true`

**Spacing constants updated** (`topology-layout-engine.ts`):
- `SITE_RANKSEP`: 140 → 180; `SITE_NODESEP`: 80 → 100; margins increased
- `MAX_RANK_PX` raised to 2200 for site-view to accommodate wider cards
- `maxNodesPerSubRow` floor lowered from 6 to 4

**Edge bundling with ×N labels** (`topology-layout-engine.ts` + `topology-edge-types.tsx`):
- `buildGraphEdges` now groups parallel edges by (source, target) key
- Bundled edges render as one thicker line with a `×N` badge
- Worst health status across the bundle governs edge color
- `bundleCount` added to `GraphEdgeData` type

**View switcher threshold lowered** (`topology-site-shell.tsx`):
- Was: only shown for `isLargeSite` (≥ 50 devices)
- Now: shown for any site with > 15 devices

### 3.3 Result (Thane: 48 devices, 2 critical APs)

| Mode | What renders |
|---|---|
| `view=graph&scope=alerting` (default) | 3 nodes: site + 2 critical APs. Red dashed edges. Instantly actionable. |
| `view=graph&scope=all` | 3 layers: site → 6 switch cards → AP rows. Clean hierarchy, no hairball. |

---

## 4. File Inventory

### New files

| File | Purpose |
|---|---|
| `frontend/src/components/topology/topology-graph-canvas.tsx` | Pure ReactFlow canvas wrapper |
| `frontend/src/components/topology/topology-backbone-view.tsx` | Backbone view with state + queries |
| `frontend/src/components/topology/topology-site-shell.tsx` | Site view shell with all state + computation |
| `frontend/src/app/topology/sites/[site_id]/page.tsx` | Deep-linkable site page |
| `frontend/src/app/topology/context/[node_id]/page.tsx` | Device context page (redesigned) |

### Modified files

| File | Change |
|---|---|
| `frontend/src/app/topology/page.tsx` | Backbone-only; `?site_id=` redirect; backbone view mode URL-backed |
| `frontend/src/app/locations/page.tsx` | Link updated to `/topology/sites/[id]` |
| `frontend/src/components/topology/context-graph.tsx` | Full rewrite: custom node cards, better layout, `CONTEXT_NODE_TYPES` |
| `frontend/src/components/topology/topology-node-types.tsx` | Added `SiteViewNodeCard` (220×86); added `siteViewNode` to `topologyNodeTypes` |
| `frontend/src/components/topology/topology-layout-engine.ts` | `siteView` option; bigger spacing; edge bundling; `adjacentRanksOnly` option |
| `frontend/src/components/topology/topology-edge-types.tsx` | Renders ×N bundle count badge |
| `frontend/src/components/topology/topology-graph-model.ts` | Added `bundleCount` to `GraphEdgeData` |
| `frontend/src/components/topology/topology-site-shell.tsx` | Scope filtering for all sites; view switcher for >15 devices; `siteView: true` layout |
| `frontend/src/components/topology/index.ts` | Exports for new components |

---

## 5. Verification

- **TypeScript:** `npx tsc --noEmit` → clean (0 errors).
- **Thane (48 devices):** `scope=alerting` → 3-node graph, 2 red critical APs; `scope=all` → 3-layer clean hierarchy.
- **Context page (WHDEL_PALA51AP_AP41_31):** rich card with IP 172.18.175.75, vendor/model, Critical badge; upstream dashed line to site; detail panel shows Device Info + Health History.
- **Redirect:** `/topology?site_id=99774287-...` → `/topology/sites/99774287-...` with params preserved.
- **Backbone:** `/topology` loads backbone-only, no site data fetched; backbone view mode (`?view=regions/degraded/all`) URL-backed.

---

## 6. Gotchas

- **`TopologyGraphV2` is dead code.** It still exists in `components/topology/topology-graph-v2.tsx` and compiles clean, but is no longer imported. Delete it in the next cleanup pass.
- **Context page uses shared TanStack Query cache.** Both the page and `ContextGraph` component use `queryKey: ["topology-node-ctx", nodeId]` — one API call, no double fetch.
- **`scope` filtering is now applied to ALL sites**, not just `isLargeSite`. If a site has no alerting nodes, the scope falls through to "all" automatically (existing `computeAlertScope` behavior).
- **ReactFlow `nodeTypes` warning** (`"created a new nodeTypes object"`) appears twice in dev console from pre-existing components. `CONTEXT_NODE_TYPES` and `topologyNodeTypes` are both module-level constants — the warning is a false positive from HMR in development.
- **Backbone backbone view mode** is `?view=regions/degraded/all`, which collides with the site `?view=impact/clusters/graph` param name on the same `view` key. They live on different pages so there is no ambiguity, but be careful if a shared layout component ever reads `view`.

---

## 7. Next Steps

- Delete `topology-graph-v2.tsx` after NOC team confirms no regressions on live traffic.
- Add `?tab=` param reservation on `/topology/sites/[site_id]` for future Events / Performance sub-tabs (reserved in plan doc 52, open question 1).
- Add `?region=` param on `/topology` backbone for pre-filtered region bookmarks (plan doc 52, open question 3).
- Run vitest suite — the new components (`TopologyBackboneView`, `TopologySiteShell`, `TopologyGraphCanvas`) have no unit tests yet.
- Consider lowering `AGGREGATED_VIEW_THRESHOLD` from 50 → 30 so Thane-class sites (30–50 devices) get the hostmap as their default view instead of the device graph.
