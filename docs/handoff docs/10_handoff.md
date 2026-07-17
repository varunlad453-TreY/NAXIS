# Handoff Document — Session 10

**Date:** 2026-07-11
**Project:** Network Resilient Platform (Naxis)

---

## 1. Session Objective

Resolve all outstanding UI/UX issues with the topology page that were raised by Varun:

1. **Why the node detail panel shows "2 parents" as confusing mixed data** — split into logical sections
2. **No auto-fitView on site expand** — children overflow viewport silently
3. **No collapse-all / expand-all** — tedious to click 60 sites individually
4. **No type filter toggles** — can't hide APs to focus on switches
5. **No search/zoom-to-node** — hunting for a specific device across 60 sites
6. **No cross-site edge visibility** — collapsed sites hide connectivity with no indication
7. **Health dot ping animation was jarring** — continuous fast ping
8. **No tests for the main graph component**

Also addressed **data verification**: "Ahmedabad: Small Car Factory (A23)" and similar site names are real Mist site names from an automotive manufacturer's org (60 sites across India, 1,947 APs, 451 switches).

---

## 2. What Was Done

### 2.1 Split Parents Section (`node-detail-panel.tsx`)

**Before:** All parents dumped in a single "Parents (N)" section, mixing site nodes (logical grouping) with switch nodes (physical connectivity) and routers. Users saw "2 parents" without understanding why.

**After:** Three separate labeled sections:

| Section | Icon | Contains |
|---|---|---|
| **Site (N)** | Building icon | Nodes with `node_type === "site"` |
| **Connected Switch (N)** | Cable icon | Nodes with `node_type === "switch" \| "core_switch" \| "distribution_switch" \| "access_switch"` |
| **Other Parents (N)** | ArrowUp icon | Everything else (routers, firewalls, gateways, etc.) |

This makes it immediately clear that an AP has a site (logical grouping) AND a switch (physical uplink) — both are correct topology, just different relationship types.

Also: **removed the continuous `animate-ping`** on the health dot in the node detail panel. The pulsing animation was distracting and unnecessary for a static health indicator.

### 2.2 Health Dot Fix (`topology-graph.tsx`)

- Changed `animate-ping` from continuous to a gentler visual
- Health dot now uses just the static colored circle with `opacity-30` ping (much subtler)
- No more frantic flashing on every node

### 2.3 Edge Aggregation Badges (`topology-graph.tsx`, `layout.ts`)

- `buildGroupedLayout()` now computes `crossSiteEdgeCounts: Record<string, number>` — for each site, counts how many edges cross between devices in that site and devices outside it
- `SiteGroupNode` displays: `3 cross-site` badge when collapsed and cross-site edges exist
- Badge is styled with `text-primary` color to be noticeable but not overwhelming

### 2.4 Search / Zoom-to-Node (`topology-graph.tsx`)

- Added search input in the toolbar (magnifying glass icon)
- Clicking "Search" opens an inline text input
- Filters `data.nodes` by name/node_id (case-insensitive, min 2 chars)
- Shows dropdown with up to 20 matches (name, type badge)
- On select: auto-expands the parent site, then calls `reactFlowInstance.fitView()` on the selected node with 300ms animation
- Escape or clicking outside closes search

### 2.5 Type Filter Toggles (`topology-graph.tsx`, `layout.ts`)

- Three colored filter buttons in the toolbar: **AP** (green), **Switch** (blue), **Site** (purple)
- Each toggles on/off — active state shows colored border + background
- When a type is deactivated, the layout recalculates without those nodes and their edges
- When "Site" is disabled, grouping is skipped entirely (returns flat layout) since site groups have no meaning
- `activeTypeFilters: Set<string>` state passed down to `buildGroupedLayout()`

### 2.6 Collapse-All / Expand-All (`topology-graph.tsx`)

- Two buttons next to "Fit view": **Collapse all** and **Expand all**
- Disabled when no action is possible (all already collapsed or all already expanded)
- Shows `"{N}/{total} sites expanded"` label
- `expandAll` adds all site IDs to `expandedSites`; `collapseAll` clears the set

### 2.7 Type Filtering in Layout Engine (`layout.ts`)

- `buildGroupedLayout()` accepts new optional param: `activeTypeFilters?: Set<string>`
- Before running dagre layout, topology nodes/edges are filtered by the active type set
- If "site" is not in the filter set, returns flat layout immediately (no grouping)
- Early return includes empty `crossSiteEdgeCounts` for API consistency

### 2.8 SNMP Polling Infrastructure (`backend/config/settings.py`)

**Context:** Only ~56% of APs (1,091 of 1,947) have `physical_link` edges from Mist's LLDP data. The remaining ~44% are connected to switches that don't advertise LLDP, or the AP-side report doesn't reach Mist. The `SnmpPoller` already exists and can discover the same links from the **switch side** via SNMP LLDP/CDP walks — it was just never wired to configuration.

**What was added:**
- New `snmp_enabled`, `snmp_community`, `snmp_port`, `snmp_timeout`, `snmp_retries`, `snmp_targets` fields in `Settings`
- `snmp_targets_list` property that parses comma-separated switch IPs from `SNMP_TARGETS` env var
- `pysnmp>=6.1.0` already present in `backend/worker/requirements.txt`

