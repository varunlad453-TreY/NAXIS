# Topology Redesign — Engineering Handoff

**Date:** 2026-08-13
**Scope:** Complete redesign of the topology visualization from a card-based layout to an enterprise-grade hierarchical network graph.

---

## 1. Accomplishments

### Architecture (Clean Domain Layer)

Introduced a separated graph domain to prevent massive React components and keep topology logic maintainable as the network grows:

```
Data (API / DB)
    ↓
topology-graph-model.ts     (normalization, path trace, impact)
    ↓
topology-layout-engine.ts   (Dagre layouts: hierarchical, flat, backbone, site-grouped)
    ↓
topology-graph-v2.tsx      (ReactFlow shell: pan, zoom, selection, real-time)
    ↓
Toolbar / Legend / Detail Panel
```

### Real Data Only

- Nodes come from `topology_nodes` (device, site, interface, circuit records).
- Edges come from `topology_edges` + `links` (physical, logical, site_membership, wan_link).
- Health is derived live from recent events + inventory reachability (`_enrich_health`).
- No fabricated parent/child relationships.
- No mock topology injected to make the UI look complete.

### Hierarchical Layout

- Uses **Dagre** with role-based `ROLE_RANK` assignment:
  - `0` — internet / wan / cloud / site
  - `1` — firewall / router / gateway / wan_edge / vpn_gateway / load_balancer
  - `2` — core_switch / controller / edge / server
  - `3` — distribution_switch
  - `4` — access_switch / switch
  - `5` — ap / access_point / wireless_controller
  - `6` — client / endpoint / sensor / camera / iot / printer
- Layout direction: **Top → Bottom** (upstream above, downstream below).
- Supports **flat** mode for unstructured data where hierarchy is not meaningful.

### Node Design (Compact, Not Cards)

- **Infrastructure node:** 170 × 42 px, icon + label + health dot.
- **Leaf node:** 150 × 34 px (APs, clients, IoT), smaller footprint.
- **Site node:** 260 × 52 px, shows device count.
- Each device type has a distinct Lucide icon and a restrained color from `NODE_TYPE_META`.
- No rounded-rectangle cards, no giant badges, no excessive metadata on the canvas.

### Edge Design (Semantically Meaningful)

| Visual cue | Meaning |
|---|---|
| Solid gray | Healthy physical link |
| Dashed gray | Logical / WAN / unknown status |
| Yellow | Degraded (derived from endpoint health) |
| Red | Down (derived from critical endpoint health) |
| Arrowhead | Direction: parent → child (upstream → downstream) |
| Thick blue | Highlighted / path trace |

### Backbone View (Global)

- Default landing view.
- Renders `site` nodes + real **inter-site edges** only.
- Click a site → drill into its internal topology (`/topology?site_id=...`).
- Health aggregated from child devices per site (`critical_count` / `warning_count`).

### Path Trace

- Toolbar button toggles path-trace mode.
- User clicks **source** device → **destination** device.
- BFS traces upstream or downstream through the graph.
- Highlights path nodes/edges; unrelated topology dims.
- If no direct path exists, shows downstream impact from the selected source.

### Search & Filter

- **Search:** name, node_id, IP address. Results dropdown; selecting centers and zooms.
- **Filters:** per real `node_type`. Toggle any type on/off.
- Both operate on the actual graph dataset (filtering changes what gets rendered and laid out).

### Blast Radius / Incident Integration

- Fetches `/topology/blast-radius/{incident_id}` when routed from an incident.
- Marks root-cause nodes with pulse animation.
- Marks symptom nodes distinctly.
- Opens existing side panel with incident details.

### Real-Time Updates

- Backbone: refetches every 60 s (`refetchInterval`).
- Site internal: refetches every 30 s.
- ReactFlow preserves zoom and selection on data refresh.

### Performance

- `onlyRenderVisibleElements` enabled on ReactFlow.
- Layout computed in `useMemo` (no full re-layout on every render).
- Minimap added for orientation in large topologies.
- Filtering reduces node count before layout.

---

## 2. What Was Skipped (And Why)

### Interface-Level Drill-Down

- **Why skipped:** The data model supports `props` on `topology_nodes` and `topology_edges`, but there is no dedicated `interfaces` table or API endpoint yet. The detail panel already shows whatever interface metadata is available in `props`, but a full **port → VLAN → subnet** drill-down requires a new backend schema + API contract.
- **When to add:** After `interfaces` and `vlan_mappings` tables are created and exposed via `/topology/nodes/{id}/interfaces`.

