# Session 23 Handoff — Phase 3: Human Incident Titles

> **Handoff Date:** Aug 3, 2026
> **Session Goal:** Replace machine-y incident titles ("Site SFO-01 - connectivity issues affecting 2 devices", "core-switch-01 — failure cascading to 3 dependent devices") with one human-readable format: "``{Real Site} · {Root Device} {plain-language issue} — {N} devices affected``" — e.g. `Pimpri Plant · AP32-02 unreachable — 5 devices affected`.
> **Status:** Delivered end-to-end (backend + frontend + docs + tests). Full suite: **384 passed / 0 failed** — the "10 pre-existing failures" on the original run turned out to be stale tests (fixed in session 24, CHANGELOG [24]), not environment issues. Worker restarted on the live dev stack and new-case titles verified via `/incidents` API.

---

## 1. Executive Summary

Titles were the last noisy piece of the incident UX. Flat incidents read `"Site SFO-01 - connectivity issues affecting 2 devices"` (prefixed "Site", raw category codes, hyphen dash); cascade incidents were hand-built with raw device IDs and no site name (`"naxis-core-01 — failure cascading to 3 dependent devices"`) — and both the telemetry counters and the frontend "Cascade" badge were sniffing the brittle string `"failure cascading"`. Phase 3 makes `generate_incident_title()` the **single** title path for flat AND cascade incidents, with real site names, hostnames, and a plain-language issue map — and replaces every string-parsing consumer with structural detection.

---

## 2. Completed Items

### 2.1 Single human title generator (`backend/shared/correlation/rules.py:418`)

`generate_incident_title(events)` rewritten to produce:

```
"{Site Name} · {Root Device Hostname} {plain-language issue} — {N} devices affected"
```

- **`_EVENT_TYPE_LABELS`** — every EventType maps to a human phrase: `device_unreachable → "unreachable"`, `link_down/bgp_down/tunnel_down/… → "link down"`, `high_cpu/high_latency/packet_loss/… → "degraded"`, plus security/hardware/config/client/system phrases.
- **`_CATEGORY_LABELS`** — category-level fallback for `OTHER` / unmapped types.
- **`_site_label()`** — real `site_name`, falls back to `site_id`.
- **`_primary_device_event()/_primary_device_label()`** — highest-severity event's device, `device_name` preferred over `device_id`.
- **`_primary_issue_label()`** — picks the most-common event-type label among events on the primary device (severity tie-break) so the title names the *root device's* issue, not a symptom's.
- Device-count suffix only when >1 device involved; no site → starts with device; no device → sentence-case issue.

Real outputs:
- Spec target: `"Pimpri Plant · AP32-02 unreachable — 5 devices affected"` (exact-string unit test).
- Flat: `"SFO-01 · edge-sfo-01 link down — 2 devices affected"`.
- Cascade: `"SFO-01 · naxis-core-01 link down — 4 devices affected"` (root + 3 symptom APs).

### 2.2 Cascade + telemetry are now structural (`engine.py`, `worker/main.py`)

- `_create_from_cascade()` no longer hand-builds a title — it calls `generate_incident_title(root_events + symptom_events)`, so cascade incidents get the identical Phase 3 format (root-cause device named, full blast radius counted). Removed `root_device_str` block.
- Cascade/residual counting in `CorrelationEngine.process_events()` and `WorkerDaemon.run_once()` switched from `"failure cascading" in title.lower()` → `i.symptom_device_ids` (non-empty). Same semantics as before (a cascade with no symptoms never became a "failure cascading" incident), but no longer parses prose.
- `_EVENT_SEVERITY_RANK` extracted to module level in `rules.py` (was partially duplicated inline in engine).

### 2.3 Frontend — "Cascade" badge decoupled from title text

- `frontend/src/components/incidents/correlation-reasoning.tsx` — `isCascade = incident.symptom_device_ids.length > 0` (was `CASCADE_PATTERN` regex on `title`).
- `frontend/src/app/incidents/[id]/page.tsx` — removed `CASCADE_PATTERN` constant; badge renders on `symptom_device_ids.length > 0`.
- Blast-radius query, symptom grid, edges list — already keyed off `symptom_device_ids`, unaffected.

### 2.4 Tests

- `TestIncidentTitle` expanded 4 → 12: spec-example exact match, real-site-not-"Site", plain-language labels, root device named, `2 devices affected`, `unreachable`/`degraded` phrases, single-device omits count, `site_name → site_id` fallback, device-less event → category phrase (`"Connectivity issue"`).
- Engine assertions updated: title now `"SFO-01 · naxis-core-01 link down — 4 devices affected"`; flat title `"SFO-01 · edge-sfo-01 link down — 2 devices affected"`.
- Pipeline: cascade title asserts the real format; flat test asserts `symptom_device_ids == []`; residual/cascade selection is now structural.

### 2.5 Docs & models

- `docs/CORRELATION_ARCHITECTURE.md` — updated title contracts (Stage 1/2, appendix Redis payload), corrected `generate_incident_title` line ref (418) + `should_correlate` (93) + `group_events_by_site_and_time` (157); added "Retrieving Cascade Incidents" section (structural).
- `docs/explained/CORRELATION_ENGINE_EXPLAINED.md`, `docs/Plans/CORRELATION_PIPELINE_PLAN.md`, `docs/why/why-correlation-engine.md` — title examples and the cascade-counting snippet updated to the new format + structural detection.
- API + model examples (`backend/api/models/incident_models.py`, `backend/shared/models/incident.py` demo strings) match the new format.
- `CHANGELOG.md` — `[23]` entry.
- `graphify update .` — graph regenerated (since code changed).

### 2.6 Verify

