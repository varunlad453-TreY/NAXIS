# Topology All-Sites Table Redesign & Regional Hub Detail Panel — Engineering Handoff

**Date:** 2026-08-14
**Scope:** Redesign `AllSitesGrid` to match the platform's existing table-based layout conventions (replacing card grid), and add a Regional Hub detail panel so hub cards expand into their constituent sites instead of drilling to an arbitrary first site.

---

## 1. Accomplishments

### All-Sites Grid Redesign (`all-sites-grid.tsx`)

**Problem:** The `All Sites` view used a card grid (210px cards, hover glow, borders, pills, pagination) that looked nothing like the rest of the platform's dense table-based pages (`/locations`, `/clients`, `/connectivity`, `/performance`).

**Solution:** Replaced card grid with a data table matching existing page conventions:

1. **Inline Metrics Bar** — Total Sites · Operational · Alerts · Critical · Total APs (separated by `|` pipe, matching other pages)
2. **Underlined Tab Filters** — Region tabs (All / North India / West India / …) and Status tabs (All / Healthy / Warning / Critical / Degraded) with active underline indicator
3. **Clickable Column Headers for Sort** — Asc/desc arrows on Site · Region · Status · APs · Alerts columns
4. **Status Dot + Colored Text** per row (no card borders, no hover glow)
5. **Removed Pagination** — all rows scrollable in table body

### Regional Hub Detail Panel (`topology-graph-v2.tsx`)

**Problem:** Clicking a **Regional Hub** card (e.g. "Delhi NCR Hub" showing 9 sites · 192 devices) drilled to `regionSites[0]` — an arbitrary first site. Users saw only ~3 APs + 1 switch for that single site, which was confusing because the hub headline promised 9 sites.

**Root Cause:** `handleNodeClick` treated `regionalHub` nodes the same as `siteGroup` nodes, extracting `regionSites[0].site_id` and calling `onSiteSelect()`.

**Solution:**
1. Added `selectedRegionHub` state to `topology-graph-v2.tsx` holding:
   - Hub name
   - Full `regionSites[]` array
   - Aggregate counts (sites, devices, critical, warning)
2. Clicking a hub card now opens a **slide-in detail panel** (380px, right side) showing:
   - Hub header with aggregate stats
   - Table of every site in the region (name, APs, alerts, status)
   - Click any site row → drills into that specific site
   - ✕ close button → dismiss panel, stay on hub view
3. `siteGroup` / `statusBanner` clicks still drill to single site as before

### Export Shared Helpers (`all-sites-grid.tsx`)

- Exported `regionFromSite()` and `healthColor()` so `topology-graph-v2.tsx` can reuse them for the hub panel without duplicating logic.

---

## 2. File Inventory

### Modified Files

| File | Change |
|---|---|
| `src/components/topology/all-sites-grid.tsx` | Complete redesign: card grid → table layout. Inline metrics bar, underlined tab filters, clickable sort headers, status dots. Exported `regionFromSite` and `healthColor`. |
| `src/components/topology/topology-graph-v2.tsx` | Added `selectedRegionHub` state; `handleNodeClick` now treats `regionalHub` specially (opens panel instead of drilling to first site); added `useEffect` to clear region filter when leaving All Sites view; added Region Hub detail panel UI (380px slide-in with site table). |
| `src/components/topology/topology-graph.tsx` | Minor fix: `regionalHub` added to group-node checker in `handleNodeClick` (from previous session). |
| `src/components/topology/topology-toolbar.tsx` | Formatting-only changes (prettier indentation). |

---

## 3. API Contracts Used

| Endpoint / Data Source | Usage |
|---|---|
| `GET /topology/backbone` | Feeds site nodes to `AllSitesGrid` and `buildRegionClustersLayout` |
| `TopologyNode` fields (`health_status`, `device_count`, `critical_count`, `warning_count`, `site_id`, `site_name`, `name`) | Parsed in table rows and hub panel aggregates |
| `regionSites` (from `buildRegionClustersLayout` data payload) | Array of sites attached to each hub node data; used by hub detail panel |

---

## 4. Verification

- **TypeScript:** `npx tsc --noEmit` → Clean (0 errors).
- **Build:** `npm run build` → Compiled successfully, all 15 pages generated.
- **Tests:** `npm test` → 114/114 passed.
- **Interactive Verification:**
  - `Regional Hubs` → Click Delhi NCR Hub → panel slides in showing all 9 sites with real per-site stats.
  - `All Sites` → Table view with inline metrics, tab filters, clickable sort headers.
  - `Problem Sites` → Status banner or degraded sites render correctly.
  - Click any site row (in hub panel or All Sites table) → drills into single-site topology.

---

## 5. Next Steps

1. **Hub Panel Enhancements:** Add inter-site edge visualization inside the hub panel, or a mini-map of site geography.
2. **Bulk Actions in All Sites:** Checkbox selection for multi-site diagnostics/export (carried over from 47_handoff).
3. **Backend Region Tagging:** Still needed — explicit `region` field in `topology_nodes` to replace string-matching heuristic in `regionFromSite()`.

(End of file)
