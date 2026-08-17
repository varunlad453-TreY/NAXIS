# Topology Routing Refactor — Implementation Plan

**Date:** 2026-08-15
**Scope:** Split monolithic `/topology/page.tsx` into deep-linkable sub-routes for enterprise NOC operations at scale.
**Driver:** Single-page topology cannot support shareable URLs, bookmarkable views, or code-splitting required for a 150+ site deployment.

---

## 1. Problem Statement

The current topology is one page (`/topology/page.tsx` ~250 lines) + one mega-component (`TopologyGraphV2` ~600 lines) that internally switches between:

- Backbone / global network view
- Single-site view (impact map / clusters / device graph / context graph)
- Path trace mode
- Incident-highlight mode

**Operational pain points at scale:**

| Pain | Impact |
|------|--------|
| View state is React state, not URL state | Refresh loses the operator's place; links cannot be shared in Slack/Teams |
| `site_id` is the only URL param | `?site_id=xyz` always lands in "auto" view mode; cannot link to "Device graph · Alerting" |
| `TopologyGraphV2` does 4 jobs | Adding a 5th view mode increases regression risk exponentially |
| No code splitting | Backbone page bundles host-map table logic, context graph logic, and all side-panel code even if never used |
| Incident correlation links are fragile | `/incidents/[id]` links to `/topology?highlight=...&incident=...` but the highlight logic is buried inside a useEffect in a 600-line component |

---

## 2. Target Architecture

### 2.1 Route Map

```
/topology                          →  Backbone / global network (existing, slimmed)
/topology/sites/[site_id]          →  Single-site operational view (NEW)
/topology/context/[node_id]        →  Device context graph (NEW)
```

### 2.2 URL State Contract

Every piece of view state that an operator might want to share or bookmark becomes a query param:

| Param | Values | Default | Page |
|-------|--------|---------|------|
| `view` | `impact` \| `clusters` \| `graph` | `impact` (large sites) / `graph` (small) | `/topology/sites/[site_id]` |
| `scope` | `alerting` \| `all` | `alerting` | `/topology/sites/[site_id]` |
| `layout` | `readable` \| `readable-lr` \| `hierarchical` \| `flat` | `readable` | `/topology/sites/[site_id]` (when `view=graph`) |
| `highlight` | comma-separated node IDs | — | all pages |
| `incident` | incident UUID | — | all pages |
| `path` | `1` (enables path trace) | — | `/topology/sites/[site_id]` |

**Examples of shareable URLs:**

```
/topology/sites/palwal-a51?view=impact&scope=alerting
/topology/sites/palwal-a51?view=graph&scope=all&layout=readable-lr
/topology/sites/palwal-a51?view=graph&highlight=BAS00464,BAS01337&incident=inc-123
/topology/context/BAS00464
/topology?highlight=hub-mumbai-01&incident=inc-456
```

### 2.3 Component Ownership

```
/topology/page.tsx
  └── TopologyBackbonePage
      └── TopologyToolbar (backbone variant)
      └── AllSitesGrid / AggregatedView / RegionHubs
      └── TopologyLegend

/topology/sites/[site_id]/page.tsx
  └── TopologySitePage
      ├── SiteHeader (name + health inline)
      ├── ViewSwitcher (impact | clusters | graph)
      ├── HealthScopeSwitcher (alerting | all)
      ├── WorstOffendersStrip
      ├── SiteContextBanner
      ├── HostMapView (when view=impact)
      ├── AggregatedView (when view=clusters)
      ├── ReactFlow canvas (when view=graph)
      │   └── TopologyToolbar (site variant)
      │   └── RankToggleChips
      │   └── TopologySidePanel
      └── ContextGraph (when view=context — redirects to /topology/context/[node_id])

/topology/context/[node_id]/page.tsx
  └── TopologyContextPage
      ├── Back link → /topology/sites/[site_id]
      ├── ContextGraph
      └── NodeDetailPanel
```

---

## 3. Component Extraction Plan

`TopologyGraphV2` currently contains ~600 lines of mixed concerns. Extract these into standalone, route-agnostic components:

### 3.1 Extract: `TopologySiteShell`

**Responsibility:** Layout wrapper for single-site pages — header, view switcher, health scope, worst offenders, and the active view.

