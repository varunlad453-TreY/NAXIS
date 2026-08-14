# Topology Visualization

Interactive network topology with a **three-mode backbone** and **drill-down architecture**. The backbone view offers three distinct ways to explore 153 sites: Regional Hubs (clustered by geography), Problem Sites (filtered to degraded), and All Sites (full data table). Clicking any site drills into its internal ReactFlow device graph.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                                    │
│                                                                          │
│  /topology                                                                │
│  │                                                                       │
│  ├── (default) api.getTopologyBackbone()                                  │
│  │   └── SiteBrowser (searchable card grid, NOT ReactFlow)                │
│  │       └── Click site card → router.push(?site_id=X) [URL-synced]      │
│  │           └── api.getSiteTopology(id) + api.getSiteSummary(id)        │
│  │               └── TopologyGraph (ReactFlow + dagre)                   │
│  │                                                                       │
│  └── ?site_id=XXX → deep-link directly into site internal topology       │
│                                                                          │
│  Breadcrumbs (inline)                                                     │
│   └─ Topology / Site Name — when drilled into a site                     │
│                                                                          │
│  SiteBrowser (page.tsx inline)                                            │
│   ├─ Search bar (filter by name)                                         │
│   ├─ Vendor dropdown (Mist / VeloCloud filter)                           │
│   └─ Site cards with:                                                    │
│       ├─ Vendor icon (Wifi for Mist, Globe for VeloCloud)                │
│       ├─ Site name, vendor label                                         │
│       ├─ Aggregated health dot (derived from child devices)              │
│       ├─ Critical/warning count badges                                   │
│       └─ Device count                                                    │
│                                                                          │
│  SiteHealthSummary (inline — shown in internal mode)                     │
│   └─ Device count + health breakdown (critical/warning/healthy/unknown)  │
│                                                                          │
│  TopologyGraph (ReactFlow — only for single-site internal view)          │
│   ├─ Full device graph with dagre layout                                 │
│   ├─ Health status dots (green/red/yellow/gray)                          │
│   ├─ Highlighted nodes (glow + pulse for root cause)                     │
│   ├─ Device type filter chips                                            │
│   ├─ Vendor breakdown chips                                              │
│   └─ layout.ts (dagre via Web Worker)                                    │
│                                                                          │
│  Client-side caching (React Query)                                        │
│   ├─ Backbone: staleTime=30s, refetchInterval=60s                        │
│   ├─ Site internal: staleTime=15s, gcTime=5min, refetchInterval=30s     │
│   └─ Site summary: staleTime=30s, gcTime=5min                            │
│                                                                          │
│  api.getTopologyBackbone() ────────────┐                                  │
│  api.getSiteTopology(id) ──────────────┤                                  │
│  api.getSiteSummary(id) ───────────────┤                                  │
│  api.getTopology(params) ──────────────┤                                  │
│  api.getBlastRadius(id) ───────────────┤                                  │
└────────────────────────────────────────┼──────────────────────────────────┘
                                          │ HTTP
┌────────────────────────────────────────┼──────────────────────────────────┐
│              Backend (FastAPI)          │                                  │
│                                        ▼                                  │
│  GET /topology/backbone ────► site nodes + inter-site edges               │
│       ├─ device_count (child device count)                                │
│       └─ critical_count, warning_count (aggregated child health)          │
│                                                                          │
│  GET /topology/sites/{id}/internal ──► single-site device graph           │
│                                                                          │
│  GET /topology/sites/{id}/summary ──► device/health/vendor breakdown     │
│       ├─ total_devices, site_name                                        │
│       ├─ health: healthy/warning/critical/unknown counts                 │
│       ├─ by_type: [{type, count}, ...]                                   │
│       └─ by_vendor: [{type, count}, ...]                                 │
│                                                                          │
│  GET /topology ────► flat filtered graph (?site_id=, ?node_type=)        │
│  GET /topology/summary                                                    │
│  GET /topology/nodes/{id}                                                 │
│  GET /topology/blast-radius/{id}                                          │
│                                         │                                  │
│                                         ▼                                  │
│                       topology_nodes table                                  │
│                       topology_edges table                                  │
│                       events + inventory tables (health)                    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Rationale

