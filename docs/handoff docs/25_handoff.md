# Session 25 Handoff — Phase 4: Truthful KPIs (API)

> **Handoff Date:** Aug 3, 2026
> **Session Goal:** Make the headline incident numbers on the Correlation Engine page truthful. Previously every KPI (`Outage` / `Degraded` / `Attention` / `Active` / `Total incidents` / `Avg confidence`) was computed client-side from `incidents.length` of `GET /incidents?limit=500` — with >500 incidents every KPI silently capped at 500 (the "500-row page length" lie). Phase 4 adds `GET /incidents/stats`, a single-pass SQL aggregate, and rewires the page to it + the list response's real `total`.
> **Status:** Delivered end-to-end (backend + frontend + tests + docs). Full suite: **389 passed / 0 failed** (384 + 5 new). `npm run type-check` clean.

---

## 1. Executive Summary

The correlation page fetched up to 500 incidents and computed its KPI row from that page — fine at <500 incidents, a silent lie beyond it. Phase 4 moves all headline numbers into Postgres aggregates so the page shows ground truth regardless of page size, while keeping the 500-row fetch purely for the incident *list* UI.

---

## 2. Completed Items

### 2.1 `GET /incidents/stats` — single-pass SQL aggregate (`backend/shared/database/incidents.py:221`)

`get_incident_stats()` runs one aggregate query plus one grouped query:

```sql
SELECT
    COUNT(*)                                          AS total,
    COUNT(*) FILTER (WHERE status = ANY($1::text[]))  AS active,
    (SELECT COUNT(DISTINCT s) FROM incidents AS i2, unnest(i2.affected_sites)   AS s) AS distinct_sites,
    (SELECT COUNT(DISTINCT d) FROM incidents AS i2, unnest(i2.affected_devices) AS d) AS distinct_devices,
    COALESCE(AVG(confidence_score), 0.0)              AS avg_confidence
FROM incidents
```

plus `SELECT severity, COUNT(*) FROM incidents GROUP BY severity`, zero-filled to all five severities (`critical/major/minor/warning/info`).

Response shape (Pydantic `IncidentStats` in `incident_models.py`):

```json
{
  "total": 42,
  "active": 7,
  "by_severity": {"critical": 2, "major": 4, "minor": 8, "warning": 0, "info": 28},
  "distinct_sites": 3,
  "distinct_devices": 15,
  "avg_confidence": 0.62
}
```

- **`ACTIVE_STATUS_VALUES`** (`incidents.py` module constant: `open/investigating/mitigated`) is now the single source of truth — the service's `_ACTIVE_STATUSES` derives from it, so the KPI definition can never drift from the service layer.
- **N+1 killed:** `IncidentService.get_stats()` previously ran one `COUNT(*)` per status in a loop; now one pass.

### 2.2 Route ordering (`backend/api/routes/incidents.py:108`)

`/stats` is registered **before** `/{incident_id}`, so FastAPI never swallows `GET /incidents/stats` as an incident lookup (that path would 404 with `incident_id="stats"`). Enforced by a dedicated test.

### 2.3 Correlation page rewired (`frontend/src/app/correlation/page.tsx`)

- New `useQuery(["incident-stats"], api.getIncidentStats)` (30s refetch, 15s list).
- KPI row now reads: `critical/major/minor` from `bySeverity`, `active` from `stats.active`, `total` from `kpiData.total ?? data.total`, `avg confidence` from `stats.avgConfidence`, plus two new cells **Sites affected** (`distinctSites`) and **Devices affected** (`distinctDevices`).
- `totalIncidents = data?.total ?? incidents.length` — the list response's true count (`incidents.py:100` → `count_incidents()`), never `incidents.length`.
- Footer now "Showing X of **total** incidents".
- The 500-row fetch remains only for the list/search UI (filtering/sorting happens client-side), where it is correctly labeled by the footer.

### 2.4 Tests (`backend/tests/test_incident_stats_api.py`, 5 new)

Mocks `shared.database.incidents.db` and goes through the real service + route (pattern from `test_topology_api.py`):

1. Aggregates map correctly end-to-end (total/active/by_severity/distinct/avg).
2. The SQL receives the active-status values (`["open", "investigating", "mitigated"]`) — pins the single source of truth.
3. Severity zero-fill when no severity rows.
4. Route ordering — `/incidents/stats` returns the stats shape, not a 404 incident lookup.
5. 500 on DB error.

### 2.5 Docs

- `CHANGELOG.md` — `[25]` entry.
- `docs/CORRELATION_ARCHITECTURE.md` — new "Incident KPIs (Phase 4)" section (query, field table, rationale) + file-reference row for `incidents.py`.
- `docs/DEVELOPER_GUIDE.md` — test matrix + `test_incident_stats_api.py`, suite count 380+.
- `docs/handoff docs/25_handoff.md` — this file.

### 2.6 Verify