```bash
python -m pytest backend/tests/test_correlation_engine.py backend/tests/test_correlation_pipeline.py \
                 backend/tests/test_correlation_telemetry.py backend/tests/test_topology_provider.py
# 151 passed, 1 failed (redis publish test) — that test is fixed in session 24
python -m pytest backend/tests  # full suite: 384 passed / 0 failed
npm run type-check  # only pre-existing error remains: topology-graph.tsx(502) ReactFlowInstance.toImage
```

(repo has no eslint config; `next lint` prompts to create one — type-check is the effective gate.)

## 3. Files Changed

| File | What |
|------|------|
| `backend/shared/correlation/rules.py` | `generate_incident_title()` rewritten + label maps + `_issue_label/_site_label/_primary_*` helpers |
| `backend/shared/correlation/engine.py` | cascade title via `generate_incident_title`; structural `symptom_device_ids` telemetry |
| `backend/worker/main.py` | structural cascade count in `run_once()` |
| `frontend/src/components/incidents/correlation-reasoning.tsx` | `CASCADE_PATTERN` → `symptom_device_ids.length > 0` |
| `frontend/src/app/incidents/[id]/page.tsx` | badge via `symptom_device_ids` |
| `backend/tests/test_correlation_engine.py` | `TestIncidentTitle` 4→12, title asserts updated |
| `backend/tests/test_correlation_pipeline.py` | cascade/flat/residual title asserts structural |
| `docs/CORRELATION_ARCHITECTURE.md`, `docs/explained/CORRELATION_ENGINE_EXPLAINED.md`, `docs/why/why-correlation-engine.md`, `docs/Plans/CORRELATION_PIPELINE_PLAN.md` | title format + cascade-counting examples |
| `backend/api/models/incident_models.py`, `backend/shared/models/incident.py` | example titles match new format |
| `CHANGELOG.md` | `[23] — Phase 3: Human Incident Titles` |
| `docs/handoff docs/23_handoff.md` | this file |

## 4. Verification of "Everything Through This Session"

- **Logic**: single title path (flat + cascade), root-cause device selection via severity, primary-issue phrase prefers the root device's events, count = unique device_ids (root + symptoms in cascade), 1-device incidents don't append the count. Stale-form strings (`failure cascading`, `connectivity issues affecting`, `Site SFO-01 - connectivity issues affecting N devices`) no longer exist in code or live docs (handoff docs 5/15/18/21/22 + historical CHANGELOG entries intentionally left as history).
- **Runtime smoke** (ad-hoc `python -c`): flat → `"San Francisco HQ · edge-sfo-01 link down — 2 devices affected"`; cascade via `MockTopologyProvider` → `"San Francisco · naxis-core-01 link down — 4 devices affected"`, `cascade? True`.
- **Side-effects from prior sessions** (not touched here): deterministic root-cause incident IDs, `DEVICE_REACHABLE` auto-resolve; per-site VeloCloud titles still pending live confirmation (linked from 22_handoff.md H1).

## 5. Pending Items (by Impact)

| # | Item | Why |
|---|------|-----|
| H1 | ~~Deploy/restart worker + live-verify new titles~~ | **DONE 2026-08-03** — worker restarted on the live docker stack (bind-mounted code). End-to-end over the real stack produced `"Verify LAB DC · Verify-Access-Point-01 unreachable — 2 devices affected"` (root-cause hostname, plain-language issue, count suffix) — exact Phase-3 format. Bonus: worker healthcheck was always failing (`ps` does not exist in the image) → replaced with `grep -q worker.main /proc/1/cmdline` in `docker-compose.yml`; worker now reports `healthy`. |
| L1 | ~`test_pipeline_does_not_publish_when_redis_disabled`~ | **DONE** — test now pins `wm._settings.redis_enabled=False` and asserts `get_redis_client` never called (env enables Redis). |
| L2 | "Pre-existing" 9 failures (velocloud×8, topology backbone) | **DONE — not env failures at all.** All 10 were stale tests vs the 51c26f4VeloCloud orchestrator refactor and a wrong 11-item fetch fixture for the 8-call backbone endpoint. Fixed in `test_velocloud_collector.py` / `test_topology_api.py`; full suite is 384 passed / 0 failed. |
| L3 | eslint config absent | `next lint` prompts to configure; only noteworthy because custom one preferred types. |

## 6. How to Pick Up — Next Developer

1. **Restart worker + verify live titles** (H1). Titles only apply to new incidents.
2. **Deploy** the two frontend files so the Cascade badge keeps working (it now reads `symptom_device_ids`, no longer the title string).
3. Opportunistic: M1 health_snapshot, L1 redis-test, L2 baseline failures.
4. If you change title wording later: edit only `_EVENT_TYPE_LABELS` / `_CATEGORY_LABELS` in `rules.py` (single source of truth). Structural detection (the frontend, telemetry) is immune to any future title wording changes.

## 7. CHANGELOG Entry

```
## [23] — 2026-08-03 — Phase 3: Human Incident Titles
- generate_incident_title() rewritten to read "{Real Site Name} · {Root Device Hostname} {plain-language issue} — {N} devices affected", e.g. "Pimpri Plant · AP32-02 unreachable — 5 devices affected" (was "Site SFO-01 - connectivity issues affecting N devices")
- Event types map to plain-language issue phrases ("unreachable", "link down", "degraded", …) with category fallbacks; real site_name (fallback site_id) and hostname replace raw codes/IDs
- Cascade incidents get the same human title via generate_incident_title(root + symptom) — names the root cause, counts the full blast radius
- Cascade detection is now structural (symptom_device_ids) in engine/worker telemetry + both frontend components — removed the "failure cascading" title string and CASCADE_PATTERN regexes
- 12 title unit tests (8 new) + engine/pipeline assertions updated
- Full suite: 375 passed / 10 pre-existing env failures unchanged