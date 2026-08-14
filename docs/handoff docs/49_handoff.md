# Readable Layered Topology Layout — Engineering Handoff

**Date:** 2026-08-14
**Scope:** Replace the unreadable dagre-generated site topology with a custom layered layout that respects network role hierarchy (internet → edge → core → dist → access → wireless → endpoints). Add left-to-right layout direction option.

---

## 1. Accomplishments

### Problem
When drilling into a single site (e.g. "Delhi Palwal: Regional Warehouse"), the dagre layout engine produced an unreadable graph. Nodes of completely different network roles (core switches, APs, endpoints) were scattered randomly with no visual hierarchy. Users could not tell upstream from downstream at a glance.

### Solution
Built a **custom readable layered layout** (`buildReadableHierarchicalLayout`) that explicitly places devices into horizontal rows based on their `ROLE_RANK`:

| Row | Roles | Examples |
|-----|-------|----------|
| 0 | Internet / WAN / Cloud / Site | Globe, WAN links |
| 1 | Edge / Security | Firewall, Router, Gateway, WAN Edge, VPN Gateway, Load Balancer |
| 2 | Core / Controllers | Core Switch, Server, Edge (Velo), Controller |
| 3 | Distribution | Distribution Switch |
| 4 | Access | Access Switch, Switch |
| 5 | Wireless | AP, Access Point, Wireless Controller |
| 6 | Endpoints | Client, Endpoint, Sensor, Camera, IoT, Printer |

**Spacing:** 140px between layers, 80px between nodes — generous enough that labels never overlap and edges have clear sightlines.

**Edge crossing minimization:** Nodes within each rank are sorted by the average x-position of their connected parents in the previous rank. This keeps parent-child edges mostly vertical and readable.

**Two layout directions:**
- **Layered (Top → Bottom)** — Default. Classic network rack / stack view. WAN at top, endpoints at bottom.
- **Layered (Left → Right)** — WAN on the left, endpoints on the right. Better for wide monitors.

**Old layouts preserved:**
- "Auto Hierarchical" (dagre) — still available for backward compatibility.
- "Flat" — same as before.

---

## 2. File Inventory

### Modified Files

| File | Change |
|---|---|
| `src/components/topology/topology-layout-engine.ts` | Added `buildReadableHierarchicalLayout()` with `groupNodesByRank()`, `orderNodesInRank()`, and custom spacing constants (`SITE_RANKSEP=140`, `SITE_NODESEP=80`). Added generous margin constants. |
| `src/components/topology/topology-graph-v2.tsx` | Changed default `layoutMode` from `"hierarchical"` → `"readable"`. Added `"readable"` and `"readable-lr"` branches in the layout selection `useMemo`. |
| `src/components/topology/topology-toolbar.tsx` | Updated `layoutMode` type to include `"readable" \| "readable-lr"`. Added two new dropdown items: "Layered (Top → Bottom)" and "Layered (Left → Right)". Updated button label formatter. |

---

## 3. API Contracts Used

| Endpoint / Data Source | Usage |
|---|---|
| `GET /topology/site/{site_id}` | Feeds `TopologyNode[]` + `TopologyEdge[]` into `buildReadableHierarchicalLayout` |
| `TopologyNode.node_type` | Mapped to `ROLE_RANK` to determine row assignment |
| `TopologyNode.health_status` | Edge health coloring (down/degraded/healthy) |

---

## 4. Verification

- **TypeScript:** `npx tsc --noEmit` → Clean (0 errors).
- **Tests:** `npx vitest run` → 114/114 passed.
- **Interactive Verification:**
  - Click any site from Regional Hub panel or All Sites table → site topology opens in readable layered layout.
  - Toggle Layout dropdown → "Layered (Top → Bottom)" and "Layered (Left → Right)" both render clean rows.
  - "Auto Hierarchical" and "Flat" still work as before.

---

## 5. Next Steps

1. **Persist user layout preference:** Remember last chosen layout mode in `localStorage` so users don't have to re-select on every site.
2. **Collapsible ranks:** Let users collapse/expand entire rows (e.g. hide all 200 endpoints to focus on infrastructure).
3. **Backend role tagging:** If the backend ever sends `role_rank` explicitly, swap the local `ROLE_RANK` heuristic.