**Props:**
```ts
interface TopologySiteShellProps {
  siteId: string;
  siteName?: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  view: "impact" | "clusters" | "graph";
  scope: "alerting" | "all";
  layout: "readable" | "readable-lr" | "hierarchical" | "flat";
  highlightedNodeIds?: string[];
  incidentId?: string | null;
  onViewChange: (v: "impact" | "clusters" | "graph") => void;
  onScopeChange: (s: "alerting" | "all") => void;
  onLayoutChange: (l: "readable" | "readable-lr" | "hierarchical" | "flat") => void;
  onNodeSelect: (nodeId: string, nodeName: string) => void;
  onBackToBackbone: () => void;
}
```

### 3.2 Extract: `TopologyGraphCanvas`

**Responsibility:** The ReactFlow canvas + controls + minimap + background. No state management, no side panels.

**Props:**
```ts
interface TopologyGraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (node: Node) => void;
  onInit: (instance: ReactFlowInstance) => void;
  highlightedNodeIds?: string[];
  fitView?: boolean;
}
```

### 3.3 Extract: `TopologyBackboneView`

**Responsibility:** Everything currently inside `isBackbone` branch of `TopologyGraphV2` — region clusters, degraded sites, all-sites grid.

### 3.4 Keep: `HostMapView`, `WorstOffendersStrip`, `SiteContextBanner`, `ContextGraph`

These are already well-factored. They just move from being rendered inside `TopologyGraphV2` to being rendered directly by their owning page.

---

## 4. Data Flow

### 4.1 Query Keys

Current query keys are flat. After refactor, they should reflect the route:

```ts
// Backbone
["topology", "backbone"]

// Site
["topology", "sites", siteId]           // nodes + edges
["topology", "sites", siteId, "summary"] // health counts, device types

// Context
["topology", "context", nodeId]         // node + parents + children

// Incident blast radius (shared)
["blast-radius", incidentId]
```

### 4.2 Preloading

When an operator clicks a site on the backbone view, the site page should ideally have data ready. Next.js `router.prefetch` + TanStack Query `prefetchQuery`:

```ts
// In backbone site card onClick handler
router.prefetch(`/topology/sites/${siteId}`);
queryClient.prefetchQuery({
  queryKey: ["topology", "sites", siteId],
  queryFn: () => api.getSiteTopology(siteId),
});
```

---

## 5. Migration Strategy

### Phase 1: URL State (1 day)

**Goal:** Make the existing single page deep-linkable without changing component structure.

1. Add `useQueryState` hooks to `TopologyGraphV2` for `view`, `scope`, `layout`.
2. Replace internal `useState` for these with URL-backed state.
3. Verify: refresh preserves view mode and scope.
4. Verify: `/incidents/[id]` → `/topology?highlight=...` links still work.

**Risk:** Low. No component extraction yet.

### Phase 2: Component Extraction (2 days)

**Goal:** Split `TopologyGraphV2` into route-agnostic pieces without creating new routes yet.

1. Extract `TopologySiteShell` from `TopologyGraphV2`.
2. Extract `TopologyGraphCanvas` from `TopologyGraphV2`.
3. Extract `TopologyBackboneView` from `TopologyGraphV2`.
4. `TopologyGraphV2` becomes a thin orchestrator that imports the three extracted components.
5. Run full test suite. Fix regressions.

**Risk:** Medium. Touching the most complex component in the app.

### Phase 3: Route Creation (1 day)

**Goal:** Create the new pages and redirect old URLs.

1. Create `app/topology/sites/[site_id]/page.tsx` — imports `TopologySiteShell`.
2. Create `app/topology/context/[node_id]/page.tsx` — imports `ContextGraph`.
3. Slim down `app/topology/page.tsx` to backbone only — imports `TopologyBackboneView`.
4. Add redirects:
   - `/topology?site_id=xyz` → `/topology/sites/xyz` (preserve query params)
   - `/topology?highlight=...` → keep working on backbone page
5. Update all internal links:
   - `locations/page.tsx` "Topology Graph" link
   - `incidents/[id]/page.tsx` "View in Topology" link
   - `noc/page.tsx` any topology pivots
   - `sidebar.tsx` active route matching

**Risk:** Low. Components are already extracted.

### Phase 4: Cleanup (0.5 day)

1. Delete `TopologyGraphV2` once all routes are stable.
2. Remove dead props from extracted components.
3. Update `docs/TOPOLOGY_VISUALIZATION.md` with new route documentation.
4. Run `npx tsc --noEmit` and `npx vitest run`.

---

## 6. Testing Strategy

### 6.1 Unit Tests

| Component | Test |
|-----------|------|
| `TopologySiteShell` | Renders correct sub-view based on `view` prop |
| `useQueryState` | URL updates on state change; state reads from URL on mount |
| `TopologyGraphCanvas` | Calls `onNodeClick` with correct node |

