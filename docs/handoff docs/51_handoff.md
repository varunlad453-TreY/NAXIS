# Impact-First Large-Site Topology — Engineering Handoff

**Date:** 2026-08-15
**Scope:** Replace the unreadable 155-node flat graph at large sites (e.g. Delhi Palwal Regional Warehouse, CVBU A51) with an impact-first system: host-map tile grid as default, alerting-scoped device graph, worst-offenders strip, pain-first clusters, per-parent leaf collapsing, and blast-radius annotations.

Builds on handoff 49 (readable layered layout) and handoff 50 (adaptive density + collapsible ranks). Handoff 50's aggregated view remains available as the "Clusters" mode.

---

## 1. Problem

Drilling into a 155-device site rendered a flat, edge-to-edge graph that was neither readable nor actionable:

- `fitView` compressed 155 nodes into unreadable slivers; edges carried zero information density at that scale.
- The one thing an operator needs — *what's broken and where* — required visually scanning the whole canvas.
- The "Show device graph" toggle let users land in an unusable state with no recovery path.
- Cluster cards summarized *quantity* (total device count), not *pain* (critical count, worst offender).

---

## 2. Solution

### A. Host map tile grid — new default for large sites

`host-map-view.tsx`: pure CSS grid, no React Flow, no layout engine. Every device is a small health-colored tile grouped under collapsible category headers, sorted critical-first within each group. Health filter chips (Alerting / Critical / Warning / All) + text filter; **default filter is Alerting**, so the first render shows only the 35 critical tiles. Tile click opens the device's context graph.

### B. Worst offenders strip

`worst-offenders-strip.tsx`: horizontal cards above every single-site view. Top 8 alerting devices ranked critical-first, then by downstream blast radius (BFS over child edges, seed excluded). Each card shows `→ N affected` and opens the context graph on click. Renders nothing on healthy sites.

### C. Alerting-scoped device graph

The "Device graph" mode never renders all 155 nodes. `computeAlertScope` (in `large-site-utils.ts`) selects alerting nodes plus all upstream ancestors, so the layered layout renders ~42 nodes with enough parents to explain where the pain sits. A scope chip (Alerting 35 / All 155) sits next to the view switcher. If nothing is alerting, the scope falls through to the collapsed full view automatically.

### D. Per-parent leaf collapsing (All scope)

`collapseLeafSiblings` bundles leaf siblings (rank ≥ 5: APs, clients, endpoints) under a shared parent into a `collapsedGroup` badge node when ≥4 share a parent: "▸ 12 APs · 3 crit · worst: AP-FC06". Clicking the badge expands just that branch (`expandedGroups` state, per-group). Edges are remapped/deduped by `remapEdgesForCollapsedGroups`. Pseudo group nodes inherit the leaf rank, so rank chips still work — which is why rank auto-collapse is **disabled for large sites** (the badges are typed as their children and would be hidden by it).

### E. Pain-first clusters

`aggregateByCategory` now orders clusters by critical count desc, then warning count desc, then category order (healthy sites keep the old fixed order). Each cluster exposes `worstDevice` (critical beats warning, alphabetical tiebreak). `type-cluster-node.tsx` headlines the **critical count** instead of the total, plus a "worst: `<device>`" line.

### F. Edge direction convention (documented invariant)

`edge.src_id` = child/downstream, `edge.dst_id` = parent/upstream. Every piece of the above — ancestors, blast counts, collapsing — depends on it.

---

## 3. File Inventory

| File | Change |
|---|---|
| `frontend/src/lib/large-site-utils.ts` | **New.** Pure, React-free logic: `isAlerting`, `buildParentMap`/`buildChildrenMap`, `computeAlertScope`, `computeDownstreamCounts`, `rankWorstOffenders`, `collapseLeafSiblings`, `remapEdgesForCollapsedGroups`. |
| `frontend/src/components/topology/host-map-view.tsx` | **New.** Tile-grid view with health filter chips, search, collapsible category groups, empty state for healthy sites. |
| `frontend/src/components/topology/worst-offenders-strip.tsx` | **New.** Top-8 offender cards with blast-radius annotation. |
| `frontend/src/components/topology/collapsed-group-node.tsx` | **New.** Reactflow badge node for collapsed leaf groups; registered in `topology-node-types.tsx`. |
| `frontend/src/components/topology/topology-graph-v2.tsx` | View switcher (Impact map / Clusters / Device graph) replacing the old toggle; health-scope chips; collapse wiring in the layout memo; `handleNodeClick` expands `collapsedGroup` nodes; `collapsedRanks` effect skips large sites; moved `isLargeSite` above the effect to fix a TDZ crash. |
| `frontend/src/lib/topology-utils.ts` + `frontend/src/types/topology.ts` | Pain-first cluster ordering; `DeviceCategoryCluster.worstDevice`. |
| `frontend/src/components/topology/type-cluster-node.tsx` | Critical-count headline + worst-device line. |
| `docs/TOPOLOGY_VISUALIZATION.md` | New "Large-Site Readability" section documenting all of the above. |

---

## 4. Verification

- **TypeScript:** `npx tsc --noEmit` → clean.
- **Tests:** `npx vitest run` → 161/161 pass (55 new: `large-site-utils.test.ts`, `host-map-view.test.tsx`, `worst-offenders-strip.test.tsx`, extended `topology-utils.test.ts`).
- **Live (Palwal, 155 devices):** Impact map shows 35 red tiles instantly; Device graph · Alerting renders 42 nodes; All scope renders 12 collapse badges, click expands one branch (12 → 11 badges + 12 APs); Clusters leads with "Wireless — 35 critical — worst: BAS_TEST"; tile click → context graph → Back loop verified.

---

## 5. Gotchas

- **Playwright harness in this repo:** element screenshots drop inline `background-color` (verify via `getComputedStyle`); clicks near the fixed sidebar need `dispatchEvent('click')`; `node_id` is a UUID while `name` holds the friendly label (BAS00464).
- **TDZ trap:** `topology-graph-v2.tsx` effects must not reference memos declared below them — `isLargeSite` is declared before the `collapsedRanks` effect for this reason.
- `graphify` CLI (referenced in AGENTS.md) is not on PATH in this environment.

---

## 6. Next Steps

1. **Persist view mode + health scope** in the URL (`useQueryState`) instead of component state, so refresh keeps the operator's place.
2. **Blast radius on cluster cards** — "X down → Y clients affected" derived from edges (deferred from this pass; needs client-count confidence in edge data).
3. **Time dimension for offenders** — sort by alert duration once a per-node alerting-since timestamp is available.

(End of file)