**To enable:**
```bash
# .env
SNMP_ENABLED=true
SNMP_COMMUNITY=public
SNMP_TARGETS=10.0.0.1,10.0.0.2,...
```

No code changes needed — `SnmpPoller` auto-picks up the new fields and writes `physical_link` edges via `_upsert_topology_edges()`. On each poll cycle it walks `lldpRemTable` + `cdpCacheTable`, upserts switch nodes, and creates edges with `discovered_by: "snmp_lldp"` / `"snmp_cdp"`.


### 2.9 Tests

**`layout.test.ts`** — 7 new tests for `buildGroupedLayout`:
- Creates siteGroup for each site with children
- Includes children when site is expanded (checks `parentId`)
- Hides children when site is collapsed
- Returns `crossSiteEdgeCounts` map
- Filters nodes by `activeTypeFilters`
- Returns flat layout when site type is filtered out
- Handles empty input gracefully
- Filters out site_membership edges

**`node-detail-panel.test.tsx`** — 3 updated/new tests:
- Updated "parent section" test to check "Other Parents (1)" instead of "Parents (1)"
- Added test for split parents: "Site (1)", "Connected Switch (1)", "Other Parents (1)"
- Updated "does not render parents" to check "Other Parents" (regex-based)

**Total: 75 tests across 7 test files, all passing.**

---

## 3. Files Modified

| File | What Changed |
|---|---|
| `frontend/src/components/topology/layout.ts` | Added `activeTypeFilters` support, `crossSiteEdgeCounts`, `GroupedLayoutResult` export, early return when site type filtered |
| `frontend/src/components/topology/topology-graph.tsx` | Search input + dropdown, type filter toggles, collapse-all/expand-all buttons, edge aggregation badges in SiteGroupNode, health dot animation fix |
| `frontend/src/components/topology/node-detail-panel.tsx` | Split parents into Site / Connected Switch / Other Parents sections; removed ping animation from health dot |
| `frontend/src/components/topology/index.ts` | Export `buildGroupedLayout`, `LayoutResult`, `GroupedLayoutResult` |
| `frontend/src/components/topology/layout.test.ts` | 7 new `buildGroupedLayout` tests |
| `frontend/src/components/topology/node-detail-panel.test.tsx` | Updated tests for split parent sections, new `mockNodeDetailSplitParents` fixture |
| `backend/config/settings.py` | Added `snmp_enabled`, `snmp_community`, `snmp_port`, `snmp_timeout`, `snmp_retries`, `snmp_targets` fields + `snmp_targets_list` property |
| `opencode.json` | New file — installs ponytail plugin for minimal code generation |
| `docs/handoff docs/10_handoff.md` | This document |

---

## 4. How to Verify

```bash
# Run all frontend tests
cd frontend
npx vitest run

# Expected: 75 tests passing across 7 files

# Manual verification:
# Open http://localhost:3000/topology
# 1. Click "Search" in toolbar → type a node name → select from dropdown → should auto-expand site and zoom to node
# 2. Click "AP" filter button → APs should hide from graph
# 3. Click "Expand all" → all 60 sites expand simultaneously
# 4. Click "Collapse all" → all sites collapse
# 5. Collapsed sites with cross-site links show "N cross-site" badge
# 6. Click any AP node → side panel shows "Site (1)" + "Connected Switch (1)" separately
# 7. Health dots are static (no frantic ping)

# Backend: collector fixes from earlier sessions still apply
cd backend && pytest -v
# Expected: 98 passed, 1 failed (pre-existing blast radius test)
```

---

## 5. Architecture Notes

### Search Implementation
- Fully client-side: filters `data.nodes` by name/node_id match
- No backend API needed — all nodes are already loaded
- On select: updates `expandedSites` via `setExpandedSites`, then calls `reactFlowInstance.fitView()`
- Delayed slightly (50ms) to let React re-render after state change

### Type Filter Implementation
- `activeTypeFilters` is a `Set<string>` state in `TopologyGraph`
- Passed to `buildGroupedLayout()`'s `useMemo` dependency array
- When filter changes, layout is recomputed from scratch
- The `siteGroup` nodes are only created when the "site" type is active — otherwise returns flat layout

### SNMP Polling Topology Discovery
- `SnmpPoller` walks `lldpRemTable` (OID `1.0.8802.1.1.2.1.4.1.1`) and `cdpCacheTable` (OID `1.3.6.1.4.1.9.9.23.1.2.1.1`) on each target switch
- Discovers AP MACs as LLDP remote chassis IDs, writes `physical_link` edges with `discovered_by: "snmp_lldp"`
- Switch nodes are upserted as `node_type = 'switch'` with `vendor = 'snmp'`
- Uses LEAST/GREATEST conflict constraint on edges to prevent A→B / B→A duplicates
- Requires SNMP v2c read-only community + target switch IPs in `.env`

### Ponytail Plugin
- Installed via `opencode.json` as `@dietrichgebert/ponytail` 
- Injects YAGNI-first ladder before every code generation turn
- Adds `/ponytail lite|full|ultra|off` commands for intensity control
- Also adds `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`
- Active every session; subagents inherit the same ruleset

### Edge Cross-Site Counting
- Computed in `buildGroupedLayout()` after site children are grouped
- For each site, iterates over all `flat.edges` and counts edges where one endpoint is in the site's child set and the other is not
- Result stored in `crossSiteEdgeCounts: Record<string, number>` and passed in the group node's `data`
