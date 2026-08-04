# Session 27 Handoff — Phase 5: Alerts Page UX

> **Handoff Date:** Aug 4, 2026
> **Session Goal:** Turn the "Correlation Engine" page into an operator-first **Alerts** page: real KPIs (Active outages / Sites affected / Devices affected / Avg confidence), alerts grouped by root cause with "ongoing for 2h 14m" durations, root device + site name per row, Outage/Degraded/Attention labels, and engine telemetry demoted to a footnote. Backend enrichment so rows carry real names — migration-free.
> **Status:** Done. Full suite: **397 backend passed / 0 failed** + **114 frontend passed**; `npm run type-check` clean; live-verified on the docker stack.

---

## 1. Executive Summary

The correlation page was an engineering view: "Correlation Engine" title, engine-health panel as a first-class section, KPIs mixing severity buckets with totals. Phase 5 makes it an operator's alert queue:

- **Renamed** to "Alerts" (nav already said "Alerts"; page title + empty state updated)
- **KPIs** trimmed to the four the operator asks first: Active outages, Sites affected, Devices affected, Avg confidence — all from truthful `/incidents/stats` SQL aggregates
- **Engine telemetry** demoted from a panel to a one-line footnote
- **List grouped by root cause**: incidents sharing a root device + site render under one header ("root device · site name"), with the worst severity and newest incident driving group sort
- **Per row**: Outage/Degraded/Attention label (SeverityBadge), "ongoing for 2h 14m" (live `formatElapsed`), device count, confidence, event count
- **Backend enrichment**: `IncidentSummary` gained `site_name` + `root_device`, batch-resolved from inventory (sites: UUID + numeric VeloCloud site ids) and events (numeric VeloCloud edge ids → hostname; UUID Mist device ids → inventory hostname). Zero schema changes.

## 2. Completed Items

### 2.1 Backend enrichment (migration-free)

| Piece | What |
|-------|------|
| `shared/database/incidents.py` | New `resolve_display_names(site_ids, root_device_ids)` — batched: sites from `inventory.site_id → site_name` (covers both UUID Mist sites and numeric VeloCloud site ids); UUID device ids from `inventory.device_id → hostname`; numeric edge ids from `events` latest `device_name` (`DISTINCT ON`, preferring real hostnames over id-fallback names) |
| `api/routes/incidents.py` | `_enrich_summaries()` batch helper + `_incident_to_summary(incident, site_names, root_device_names)`; wired into `GET /incidents` and `GET /incidents/active` |
| `api/models/incident_models.py` | `IncidentSummary` + `site_name`, `root_device` (both default `""`) |
| `frontend/src/types/incident.ts` | Matching optional fields on `IncidentSummary` |

Resolution is best-effort: unresolvable ids leave the field empty; the UI falls back to "Unknown site" / "Multiple devices" only when a whole incident lacks the data.

### 2.2 Frontend

- `app/correlation/page.tsx` — rebuilt as the Alerts page: title, description, 4-KPI row, telemetry footnote, root-cause grouped list (`AlertRow`), severity filter chips (Outage/Degraded/Attention), search covering title/id/site/root device
- `lib/alerts.ts` — `groupByRootCause()` pure helper + `RootCauseGroup`
- `lib/utils.ts` — `formatElapsed(startIso, nowIso)` → "2h 14m" style durations (guards NaN/negative/invalid input)
- `components/incidents/incident-card.tsx` — unchanged; the page now renders its own compact `AlertRow` (card still used elsewhere)

### 2.3 Tests

| File | Coverage |
|------|----------|
| `backend/tests/test_incident_enrichment.py` (new, 4 tests) | site + root names resolved; empty fallback; UUID root from inventory (no events query); empty list |
| `backend/tests/test_correlation_engine.py` | **+`test_cross_cycle_severity_escalation_same_incident`** — worse event in a later cycle escalates the SAME incident (dedup key stable; upsert recomputes severity). Existing dedup/title/recovery tests already covered the Phase 5 spec items |
| `frontend/src/lib/alerts.test.ts` (new, 3 tests) | grouping by root cause; fallback labels; severity+recency sort |
| `frontend/src/lib/utils.test.ts` (new, 6 tests) | `formatElapsed` minutes/hours/days/just-now/negative/invalid |

### 2.4 Verify

```bash
python -m pytest backend/tests      # 397 passed / 0 failed
cd frontend && npm run type-check   # clean
cd frontend && npm test             # 114 passed
```

### 2.5 Live verification (docker stack)

