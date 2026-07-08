# Topology Visualization

Interactive network topology graph built with ReactFlow and a dedicated REST API. Allows NOC operators to browse the infrastructure graph, understand device relationships, and identify upstream/downstream dependencies at a glance.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                        │
│                                                             │
│  /topology ──► TopologyPage                                  │
│  ?highlight= ←─ (from incident detail)                       │
│                 │                                            │
│                 ▼                                            │
│            TopologyGraph (ReactFlow)                          │
│             ├─ Health status dots (green/red/yellow/gray)     │
│             ├─ Highlighted nodes (glow + pulse for root)     │
│             └─ layout.ts (dagre)                              │
│                                                             │
│  api.getTopology() ─────────────┐                            │
│  api.getBlastRadius(id) ────────┤                            │
└─────────────────────────────────┼────────────────────────────┘
                                  │ HTTP
┌─────────────────────────────────┼────────────────────────────┐
│              Backend (FastAPI)   │                            │
│                                 ▼                             │
│  GET /topology ──► topology.py ──► PostgreSQL                  │
│  GET /topology/summary           │                            │
│  GET /topology/nodes/{id}        │                            │
│  GET /topology/blast-radius/{id} │                            │
│                                  ▼                            │
│                       topology_nodes table                     │
│                       topology_edges table                     │
│                       events + inventory tables (health)       │
└───────────────────────────────────────────────────────────────┘
```

## API Endpoints

### `GET /topology`

Returns the full topology graph as nodes + edges. Each node now includes live health status.

**Query parameters:**
| Parameter   | Type   | Description                  |
|-------------|--------|------------------------------|
| `site_id`   | string | Filter nodes by site ID      |
| `node_type` | string | Filter nodes by device type  |

**Response (node fields):**
```json
{
  "nodes": [
    {
      "node_id": "core-switch-01",
      "node_type": "switch",
      "name": "naxis-core-01",
      "ip_address": "10.0.0.1",
      "vendor": "cisco",
      "model": "C9300",
      "site_id": "site-sfo-01",
      "site_name": "SFO-01",
      "health_status": "critical",
      "health_label": "Critical"
    }
  ],
  "edges": [
    {
      "src_id": "ap-sfo-101",
      "dst_id": "core-switch-01",
      "edge_type": "wired"
    }
  ],
  "total_nodes": 42,
  "total_edges": 17
}
```

**Health Status Derivation** (in order of precedence):
1. **Critical** — recent CRITICAL event (last 15 min) OR inventory `reachability = "unreachable"` OR topology node `props.reachability = "unreachable"` OR `props.connected = false`
2. **Warning** — recent MAJOR event (last 15 min)
3. **Healthy** — inventory `reachability = "reachable"` AND no recent events
4. **Unknown** — no telemetry available

### `GET /topology/summary`

Aggregate counts broken down by type and vendor.

### `GET /topology/nodes/{node_id}`

Single node with its immediate parents (upstream) and children (downstream). Nodes include health status.

### `GET /topology/blast-radius/{incident_id}`

Builds a topology subgraph for an incident's blast radius. Resolves the incident's `affected_devices` to topology node IDs, fetches nodes + edges, and identifies root cause vs symptom devices.

**Response:**
```json
{
  "nodes": [...],
  "edges": [...],
  "total_nodes": 5,
  "total_edges": 3,
  "root_cause_node_ids": ["core-switch-01"],
  "symptom_node_ids": ["ap-sfo-101", "ap-sfo-102"]
}
```

Root cause = infrastructure device types (`switch`, `router`, `wan_edge`, `firewall`, `controller`, etc.) that have children in the affected set.
Symptoms = all other affected nodes.

## Frontend Component Tree

```
pages/topology/page.tsx
├─ Reads ?highlight= from URL query params
├─ Passes highlightedNodeIds to TopologyGraph
│
└── TopologyGraph (components/topology/topology-graph.tsx)
    ├── ReactFlow Canvas
    │   ├── Custom Nodes (TopologyNodeComponent)
    │   │   ├── Color-coded type badge (left)
    │   │   ├── Health status dot (right of name)
    │   │   │   ├── green = healthy
    │   │   │   ├── yellow = warning
    │   │   │   ├── red = critical
    │   │   │   └── gray = unknown
    │   │   └── Pulsing glow when highlighted as root cause
    │   ├── Edges (smoothstep with arrows)
    │   ├── Background (dot grid)
    │   ├── Controls (zoom in/out, fit view)
    │   └── MiniMap (color-coded by device type)
    └── layout.ts (dagre hierarchical layout)
        └── Accepts optional highlightSet → marks nodes as highlighted

incidents/[id]/page.tsx
└─ "View in Topology" button (in Blast Radius sidebar)
   └─ Navigates to /topology?highlight=node-id-1,node-id-2
```

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
- 21 tests covering all endpoints + health enrichment + blast radius
- Tests each health status derivation path (events, inventory, props)
- Tests blast radius with mocked incident service and DB
- Run: `python -m pytest backend/tests/test_topology_api.py -v`

**Frontend** (`frontend/src/types/topology.test.ts`):
- Validates `NODE_TYPE_META` covers all types with correct categories and colors
- Validates `HEALTH_STATUS_META` has correct colors/labels for all 4 statuses

**Layout** (`frontend/src/components/topology/layout.test.ts`):
- Tests dagre layout produces correct node/edge counts
- Verifies parent nodes are positioned above children
- Tests highlightSet marks correct nodes in data
- Edge cases: empty input, phantom edges, multiple highlights

**Total:** 21 backend tests + 35 frontend tests = **56 tests**

## Data Sources

The topology graph is built from:
- **Mist Topology Collector** — Mist APs and their wired connections
- **VeloCloud Collector** — SD-WAN edges and branches
- **SNMP Poller** — switches, routers, and other SNMP-capable devices

Health data comes from:
- **events table** — recent CRITICAL/MAJOR events (last 15 minutes)
- **inventory table** — device reachability status
- **topology_nodes.props** — inline reachability/connected flags from collectors

All data lives in `topology_nodes`, `topology_edges`, `events`, and `inventory` PostgreSQL tables.
