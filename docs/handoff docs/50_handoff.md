# Crowded Topology Readability — Engineering Handoff

**Date:** 2026-08-14
**Scope:** Make dense single-site topologies (e.g. Delhi Palwal Regional Warehouse) readable and operationally usable by adding adaptive density, collapsible ranks, zoom constraints, and wiring the existing AggregatedView for large sites into `topology-graph-v2`.

---

## 1. Problem

The readable layered layout (handoff 49) works well for small sites, but crowded warehouses/regional sites with 20-100 devices still produced an unreadable graph:

- Fixed `nodeSep = 80` meant a rank with 25 APs became 2000+ px wide.
- `fitView` zoomed out to 0.1× to fit everything, making 170 px nodes look like 17 px and text unreadable.
- No way to hide noisy layers (200 endpoints, 40 APs) to focus on infrastructure.
- `topology-graph-v2` was missing the large-site aggregated view that `topology-graph` already had.

---

## 2. Solution

### A. Adaptive sub-row wrapping in readable layout

`buildReadableHierarchicalLayout` now computes `maxNodesPerSubRow` based on a `MAX_RANK_PX = 1400` canvas target. If a rank has more nodes than fit in one row, nodes wrap into multiple sub-rows stacked vertically (or horizontally for LR). This keeps any rank within ~1400 px, so `fitView` never needs to zoom below readable levels.

### B. Zoom floor for site internal views

`minZoom` changed from `0.05` → `0.25` whenever `activeSiteId` is present. `fitView` will now pan rather than squish, and users can still zoom out manually if they want.

### C. Collapsible ranks with smart defaults

New state `collapsedRanks: Set<number>` in `topology-graph-v2`:
- **Default collapse rank 6 (endpoints)** when > 10 nodes.
- **Default collapse rank 5 (wireless/APs)** when > 20 nodes.
- Small toggle chips appear below the toolbar: `Internet 1 · Edge 2 · Core 1 · Distribution 4 · Access 12 · Wireless 18 ▼ · Endpoints 45 ▼`. Clicking toggles visibility.

Collapsed ranks are filtered out before the layout engine runs, so edges to hidden nodes disappear cleanly.

### D. Large-site aggregated view wired into v2

`topology-graph-v2` now checks `nonSiteCount >= AGGREGATED_VIEW_THRESHOLD (50)`. When true:
- Defaults to `AggregatedView` (category cluster cards: Infrastructure · Wireless · Edge · Leaf).
- Shows a mode switcher: "Show aggregated view" ↔ "Show device graph".
- `ContextGraph` is also wired in: clicking any device in the Device Browser opens a focused 3-level parent → device → children graph.

---

## 3. File Inventory

| File | Change |
|---|---|
| `topology-layout-engine.ts` | `buildReadableHierarchicalLayout` now accepts `collapsedRanks`, filters nodes before grouping, computes `maxNodesPerSubRow` from `MAX_RANK_PX = 1400`, wraps crowded ranks into sub-rows, and tracks a running `currentMain` position instead of fixed `rIndex * rankSep`. |
| `topology-graph-v2.tsx` | Added imports `AggregatedView`, `ContextGraph`, `AGGREGATED_VIEW_THRESHOLD`, `getNodeRank`. New state: `collapsedRanks`, `siteViewMode`, `contextNode`, `isLargeSite`, `resolvedSiteMode`. Added callbacks `handleContextSelect`, `handleContextBack`, `handleToggleRank`. Added rank-toggle chips UI and large-site mode switcher. Conditional rendering for `AggregatedView` / `ContextGraph` / `ReactFlow`. `minZoom={activeSiteId ? 0.25 : 0.05}`. |

---

## 4. Verification

- **TypeScript:** `npx tsc --noEmit` → Clean (0 errors).
- **Tests:** `npx vitest run` → 114/114 passed.

---

## 5. Next Steps

1. **Persist collapsed ranks** in `localStorage` per site so users keep their preferred view after refresh.
2. **Row swimlane backgrounds** — subtle horizontal banding per rank to make layers even more scannable.
3. **Backend `role_rank`** — if the backend ever sends explicit rank, remove the local heuristic.

(End of file)