### Full Topology Modes (Physical / Logical / Wireless / Dependency)

- **Why skipped:** The backend currently stores all edges in `topology_edges` with `edge_type` values (`physical`, `logical`, `site_membership`, `wan_link`). There is **no separate logical topology** (VLAN/subnet graphs) or **wireless topology** (controller → AP → client, separate from wired edges) exposed as distinct endpoints. The existing `node_type` filter + flat layout already lets operators view wireless-only or switch-only subsets, but a true multi-mode view requires the backend to serve dedicated logical-edge collections.
- **When to add:** Once the backend provides:
  - `/topology/logical` (VLAN/routing relationships)
  - `/topology/wireless` (controller-AP-client hierarchy)
  - `/topology/dependencies` (service-to-device dependencies)

### Advanced Clustering Beyond Site Level

- **Why skipped:** Implementing true hierarchical aggregation (e.g., 128 access switches in a collapsed cluster box that expands on click) requires computing real device counts, child health distributions, and cross-cluster edges dynamically. The existing `aggregated-view.tsx` + `type-cluster-node.tsx` provide category-level aggregation, but they were kept in place as the previous implementation. The new graph prioritizes showing actual device relationships over synthetic cluster nodes.
- **When to add:** When enterprise networks reach 500+ devices per site and canvas performance degrades. At that point, the layout engine can be extended with a `buildClusteredLayout()` that collapses same-rank, same-health subtrees into expandable group nodes using real counts from the API.

---

## 3. File Inventory

### New Files

| File | Responsibility |
|---|---|
| `src/components/topology/topology-graph-model.ts` | Graph normalization, BFS path trace, downstream impact, role ranking |
| `src/components/topology/topology-layout-engine.ts` | Dagre-based layout builders: hierarchical, flat, backbone, site-grouped |
| `src/components/topology/topology-node-types.tsx` | Compact ReactFlow node components with device icons |
| `src/components/topology/topology-edge-types.tsx` | Health-aware edge component with path-trace glow |
| `src/components/topology/topology-toolbar.tsx` | Professional toolbar: search, layout, filters, path trace, zoom, legend |
| `src/components/topology/topology-legend.tsx` | Subtle legend for device types, link states, health states |
| `src/components/topology/topology-graph-v2.tsx` | Main graph shell (replaces old `topology-graph.tsx`) |

### Updated Files

| File | Change |
|---|---|
| `src/app/topology/page.tsx` | Backbone is now a graph (not a list); uses `TopologyGraphV2` |
| `src/components/topology/index.ts` | Exports all new modules |

### Preserved Legacy Files

| File | Reason |
|---|---|
| `topology-graph.tsx` | Kept for reference / rollback if issues arise in production |
| `aggregated-view.tsx` | Category aggregation still valid for future clustering enhancement |
| `context-graph.tsx` | Neighbor-context view still functional |
| `layout.ts` / `use-topology-layout.ts` | Old Dagre + Web Worker layout; retained as fallback |
| `device-browser.tsx` | Device list browser within aggregated clusters |

---

## 4. API Contracts Used

| Endpoint | Purpose |
|---|---|
| `GET /topology/backbone` | Site nodes + inter-site edges |
| `GET /topology/sites/{id}/internal` | All nodes + edges inside a site |
| `GET /topology/sites/{id}/summary` | Health + type + vendor breakdown per site |
| `GET /topology/nodes/{id}` | Node detail with parents + children |
| `GET /topology/blast-radius/{incident_id}` | Root cause + symptom nodes for an incident |
| `GET /topology/summary` | Global node/edge counts |
| `GET /incidents/{id}` | Incident detail for blast-radius panel |

---

## 5. Verification

- **TypeScript:** `tsc --noEmit` → clean
- **Tests:** `vitest run` → 114/114 passed
- **Build:** `next build` → compiled successfully, topology route = 199 kB (includes ReactFlow)
- **No mock data:** Every node and edge originates from real backend tables

---

## 6. Next Steps (Post-Handoff)

1. **Backend:** Add `interfaces` table + `/topology/nodes/{id}/interfaces` endpoint.
2. **Backend:** Add dedicated `/topology/logical` and `/topology/wireless` endpoints.
3. **Frontend:** Extend `topology-graph-v2.tsx` mode switcher when (2) is ready.
4. **Frontend:** Add cluster-expansion UI when networks exceed ~500 nodes per view.
5. **Operations:** Monitor performance with customer data (1,000+ nodes) and enable Web Worker layout if main-thread layout becomes slow.
