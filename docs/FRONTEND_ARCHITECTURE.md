# Naxis Frontend Architecture

This document explains how the Naxis Next.js frontend is organized, the conventions we follow, and how to extend it without creating maintenance debt.

## Tech Stack

- **Framework**: Next.js 15 App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 3.4 + shadcn/ui primitives
- **Server State**: TanStack Query (React Query)
- **HTTP Client**: Axios via `src/lib/api.ts`
- **Icons**: Lucide React

## Directory Layout

```
frontend/src/
├── app/                 # Next.js routes (page.tsx = route entry)
├── components/          # Domain + shared React components
│   ├── dashboard/       # Dashboard-only building blocks
│   ├── devices/         # Device inventory building blocks
│   ├── topology/        # Topology graph components (three-mode system, dagre layout, ReactFlow nodes)
│   ├── layout/          # Shell components (sidebar, header, placeholder)
│   └── ui/              # shadcn/ui primitives and theme toggle
├── config/              # Navigation config and other global constants
├── hooks/               # Custom React hooks
├── lib/                 # API client, utils, cn()
├── types/               # TypeScript domain types
└── styles/              # Global CSS and Tailwind entry
```

### Rule of thumb

> A `page.tsx` file should be a thin composition layer (~150 lines). Data fetching, filtering, and heavy presentation live in `components/[domain]/`.

## Navigation

The collapsible left sidebar is the single source of primary navigation.

- Route definitions live in `src/config/navigation.ts`.
- Every `href` in `mainNavigation` must have a matching route under `src/app/`.
- The sidebar (`src/components/layout/sidebar.tsx`) renders `mainNavigation` dynamically; do not hard-code nav items in the sidebar.

Current primary routes:

| Section      | Route            | Purpose                                  |
|--------------|------------------|------------------------------------------|
| Operational  | `/`              | Dashboard with platform HUD + inventory  |
| Operational  | `/integrations`  | Data-source control plane                |
| Operational  | `/events`        | Raw unified events list                  |
| Operational  | `/correlation`   | Alerts page — root-cause grouped incidents, truthful KPIs |
| Operational  | `/topology`      | Network topology graph (drill-down)      |
| Operational  | `/sdwan`         | VeloCloud SD-WAN view                    |
| Operational  | `/mist`          | Juniper Mist view                        |
| Insights     | `/devices`       | Device inventory                         |
| Insights     | `/performance`   | Performance analytics (placeholder)      |
| Insights     | `/connectivity`  | Link/tunnel monitoring (placeholder)     |
| Insights     | `/clients`       | Client health (placeholder)              |
| Platform     | `/settings`      | Configuration (placeholder)              |
| Platform     | `/help`          | Help & docs (placeholder)                |

### Adding a new primary route

1. Create the route under `src/app/[route]/page.tsx`.
2. Add the item to `src/config/navigation.ts` in the appropriate section.
3. If it is a placeholder, reuse `PlaceholderPage` from `src/components/layout/placeholder-page.tsx`.

## Page Composition Conventions

### Dashboard (`src/app/page.tsx`)

The dashboard delegates to dedicated components:

- `DashboardBackground` — themed layers, starfield, scanline, orbital HUD.
- `HeroSection` — status badge, headline, description, HUD counters.
- `CollectorHealthWidget` — live collector pipeline health (glass card with summary stats + inline alerts, polls `GET /telemetry` every 30s).
- `PlatformObserverSection` — platform cards.
- `InventoryToggle` — collapsible full-inventory panel.

### Devices (`src/app/devices/page.tsx`)

The device inventory delegates to:

- `DeviceFilterBar` — search, platform/status filters, grouping toggle.
- `DeviceListView` — loading, error, empty, grouped/flat list states.
- `InventoryRow` / `SiteGroup` / `InventorySkeleton` — row-level presentation.

## Styling Conventions

- Use Tailwind utility classes.
- Prefer semantic color tokens:
  - `text-foreground`, `text-foreground-muted`, `text-foreground-subtle`
  - `bg-surface`, `bg-background`
  - `text-success`, `text-critical`, `text-major`, `text-minor`, `text-info`
- Use `cn()` from `src/lib/utils` for conditional classes.
- Keep animation keyframes in `globals.css` so they are reusable.

## API / Server State

