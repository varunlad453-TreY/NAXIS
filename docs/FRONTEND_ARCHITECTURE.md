# Naxis Frontend Architecture

This document explains how the Naxis Next.js frontend is organized, the conventions we follow, and how to extend it without creating maintenance debt.

## Tech Stack

- **Framework**: Next.js 14 App Router
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
| Operational  | `/topology`      | Network topology (placeholder)           |
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

## Testing

- Unit tests live next to components: `*.test.tsx`.
- Use Vitest + React Testing Library.
- Mock `matchMedia` in test setup if components read the theme or motion preferences.

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
