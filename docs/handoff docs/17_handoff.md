# Session 17 Handoff — Dashboard Collector Health Widget

## Objective
Surface live collector pipeline health on the main dashboard — the telemetry infrastructure was fully built (backend routes, alert generation, DB persistence) but invisible where operators spend the most time. Also fix `TelemetryAlertType` to match runtime camelCase.

---

## What We Did

### The Problem
Collector health data existed in the backend (`GET /telemetry`) and on the Integrations page (`/integrations`), but the main dashboard (`/`) had zero visibility into collector pipeline health. If Mist API went down or VeloCloud started returning errors, the dashboard still said "Systems nominal" because the health indicator only checked API connectivity. The telemetry infrastructure was complete but invisible where it mattered most.

### The Fix

#### `frontend/src/types/integration.ts`
- **Added types** `TelemetryCollectorEntry`, `TelemetrySummary`, `TelemetryResponse` matching the camelized `GET /telemetry` response (collectors + alerts + summary counts).
- **Fixed `TelemetryAlertType`** from snake_case (`"stale_data" | "repeated_failure" | "data_gap"`) to camelCase (`"staleData" | "repeatedFailure" | "dataGap"`) — the `camelizeKeys()` transform in `api.ts` has always produced camelCase at runtime, but the type never matched.

#### `frontend/src/lib/api.ts`
- Added `api.getTelemetry()` — polls `GET /telemetry`, returns `TelemetryResponse` (full collector entries + alerts + summary).

#### `frontend/src/components/dashboard/collector-health-widget.tsx` (new, ~140 lines)
A glass-card widget matching the existing dashboard aesthetic (bg-surface/40, border-border/60, hover effects). Handles 5 distinct states:

| State | Rendering |
|-------|----------|
| **Loading** | Skeleton with `naxis-enter` animation, pulse blocks matching final layout dimensions |
| **Error** | Red border card + `XCircle` icon + "Failed to load collector health" + Retry button |
| **Zero collectors** | Stat cards show 0, no alert section, all-healthy footer with link to Integrations |
| **All healthy** | Green "All healthy" header badge, 4 stat cards, "All collectors operating normally" footer |
| **Has alerts** | Animated pulsing red dot in header + critical count badge, expandable alert list (up to 3 `AlertBanner`s), "+N more" overflow link to Integrations, collapsible with chevron toggle |

Data flow: `useQuery` → `api.getTelemetry()` every 30s → summary stats (healthy/degraded/error/stale) in a 4-column grid + inline alarms via `AlertBanner`.

#### `frontend/src/app/page.tsx`
- Added `<CollectorHealthWidget />` between `<HeroSection>` and `<PlatformObserverSection>` in the dashboard layout.

---

## Files Changed

| File | Action | Lines |
|------|--------|:-----:|
| `frontend/src/types/integration.ts` | **Edited** — Added `TelemetryCollectorEntry`, `TelemetrySummary`, `TelemetryResponse`; fixed `TelemetryAlertType` to camelCase | +23 |
| `frontend/src/lib/api.ts` | **Edited** — Added `api.getTelemetry()` + import `TelemetryResponse` | +4 |
| `frontend/src/components/dashboard/collector-health-widget.tsx` | **New** — Full widget | ~140 |
| `frontend/src/app/page.tsx` | **Edited** — Imported + rendered `CollectorHealthWidget` | +4 |
| `docs/FRONTEND_ARCHITECTURE.md` | **Edited** — Added `CollectorHealthWidget` to dashboard component list | +2 |
| `docs/TELEMETRY_ARCHITECTURE.md` | **Edited** — Added section 7.5 for dashboard widget, updated file reference table | +15 |

**0 backend changes.**

---

## Test Counts

| Suite | Tests | Status |
|-------|:-----:|:------:|
| Frontend (Vitest) | 100/100 | ✅ Pass |
| Backend (pytest) | 300/300 | ✅ Pass |
| TypeScript | 0 errors | ✅ Pass |
| Build (next build) | OK | ✅ Pass |

---

## Doc Freshness — What's Up to Date vs Stale

