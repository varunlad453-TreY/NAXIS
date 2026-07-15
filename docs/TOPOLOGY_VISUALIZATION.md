# Topology Visualization

Interactive network topology built with a **drill-down architecture**: the default view shows a **site browser** (searchable card grid), and clicking a site fetches its internal ReactFlow graph.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                            │
│                                                                  │
│  /topology                                                        │
│  │                                                               │
│  ├── (default) api.getTopologyBackbone()                          │
│  │   └── SiteBrowser (searchable card grid, NOT ReactFlow)        │
│  │       └── Click site card → api.getSiteTopology(id)            │
│  │           └── TopologyGraph (ReactFlow + dagre)                │
│  │                                                                 │
│  └── ?site_id=XXX → api.getTopology({ site_id }) → single-site    │
│                        TopologyGraph (ReactFlow)                   │
│                                                                   │
│  SiteBrowser (page.tsx inline)                                     │
│   ├─ Search bar (filter by name)                                  │
│   ├─ Vendor dropdown (Mist / VeloCloud filter)                    │
│   └─ Site cards (name, vendor icon, device count, health dot)     │
│                                                                   │
│  TopologyGraph (ReactFlow — only for single-site internal view)    │
│   ├─ Full device graph with dagre layout                          │
│   ├─ Health status dots (green/red/yellow/gray)                   │
│   ├─ Highlighted nodes (glow + pulse for root cause)              │
│   └─ layout.ts (dagre via Web Worker)                             │
│                                                                   │
│  api.getTopologyBackbone() ────────────┐                          │
│  api.getSiteTopology(id) ──────────────┤                          │
│  api.getTopology(params) ──────────────┤                          │
│  api.getBlastRadius(id) ───────────────┤                          │
└────────────────────────────────────────┼──────────────────────────┘
                                         │ HTTP
┌────────────────────────────────────────┼──────────────────────────┐
│              Backend (FastAPI)          │                          │
│                                        ▼                          │
│  GET /topology/backbone ────► site nodes + inter-site edges       │
│  GET /topology/sites/{id}/internal ──► single-site device graph   │
│  GET /topology ────► flat filtered graph (?site_id=, ?node_type=) │
│  GET /topology/summary                                              │
│  GET /topology/nodes/{id}                                           │
│  GET /topology/blast-radius/{id}                                    │
│                                         │                          │
│                                         ▼                          │
│                       topology_nodes table                          │
│                       topology_edges table                          │
│                       events + inventory tables (health)            │
└────────────────────────────────────────────────────────────────────┘
```

## Rationale

The production dataset has 2651 nodes (1949 APs, 456 switches, 153 sites) and 3147 edges. The original flat graph froze the browser. Dagre is `O(N²)` — unusable at this scale. Only 5 inter-site edges exist among 153 sites, so showing them in ReactFlow produces a meaningless grid of disconnected boxes.

**Solution:** Skip ReactFlow for the backbone entirely. Use a searchable **site browser** card grid for fast navigation. Only render ReactFlow + dagre when drilling into a single site (~20-50 devices with real parent-child edges).

## API Endpoints

### `GET /topology/backbone`

Returns only site nodes (`WHERE node_type = 'site'`) and inter-site edges (`WHERE n1.site_id != n2.site_id`). Each site node includes `device_count` (number of child devices), `critical_count`, and `warning_count`. Lightweight — ~153 nodes instead of 2651.

### `GET /topology/sites/{site_id}/internal`

Returns all nodes in a site (`WHERE site_id = $1`) plus edges connecting them. Also appends the site node itself if it exists in `topology_nodes`. Single query per category, no full-table scans.

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
  page.tsx: isBackboneMode = true
        │
        ├── api.getTopologyBackbone()
        │   └── Returns 153 site nodes with device_count
        │
        ├── SiteBrowser renders searchable card grid
        │   ├── Search input filters by name
        │   ├── Vendor dropdown filters Mist/VeloCloud
        │   └── Each card shows: name, vendor icon, device count, health dot
        │
        └── User clicks "Lucknow Mesh" card
                │
                ▼
          page.tsx: activeSiteId = "aae2bc9a-..."
                │
                ├── api.getSiteTopology("aae2bc9a-...")
                │   └── Returns 15 devices + edges + site node
                │
                ├── Header shows "← All sites" back button
                │
                └── TopologyGraph renders ReactFlow with dagre
                    └── ~16 nodes, ~3 edges for Lucknow Mesh

User clicks "← All sites"
        │
        ▼
  Back to SiteBrowser (backbone mode)
```

## Health Status Derivation

In order of precedence:
1. **Critical** — recent CRITICAL event (last 15 min) OR inventory `reachability = "unreachable"` OR topology node `props.reachability = "unreachable"` OR `props.connected = false`
2. **Warning** — recent MAJOR event (last 15 min)
3. **Healthy** — inventory `reachability = "reachable"` AND no recent events
4. **Unknown** — no telemetry available

## Frontend Component Tree

```
pages/topology/page.tsx
├─ Reads ?highlight=, ?incident=, ?site_id= from URL
├─ Manages drillDownSiteId state
├─ Backbone mode:
│   ├─ api.getTopologyBackbone()
│   └─ SiteBrowser (inline component)
│       ├─ Search input + vendor filter dropdown
│       └─ Grid of SiteCard buttons
│           ├─ Vendor icon (Wifi for Mist, Globe for VeloCloud)
│           ├─ Site name, vendor label
│           ├─ Health dot
│           └─ Device count
│
├─ Internal mode:
│   ├─ api.getSiteTopology(id)
│   └─ TopologyGraph (ReactFlow + dagre)
│       ├─ useTopologyLayout() hook (Web Worker)
│       ├─ TopologyNodeComponent (custom ReactFlow nodes)
│       │   ├─ Color-coded type badge
│       │   ├─ Health status dot
│       │   └─ Pulsing glow when root cause
│       ├─ SiteGroupNode (collapsible group)
│       ├─ Edges (smoothstep with arrows)
│       └─ Controls (zoom, fit view)
│
incidents/[id]/page.tsx
└─ "View in Topology" button → /topology?highlight=...&incident=...
```

## Layout Performance

**Dagre is only used for single-site internal graphs**, where it processes ~20-50 nodes with real edges via a Web Worker (~10ms). The backbone SiteBrowser has zero layout cost (CSS grid).

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

## Testing

**Backend** (`backend/tests/test_topology_api.py`):
- 29 tests covering all endpoints + health enrichment + blast radius + backbone + site internal
- `TestGetTopologyBackbone` (4 tests) — empty DB, returns sites+edges, excludes internal edges, zero device count
- `TestGetSiteInternalTopology` (4 tests) — empty DB, returns nodes+edges, appends site node, not found
- Run: `docker compose exec api pytest tests/test_topology_api.py -v`

**Frontend** (`frontend/src/components/topology/`):
- 57 tests across layout, use-topology-layout, blast-radius-panel, node-detail-panel, side-panel, health-history-chart
- Run: `cd frontend && npx vitest run src/components/topology/`

**Total:** 29 backend tests + 51 frontend tests = **80 tests** across both stacks.

## Data Sources

The topology graph is built from:
- **Mist Topology Collector** — Mist APs and their wired connections
- **VeloCloud Collector** — SD-WAN edges and branches
- **SNMP Poller** — switches, routers, and other SNMP-capable devices

Health data comes from:
- **events table** — recent CRITICAL/MAJOR events (last 15 minutes)
- **inventory table** — device reachability status
- **topology_nodes.props** — inline reachability/connected flags from collectors