### 6.2 Integration Tests

| Flow | Test |
|------|------|
| Backbone → Site | Click site card → navigates to `/topology/sites/[id]` with correct data |
| Site → Context | Click device tile → navigates to `/topology/context/[node_id]` |
| Context → Back | Back button returns to `/topology/sites/[site_id]` |
| URL deep link | Open `/topology/sites/xyz?view=graph&scope=alerting` → renders graph with alerting scope |
| Refresh | Refresh on any topology page preserves view state |
| Incident link | `/incidents/123` → "View in Topology" → opens backbone with highlighted nodes |

### 6.3 Manual NOC Verification

1. Open `/topology` — verify backbone loads, no site data fetched.
2. Click a site — verify prefetch feels instant.
3. Switch to Device graph — verify URL changes to `?view=graph`.
4. Switch scope to All — verify URL changes to `?scope=all`.
5. Copy URL, open in new tab — verify identical state.
6. Click a device in graph — verify navigates to `/topology/context/[node_id]`.
7. Click Back — verify returns to site page with previous view/scope.
8. Open incident with topology nodes — verify "View in Topology" highlights correctly.

---

## 7. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|----------|
| `TopologyGraphV2` extraction introduces regressions | Medium | High | Phase 1 (URL state) is independent. Phase 2 extracts components but keeps the old orchestrator as a compatibility layer until Phase 4. Full test suite run after each phase. |
| External links break (incidents, locations, NOC) | Medium | High | Search codebase for all `/topology` string literals. Update in Phase 3. Add redirect for `/topology?site_id=...` → `/topology/sites/...`. |
| React Flow re-initializes on route change causing flash | Low | Medium | Use `keepAlive` pattern or Next.js `layout.tsx` at `/topology` level to persist React Flow instance across site/context navigation. |
| `useQueryState` causes excessive `router.replace` calls | Low | Low | The existing hook already uses `{ scroll: false }` and deduplicates. Monitor with React DevTools Profiler. |
| SEO / crawler issues from dynamic routes | Low | Low | Topology is behind auth. No SEO concern. Add `robots.txt` disallow for `/topology/*` if not already present. |

---

## 8. Rollback Plan

If Phase 3 introduces critical regressions:

1. Revert `app/topology/page.tsx` to pre-refactor version (git history).
2. Delete `app/topology/sites/` and `app/topology/context/` directories.
3. Restore old links in `incidents/[id]/page.tsx` and `locations/page.tsx`.
4. The extracted components (`TopologySiteShell`, `TopologyGraphCanvas`, `TopologyBackboneView`) remain in `components/topology/` — they are harmless unused code.
5. Re-deploy. Downtime: ~5 minutes.

---

## 9. Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| Phase 1: URL State | 1 day | Frontend dev |
| Phase 2: Component Extraction | 2 days | Frontend dev |
| Phase 3: Route Creation | 1 day | Frontend dev |
| Phase 4: Cleanup + Docs | 0.5 day | Frontend dev |
| Testing + NOC Verification | 1 day | QA / NOC lead |
| **Total** | **5.5 days** | |

---

## 10. Decision Log

| Decision | Rationale |
|----------|-------------|
| `view` defaults to `impact` for large sites, `graph` for small | Preserves existing `resolvedSiteMode` logic; operators of large sites want the readable view first |
| `scope` defaults to `alerting` | The entire point of handoff 51 — show pain first |
| Context graph gets its own route instead of being a `view` mode | Context graph is a fundamentally different workspace (single node focus, not site overview). It also needs a clean back-button target. |
| No `layout` param for `view=impact` or `view=clusters` | Layout only applies to graph view; ignored otherwise |
| Keep `highlight` and `incident` as global query params | Incident correlation and node highlighting work across all topology views |
| Use `router.replace` not `router.push` for view/scope changes | Prevents back-button spam when switching between impact map and device graph |

---

## 11. Open Questions

1. **Should `/topology/sites/[site_id]` support a `tab` param for future sub-tabs (e.g. "Events", "Performance")?** → Yes, reserve `tab` param now even if unused.
2. **Should the context graph page show the full site graph in the background with the context path highlighted?** → Defer. Current `ContextGraph` is a focused view. Enhancement for future handoff.
3. **Should we add `?region=` to backbone view for pre-filtered region hubs?** → Yes, if the NOC team uses region-specific bookmarks. Low effort, high value.

---

**Recommendation:** Execute Phase 1 immediately (URL state). It has zero structural risk and delivers 80% of the operational value (shareable URLs, refresh survival). Phases 2–4 can follow in the next sprint.