- All backend calls go through `src/lib/api.ts`.
- Use `useQuery` for reads and `useMutation` for writes.
- Default refresh intervals:
  - Dashboard counters: 10–15 seconds
  - Device inventory: 60 seconds
  - Topology backbone: 60 seconds (lightweight ~50 KB)
  - Topology site internal: 30 seconds (on demand after drill-down)

## Drill-Down Pattern

The topology page uses a **drill-down architecture** to handle large datasets (2651 devices) that would be unusable in a single ReactFlow canvas:

1. **Backbone mode** (default): Fetch `api.getTopologyBackbone()` → render **`SiteBrowser`** — a searchable, filterable card grid of 153 sites. No dagre, no ReactFlow at this level — just CSS grid cards with vendor icon, device count, and health dot.

2. **Internal mode** (after click): Fetch `api.getSiteTopology(id)` → render **`TopologyGraph`** with one of two sub-modes:
   - **Flat graph** (<50 devices): ReactFlow + dagre Web Worker for ~20-50 devices in the site. Devices appear as individual `TopologyNodeComponent` nodes.
   - **Three-mode system** (≥50 devices): Auto-switches to `AggregatedView` with category cluster nodes, then `DeviceBrowser` side panel, then `ContextGraph` for focused 1-hop neighborhood views. No dagre needed.

3. **Deep-link** (`?site_id=XXX`): Skip backbone, directly render `TopologyGraph` for the target site.

**Key files:** `src/app/topology/page.tsx` (state machine, breadcrumbs, health summary), `src/components/topology/topology-graph.tsx` (mode switching), `src/components/topology/aggregated-view.tsx` (clusters + toolbar), `src/components/topology/type-cluster-node.tsx` (cluster node), `src/components/topology/device-browser.tsx` (filterable list), `src/components/topology/context-graph.tsx` (1-hop graph), `src/components/topology/layout.ts` (dagre for flat mode), `src/lib/api.ts` (endpoints).

## Web Workers

Heavy synchronous computations (graph layout, data transformation) should run in a **Web Worker** to avoid blocking the main thread.

### Pattern

1. Create `<name>.worker.ts` — receives messages, imports pure functions, posts results back.
2. Create `use-<name>.ts` hook — manages worker lifecycle (create, message, terminate) with:
   - **Stale message filtering** — incrementing `_requestId` per message, discard responses for old IDs
   - **Synchronous fallback** — if `Worker` is unavailable or crashes, run the computation on the main thread
   - **Loading state** — expose `isComputing` for the component to show spinners
   - **Cleanup** — terminate worker on unmount

### Current usage

| Hook / Component | Worker | Purpose |
|---|---|---|
| `useTopologyLayout` | `layout.worker.ts` | Offloads `dagre.layout()` from the main thread (flat graph mode) |
| `AggregatedView` | none | Category cluster layout uses simple math (no dagre), runs on main thread |
| `ContextGraph` | none | 3-level hierarchy layout uses simple math (positional), runs on main thread |

### Testing

Mock `Worker` with a real class (not `vi.fn()` arrow functions, since `Worker` must be a constructor):

```typescript
class MockWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  constructor(_url: string, _opts?: any) { /* store ref */ }
  simulateResult(payload: any, requestId: number) { /* trigger onmessage */ }
  simulateError(message: string) { /* trigger onerror */ }
}

beforeEach(() => {
  vi.stubGlobal("Worker", MockWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
```

## Testing

- Unit tests live next to components: `*.test.tsx`.
- Use Vitest + React Testing Library.
- Mock `matchMedia` in test setup if components read the theme or motion preferences.
- Mock `Worker` with a real class (not arrow functions) when testing Worker-backed hooks.

## Adding a New Page

1. Create `src/app/[route]/page.tsx`.
2. Keep the page file small; extract sections to `src/components/[domain]/`.
3. Add the route to `src/config/navigation.ts` if it belongs in the sidebar.
4. Run `npm run type-check` and `npm run build` before committing.

## Anti-patterns to Avoid

- Hard-coding nav items in `sidebar.tsx` — use `navigation.ts`.
- Inline large lists/tables/filter bars directly in `page.tsx`.
- Creating routes that are not reachable from the sidebar unless intentionally hidden.
- Duplicating device/event list UI between pages — reuse `components/devices` and `components/dashboard`.