- API image rebuilt (note: `api` service has **no `build:`** in compose — build manually `docker build -t naxis-api -f backend/Dockerfile --target production .` then `docker compose up -d --force-recreate api`)
- `GET /incidents` now returns `site_name` ("GDC-ICC-Pune: (A61)", "Pune : Pimpri Factory (A12)") and `root_device` ("TMPNE-A61-GDC-OFF-02") for real rows
- `GET /incidents/stats` truthful: total 11085, active 6046, distinct_sites 71, distinct_devices 1468, avg_confidence 0.69
- Web rebuilt; `/correlation` renders "Alerts", the 4 KPIs, and grouped rows (spot-checked rendered HTML)

## 3. Files Changed

| File | What |
|------|------|
| `backend/shared/database/incidents.py` | +`resolve_display_names()` batch resolver |
| `backend/api/routes/incidents.py` | +`_enrich_summaries()`, enriched `_incident_to_summary`, imports fixed |
| `backend/api/models/incident_models.py` | `IncidentSummary` + `site_name`, `root_device` |
| `backend/tests/test_incident_enrichment.py` | **New** — 4 API enrichment tests |
| `backend/tests/test_correlation_engine.py` | +cross-cycle severity escalation test (103 tests in file) |
| `frontend/src/app/correlation/page.tsx` | Full Alerts page rebuild |
| `frontend/src/lib/alerts.ts` | **New** — root-cause grouping helper |
| `frontend/src/lib/utils.ts` | +`formatElapsed()` duration helper |
| `frontend/src/lib/alerts.test.ts` | **New** — 3 grouping tests |
| `frontend/src/lib/utils.test.ts` | **New** — 6 duration tests |
| `frontend/src/types/incident.ts` | `site_name?`, `root_device?` on `IncidentSummary` |
| `CHANGELOG.md` | `[27]` entry |
| `docs/handoff docs/27_handoff.md` | this file |

## 4. Verification of "Everything Through This Session"

- **No schema migration:** enrichment is query-time joins; `001_init.sql`/`007_incident_root_symptom.sql` untouched
- **No regressions:** 392 → 397 backend (5 new), 108 → 114 frontend (6 new), type-check clean
- **Historical docs untouched** (records by design); live docs will gain the Alerts page reference in DEVELOPER_GUIDE if the next session touches it

## 5. Pending Items (by Impact)

None known. (`root_device` empty for incidents with no root-cause device — the UI shows "Multiple devices"; enrichment covers numeric VeloCloud edge ids and UUID Mist ids.)

## 6. How to Pick Up — Next Developer

1. **API rebuild quirk:** `docker-compose.yml` `api` service has no `build:` — to ship backend changes: `docker build -t naxis-api -f backend/Dockerfile --target production . && docker compose up -d --force-recreate api` (or add a `build:` to compose). The `worker` service builds from the same Dockerfile.
2. `resolve_display_names()` is the single place name resolution lives — reuse for incident detail enrichment if the detail page needs site/device names per device.
3. `formatElapsed` is intentionally pure and testable; feed `nowIso` explicitly in tests, default `new Date()` in production.
4. Grouping is client-side (`groupByRootCause`) — fine at 500-row page; if the list ever exceeds that, move grouping server-side.
5. Follow the test pattern `mock_db.fetch` ordered `side_effect` (incidents → sites → devices) in `test_incident_enrichment.py` when adding list-route tests.

## 7. CHANGELOG Entry

```
## [27] — 2026-08-04 — Phase 5: Alerts Page UX
- Correlation Engine page rebuilt as "Alerts": title/empty-state renamed; engine telemetry demoted
  from a panel to a one-line footnote
- KPIs trimmed to Active outages / Sites affected / Devices affected / Avg confidence (truthful
  SQL aggregates from /incidents/stats)
- List grouped by root cause (root device + site header), rows show Outage/Degraded/Attention
  label, "ongoing for 2h 14m" duration (formatElapsed), device count, confidence, event count
- Backend: IncidentSummary + site_name/root_device, batch-resolved via new resolve_display_names()
  (inventory for sites + UUID devices, events latest device_name for numeric VeloCloud edge ids);
  wired into GET /incidents and /incidents/active — migration-free
- Tests: 4 new backend enrichment tests + cross-cycle severity escalation test (103 engine tests);
  9 new frontend tests (grouping + durations)
- Full suite: 397 backend passed / 0 failed; 114 frontend passed; type-check clean;
  live-verified on docker stack (site_name/root_device resolve to real names; stats truthful)
```