The production dataset has 2651 nodes (1949 APs, 456 switches, 153 sites) and 3147 edges. The original flat graph froze the browser. Dagre is `O(N²)` — unusable at this scale. Only 5 inter-site edges exist among 153 sites, so showing them in ReactFlow produces a meaningless grid of disconnected boxes.

**Solution:** Skip ReactFlow for the backbone entirely. Use a searchable **site browser** card grid for fast navigation. Only render ReactFlow + dagre when drilling into a single site (~20-50 devices with real parent-child edges).

## API Endpoints

### `GET /topology/backbone`

Returns only site nodes (`WHERE node_type = 'site'`) and inter-site edges (`WHERE n1.site_id != n2.site_id`). Each site node includes:
- `device_count` — number of child (non-site) devices
- `critical_count` — number of child devices in critical health
- `warning_count` — number of child devices in warning health

Lightweight — ~153 nodes instead of 2651.

### `GET /topology/sites/{site_id}/internal`

Returns all nodes in a site (`WHERE site_id = $1`) plus edges connecting them. Also appends the site node itself if it exists in `topology_nodes`. Single query per category, no full-table scans.

### `GET /topology/sites/{site_id}/summary`

Returns a rich summary of devices within a site:
- `total_devices` — total non-site device count
- `site_name` — resolved from inventory
- `health` — `{healthy_count, warning_count, critical_count, unknown_count}`
- `by_type` — device count grouped by `node_type` (e.g., switch: 5, ap: 15)
- `by_vendor` — device count grouped by vendor (e.g., cisco: 5, mist: 15)

Used by the frontend `SiteHealthSummary` component to render health breakdown bars and vendor/driver type chips.

### `GET /topology`

Returns the full topology graph filtered by optional query parameters. Primarily used for deep-linking from incidents (`?site_id=`).

**Query parameters:**
| Parameter   | Type   | Description                  |
|-------------|--------|------------------------------|
| `site_id`   | string | Filter nodes by site ID      |
| `node_type` | string | Filter nodes by device type  |

### `GET /topology/summary`

Aggregate counts broken down by type and vendor.

### `GET /topology/nodes/{node_id}`

Single node with its immediate parents (upstream) and children (downstream). Nodes include live health status.

### `GET /topology/blast-radius/{incident_id}`

Builds a topology subgraph for an incident's blast radius. Resolves the incident's `affected_devices` to topology node IDs, fetches nodes + edges, and identifies root cause vs symptom devices.

## Drill-Down Data Flow

```
User opens /topology
        │
        ▼
  URL: /topology (no site_id param)
        │
        ├── api.getTopologyBackbone()
        │   └── Returns 153 site nodes with device_count, critical_count, warning_count
        │
        ├── TopologyGraphV2 renders three-mode backbone view
        │   ├── Each card shows aggregated health:
        │   │   critical_count > 0  → red dot + badge
        │   │   warning_count > 0   → yellow dot + badge
        │   │   else healthy        → green dot
        │   ├── Search input filters by name
        │   └── Vendor dropdown filters Mist/VeloCloud
        │
        └── User clicks "Lucknow Mesh" card
                │
                ▼
          router.push("/topology?site_id=aae2bc9a-...")
                │
                ▼
          URL: /topology?site_id=aae2bc9a-...  [browser back/forward works]
                │
                ├── api.getSiteTopology("aae2bc9a-...")
                │   └── Returns 15 devices + edges + site node
                │
                ├── api.getSiteSummary("aae2bc9a-...")
                │   └── Returns health breakdown + type/vendor counts
                │
                ├── Breadcrumbs: Topology / Lucknow Mesh
                │
                ├── SiteHealthSummary: "15 devices · 1 Critical · 2 Warning · 12 Healthy"
                │
                ├── Device type filter chips: Switch(3) · AP(10) · Router(2)
                │
                ├── Vendor breakdown chips
                │
                └── TopologyGraph renders ReactFlow with dagre
                    └── ~16 nodes, ~3 edges for Lucknow Mesh

User clicks "← All sites" or browser back button
        │
        ▼
  router.push("/topology")
        │
        ▼
  Back to backbone view — cached data, instant render
```