```bash
python -m pytest backend/tests/test_incident_stats_api.py   # 5 passed
python -m pytest backend/tests                              # 389 passed / 0 failed
npm run type-check                                          # clean (incl. former topology-graph.tsx error — resolved)
```

## 3. Files Changed

| File | What |
|------|------|
| `backend/shared/database/incidents.py` | `ACTIVE_STATUS_VALUES` constant + `get_incident_stats()` single-pass aggregate |
| `backend/shared/database/__init__.py` | export `get_incident_stats` |
| `backend/api/models/incident_models.py` | `IncidentStats` response model |
| `backend/api/services/incident_service.py` | `get_stats()` → `get_incident_stats()`; `_ACTIVE_STATUSES` derives from repo constant |
| `backend/api/routes/incidents.py` | `GET /incidents/stats` route (before `/{incident_id}`) |
| `frontend/src/types/incident.ts` | `IncidentStats` interface |
| `frontend/src/lib/api.ts` | `getIncidentStats()` |
| `frontend/src/app/correlation/page.tsx` | KPI row from stats endpoint + `data.total`; Sites/Devices cells; truthful footer |
| `backend/tests/test_incident_stats_api.py` | 5 API tests (new file) |
| `docs/CORRELATION_ARCHITECTURE.md`, `docs/DEVELOPER_GUIDE.md` | Phase 4 endpoint docs + test matrix |
| `CHANGELOG.md` | `[25] — Phase 4: Truthful KPIs (API)` |
| `docs/handoff docs/25_handoff.md` | this file |

## 4. Verification of "Everything Through This Session"

- **Logic**: all six headline numbers now come from SQL aggregates; the only remaining page-length-derived numbers are the list itself (filtered/searchable) and its "Showing X of Y" footer, which now shows the true total.
- **Fallbacks**: while `/incidents/stats` is loading, KPI cells fall back to the list-derived values (0 or page-length) so the row never renders `undefined`; once loaded, they snap to truth.
- **Single source of truth**: active = `ACTIVE_STATUS_VALUES` in the repo; severity set = `IncidentSeverity` enum; both consumed by SQL and the service.

## 5. Pending Items (by Impact)

All cleared in the follow-up pass (same session):

| # | Item | Resolution |
|---|------|------------|
| L1 | Deploy/restart API on the live docker stack + verify `/incidents/stats` against live DB | DONE. API image rebuilt + recreated; live DB: `stats.total == list.total` (11,025), `stats.active == ?status=open` (5,986), by_severity/distinct_sites(71)/distinct_devices(1,468) verified; bogus `status` rejected with 422. Web container built + running; `/correlation` renders the full KPI row |
| L2 | `stats-panel.tsx` (dashboard) still sums `affected_*_count` over active incidents | DONE. Component deleted — zero consumers (grep verified); deletion over keeping a wrong-but-unused sum |
| L3 | Frontend unit tests for the KPI fallback logic | DONE. Fallback extracted into pure `buildStats()` (`frontend/src/lib/incident-stats.ts`), page consumes it; 5 vitest cases in `frontend/src/lib/incident-stats.test.ts` (SQL passthrough, true-total fallback, confidence mean, zero-fill, partial-response handling). Frontend suite now 105 tests; `npm test` + `type-check` green |

**Bonus bug found during live-verify:** `GET /incidents` silently ignored `?status=` (FastAPI drops unknown params) — the service/repo already supported `status_filter`, so the route now exposes it (`status: List[IncidentStatus]`). Verified live: `?status=open` → 5,986, `?status=resolved` → 5,039, invalid → 422. 3 new route tests (`backend/tests/test_incidents_api.py`).

**Doc gap fixed:** `24_handoff.md` never existed (session 24 was CHANGELOG-only). Backfilled from CHANGELOG [24].

## 6. How to Pick Up — Next Developer

1. The stack is fully running with Phase 4 code: `docker compose ps` → api/worker/postgres/redis/web all up. Live-verify is done; nothing pending.
2. If the "active" definition changes later: edit only `ACTIVE_STATUS_VALUES` in `backend/shared/database/incidents.py` (SQL + service both derive from it).
3. Frontend tests: `cd frontend && npm test` (vitest, no config needed).

## 7. CHANGELOG Entry

```
## [25] — 2026-08-03 — Phase 4: Truthful KPIs (API)
- New GET /incidents/stats — single-pass SQL aggregates: total, active (open/investigating/mitigated), by_severity (zero-filled), distinct_sites/devices (COUNT(DISTINCT unnest(...))), avg_confidence
- Replaced the service's N+1 get_stats() (one COUNT per status) with one aggregate query; ACTIVE_STATUS_VALUES is the single source of truth shared by repo + service
- Correlation page KPIs now render from /incidents/stats + the list response's true total — previously every KPI was computed from incidents.length of a 500-row page (silent cap at 500)
- Added Sites/Devices affected KPI cells + truthful "Showing X of Y" footer
- 5 new API tests: aggregates, active-status SQL param, zero-fill, route ordering, 500 on error
- Full suite: 389 passed / 0 failed; type-check clean
```