### Updated this session
| Doc | Status | Notes |
|-----|--------|-------|
| `docs/handoff docs/17_handoff.md` | ✅ Fresh | This file |
| `docs/FRONTEND_ARCHITECTURE.md` | ✅ Updated | Dashboard section now lists `CollectorHealthWidget` |
| `docs/TELEMETRY_ARCHITECTURE.md` | ✅ Updated | Section 7.5 + file reference table for dashboard widget |

### Previously fresh (no changes needed)
| Doc | Status | Notes |
|-----|--------|-------|
| `docs/TOPOLOGY_VISUALIZATION.md` | ✅ | Session 14 update, topology-only, unchanged |
| `docs/CORRELATION_ARCHITECTURE.md` | ✅ | Correlation-specific, unchanged |
| `docs/ARCHITECTURE.md` | ✅ | High-level architecture, unchanged |
| `docs/DEVELOPER_GUIDE.md` | ✅ | Onboarding guide, unchanged |
| `docs/NAXIS_WHITEPAPER.md` | ✅ | Vision doc, unchanged |

---

## How Other Devs Know What Changed Each Session

Currently, the handoff docs (`docs/handoff docs/1..17`) are the only per-session record. There is **no aggregated changelog** that summarizes across sessions. A dev landing on the repo would need to:

1. Read the latest handoff doc for the current session context
2. Read `FRONTEND_ARCHITECTURE.md` + `TELEMETRY_ARCHITECTURE.md` + `TOPOLOGY_VISUALIZATION.md` for the system-level view
3. Browse individual handoffs for historical context

### Recommendation: Create a CHANGELOG.md
A single `CHANGELOG.md` at the repo root, with reverse-chronological entries summarizing each session. Format:

```markdown
# Changelog

## [17] — 2026-07-21 — Dashboard Collector Health Widget
- Added `CollectorHealthWidget` to main dashboard (polls GET /telemetry, shows summary stats + inline alerts)
- Added `api.getTelemetry()` and `TelemetryResponse` types
- Fixed `TelemetryAlertType` to match runtime camelCase

## [16] — 2026-07-20 — VeloCloud E2E Verification
- Fixed props data gap in VelocloudInventoryCollector (WAN links now stored in inventory DB)
- 151 new tests: 136 collector + 13 topology sync + 2 pipeline
- Total test suite: 300 backend tests

## [15] — 2026-07-17 — Correlation Engine Hardening
...
```

This gives any developer (or future AI session) a one-page summary of everything that happened. The handoff docs remain the detailed reference.

Want me to create it?

---

## Pending Items (for next session)

These items carried over from session 16 and remain open:

### 1. DNAC Topology → Graph (Medium)
`DnacTopologyCollector` emits events but never writes to `topology_nodes`/`topology_edges`. Only relevant if DNAC is deployed (currently not configured in `.env`).

### 2. Dashboard Event Count is Meaningless (Quick win, high visibility)
Line 31 of `page.tsx`: `api.listEvents({ limit: 1 })` returns lifetime total. Should be `{ start_time: <24h ago>, limit: 1 }`. The API and types already support `start_time`.

### 3. No Health Monitoring for Collectors (Medium)
The telemetry infrastructure persists collector runs to `collector_run_ledger` with full timing/failure data, but there's **no alerting consumer**. No one gets paged when a collector fails. The dashboard widget now *displays* alerts but doesn't *notify*.

### 4. VeloCloud Re-auth Every Cycle (Low)
`VeloCloudCollector.collect_all()` creates a fresh `httpx.AsyncClient` per cycle (60s). Re-authenticating adds ~500ms–2s overhead.

### 5. SNMP Poller Not Wired (Low)
`snmp_poller.py` exists but is never imported in `main.py`. Only relevant if SNMP polling is deployed.

### 6. `health_snapshot.py` Not Wired (Medium)
`backend/worker/collectors/health_snapshot.py` exists (171 lines + `__main__` self-test) but is never imported in `worker/main.py`. Needs to follow the same collector pattern as every other collector.