## URL-Synced Drill-Down

Drill-down state is driven by the URL, not component state:
- **Clicking a site** calls `router.push("/topology?site_id=X")` — adds a browser history entry
- **Browser back button** navigates to the previous URL, automatically restoring backbone view
- **Deep-linking** `/topology?site_id=XXX` works directly — no prior navigation needed
- **"All sites"** calls `router.push("/topology")` — clears the site_id param

This eliminates the "browser back button doesn't restore backbone" caveat from earlier versions.

## Aggregated Site Health

The backbone `SiteBrowser` no longer shows the raw `health_status` of the site node (which is typically `"unknown"` because site nodes don't appear in events). Instead, site health is **derived from child device health**:

```
deriveAggregatedHealth(node):
  if device_count == 0 → "unknown" (no devices)
  if critical_count > 0 → "critical"
  if warning_count > 0 → "warning"
  else → "healthy"
```

The backend now populates `critical_count` and `warning_count` on backbone nodes by querying `topology_nodes` for child device health status counts per site.

## Client-Side Caching

React Query is configured with aggressive caching to make drill-down navigation instant:

| Query | staleTime | gcTime | refetchInterval |
|-------|-----------|--------|-----------------|
| Topology backbone | 30s | — | 60s |
| Site internal | 15s | 5 min | 30s |
| Site summary | 30s | 5 min | — |
| Global summary | 15s | — | 30s |

The 5-minute `gcTime` on site internal/summary queries means recently viewed sites render instantly when navigating back and forth, without a network round-trip.

## Single-Site Internal View

When clicking a site card, the internal topology adapts to the site size:

### Small sites (< 50 devices)

Renders as a **readable layered layout** by default (with dagre as fallback). Devices are placed into horizontal rows by their network role, making upstream/downstream relationships immediately visible:

| Row | Network Role | Device Types |
|-----|-------------|--------------|
| 0 | Internet / WAN / Site | Globe, WAN links |
| 1 | Edge / Security | Firewall, Router, Gateway, WAN Edge |
| 2 | Core / Controllers | Core Switch, Server, Controller |
| 3 | Distribution | Distribution Switch |
| 4 | Access | Access Switch |
| 5 | Wireless | AP, Access Point, Wireless Controller |
| 6 | Endpoints | Client, Endpoint, Sensor, Camera, IoT |

Nodes within each row are sorted to minimize edge crossings. Two layout directions are available:
- **Layered (Top → Bottom)** — WAN at top, endpoints at bottom (default)
- **Layered (Left → Right)** — WAN on the left, endpoints on the right

Users can also switch to **Auto Hierarchical** (dagre) or **Flat** via the Layout dropdown in the toolbar.

### Large sites (≥ 50 devices)

Automatically switches to a **three-mode system**:

#### Mode 1: Aggregated View (default)
Devices are grouped by category into cluster nodes. The toolbar shows a health summary bar (critical/warning/healthy/unknown counts) and a global search box. Cluster nodes are rendered as `TypeClusterNode` ReactFlow custom nodes. Clicking a health badge pre-filters the Device Browser.
Devices are grouped by category into cluster nodes:

| Category | Example content | Icon |
|----------|----------------|------|
| Infrastructure | Switches, routers, firewalls | Server |
| Wireless | APs, access points | Wifi |
| Edge | WAN edges, gateways | Globe |
| Leaf | Clients, endpoints, sensors, cameras, IoT | Monitor |

Each cluster node displays:
- Category icon + count (e.g., "APs: 339")
- Aggregated health dot (worst-child: critical → warning → healthy)
- **Proportional health bar** — colored segments (red/yellow/green/gray) showing the ratio of critical/warning/healthy/unknown devices at a glance
- **Clickable health distribution badges** — clicking a badge (e.g., "12 Critical") opens the Device Browser **pre-filtered** to only show devices with that health status
- Device type breakdown below a separator

Clusters are 270px wide and arranged in a horizontal layout connected to the site node via dashed edges. Hover lifts the card and shows a chevron hint. This gives instant insight into site composition and health without rendering 385 individual nodes.

#### Mode 2: Device Browser
Clicking a cluster (or a health badge within it) opens a side panel with a searchable, filterable device list:
- **Pre-filtering:** clicking a health badge on a cluster node automatically sets the health status filter in the browser; clicking the cluster itself shows all devices
- Search by name, node ID, or IP
- Filter by health status (Critical / Warning / Healthy / Unknown) — pills use status-specific colors
- Filter by vendor
- Sort by name, health, vendor, or type
- Per-row **health bar** (colored left border) for quick visual scanning
- Escape key closes the panel
- Click any device to view its network connections

This makes every device findable in milliseconds, regardless of site size.

#### Global Search (Across All Devices)
The Aggregated View toolbar includes a **global search bar** that searches all devices in the site (not just the selected category). Matching results show a colored category dot, device name, and type. Clicking a result opens the Device Browser for that device's category. This eliminates the need to guess which cluster a device belongs to.

#### Mode 3: Context Graph
Clicking a device in the Device Browser (or any device in the flat graph) opens a focused ReactFlow graph showing that device plus:
- Its parents (upstream connections)
- Its children (downstream connections)
- All edges between them

The graph is laid out in a three-level hierarchy (parents → selected device → children) with health-colored borders. Click any node to re-focus the context graph on it. This enables root-cause tracing: find a critical device, see what it's connected to, trace the issue upstream.

#### Aggregated View Toolbar

The toolbar above the cluster graph provides:
- **Health summary** — color-coded badges showing the total count of critical/warning/healthy/unknown devices across the entire site
- **Global search** — searches all devices by name/ID/IP with a dropdown of top 20 results; clicking a result opens the Device Browser for that device's category
- **"Show all" button** — switches to the flat dagre graph for users who prefer the ungrouped view (only shown when ≥50 devices)
- **Escape key** — closes the Device Browser panel

### Mode Switching

The system auto-selects the best mode:
- **< 50 devices**: Flat dagre graph (existing behavior)
- **≥ 50 devices**: Aggregated View (new)
- **Any site**: Click a device → Context Graph; press Back to return
- **Large site**: "Show all devices" button to switch to flat graph if desired
- **Keyboard**: Escape closes the Device Browser panel

All modes share the same backend data — no new API endpoints required.

## Health Status Derivation

Per-node health (for individual devices in the internal graph):

In order of precedence:
1. **Critical** — recent CRITICAL event (last 15 min) OR inventory `reachability = "unreachable"` OR topology node `props.reachability = "unreachable"` OR `props.connected = false`
2. **Warning** — recent MAJOR event (last 15 min)
3. **Healthy** — inventory `reachability = "reachable"` AND no recent events
4. **Unknown** — no telemetry available

## Layout Performance

**Dagre is only used for single-site internal graphs**, where it processes ~20-50 nodes with real edges via a Web Worker (~10ms). The All Sites table has zero layout cost (native table). Regional Hubs use fixed grid layout (no dagre).

## Device Type Color Scheme

| Type                  | Category         | Color   |
|-----------------------|------------------|---------|
| switch / core/dist/access | Infrastructure | Blue   |
| router, firewall, controller | Infrastructure | Purple/Red/Amber |
| wan_edge, gateway     | Edge             | Purple  |
| ap, access_point      | Wireless         | Green   |
| client, endpoint, sensor, camera, iot | Leaf    | Gray    |

## Health Status Color Scheme

| Status    | Color  | Meaning                                  |
|-----------|--------|------------------------------------------|
| Healthy   | Green  | Device reachable, no recent issues       |
| Warning   | Yellow | Recent MAJOR events detected             |
| Critical  | Red    | Recent CRITICAL events or unreachable    |
| Unknown   | Gray   | No telemetry data available              |

## Frontend Component Tree

```
pages/topology/page.tsx
├─ Reads ?highlight=, ?incident=, ?site_id= from URL (source of truth)
├─ Breadcrumbs component: Topology / Site Name
├─ Backbone mode:
│   ├─ api.getTopologyBackbone() [staleTime=30s, refetch=60s]
│   └─ SiteBrowser (inline component)
│       ├─ Search input + vendor filter dropdown
│       └─ Grid of SiteCard buttons
│
├─ Internal mode (<50 devices):
│   ├─ api.getSiteTopology(id) [staleTime=15s, gcTime=5min, refetch=30s]
│   ├─ api.getSiteSummary(id) [staleTime=30s, gcTime=5min]
│   ├─ SiteHealthSummary
│   ├─ Device type / vendor filter chips
│   └─ TopologyGraph (ReactFlow + dagre, flat layout)
│
├─ Internal mode (≥50 devices — three-mode system):
│   ├─ api.getSiteTopology(id) + api.getSiteSummary(id)
│   └─ AggregatedView
│       ├─ Health summary toolbar (critical/warning/healthy/unknown counts)
│       ├─ Global search bar (across all devices)
│       ├─ ReactFlow canvas with TypeClusterNode components
│       │   ├─ Category icon + count
│       │   ├─ Proportional health bar (colored segments)
│       │   ├─ Clickable health distribution badges (data-health-filter)
│       │   └─ Device type breakdown
│       ├─ DeviceBrowser (side panel)
│       │   ├─ Search by name/ID/IP
│       │   ├─ Health status filter (color-coded pills)
│       │   ├─ Vendor filter + sort
│       │   ├─ Per-row health bar (colored left border)
│       │   ├─ Initial health filter (from badge click)
│       │   └─ Escape key to close
│       ├─ ContextGraph (3-level hierarchy ReactFlow)
│       │   ├─ Parents → Selected → Children
│       │   ├─ Click any node to re-focus
│       │   └─ Back button to return
│       └─ "Show all devices" button → flat dagre graph

incidents/[id]/page.tsx
└─ "View in Topology" button → /topology?highlight=...&incident=...
```

## Testing

**Backend** (`backend/tests/test_topology_api.py`):
- 34 tests covering all endpoints + health enrichment + blast radius + backbone + site internal + site summary
- `TestGetTopologyBackbone` (4 tests) — includes health count verification
- `TestGetSiteInternalTopology` (4 tests) — empty DB, returns nodes+edges, appends site node, not found
- `TestGetSiteSummary` (4 tests) — type/health/vendor breakdown, empty DB, empty site, site name resolution
- Run: `python -m pytest backend/tests/test_topology_api.py -v` (from project root)

**Frontend** (`frontend/src/components/topology/` + `frontend/src/app/topology/`):
- 100 tests across layout, use-topology-layout, blast-radius-panel, node-detail-panel, side-panel, health-history-chart, topology-utils, types, api
- 15 tests for `topology-utils` (aggregateByCategory, computeHealthDistribution, getDeviceCategory, aggregateHealth)
- 5 tests for `deriveAggregatedHealth` (page.test.tsx)
- Run: `cd frontend && npx vitest run`

**Total:** 34 backend tests + 100 frontend tests = **134 tests** across both stacks.

## Data Sources

The topology graph is built from:
- **Mist Topology Collector** — Mist APs and their wired connections
- **VeloCloud Collector** — SD-WAN edges and branches
- **SNMP Poller** — switches, routers, and other SNMP-capable devices

Health data comes from:
- **events table** — recent CRITICAL/MAJOR events (last 15 minutes)
- **inventory table** — device reachability status
- **topology_nodes.props** — inline reachability/connected flags from collectors
