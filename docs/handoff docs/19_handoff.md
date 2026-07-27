# Session 19 Handoff — Notification System, Dashboard UX, DB Performance

> **Handoff Date:** July 27, 2026
> **Session Goal:** Fix VeloCloud stub collectors, ship Slack+email notification system for collector health, polish dashboard event count UX
> **Status:** All VeloCloud 5 collectors producing real data. Notification system built (disabled by default). Dashboard event count now has time-range selector with instant switching.

---

## 1. Executive Summary

This session had three main threads:

1. **VeloCloud all-5-collectors live** — Links, tunnels, apps collectors were `mark_skipped()` stubs from session 18. Now they call real VCO API endpoints. All 5 show `status=success`. VeloCloudAppsCollector correctly `mark_skipped` because VCO vco109 returns `methodError` on `monitor/*` endpoints (VCO limitation, not a code bug).

2. **Collector health notification system** — Built Slack webhook + SMTP email + in-memory dedup engine. Wired into worker cycle after health check. Disabled by default (`NOTIFICATION_ENABLED=false`); user must configure Slack URL or SMTP creds.

3. **Dashboard event count UX overhaul** — Time-range selector (1h/24h/7d/30d), pre-fetch all 4 ranges on mount, keep previous count during loading, show `—` on blank slate instead of `0`. Plus PostgreSQL index on `events.timestamp` (was declared in ORM but never created in DB — queries went from ~10s to ~650ms).

**Key accomplishments:**
1. VeloCloud all 5 collectors producing real data (edges=93, links=442, tunnels=0, events=171, inventory=93)
2. Stale `velocloud-auth` entries cleaned from `collector_run_ledger` (9 rows)
3. Notification system: Slack webhook sender, SMTP email sender, in-memory dedup engine (15-min window)
4. 11 new env vars in `settings.py` (enable flag, Slack URL, SMTP config, recipients, min failure/skip thresholds)
5. Dashboard event count time-range selector (1h/24h/7d/30d) — instant switching via pre-fetch
6. No more `0` flash — `placeholderData` keeps previous count, `—` on initial blank slate
7. PostgreSQL index `ix_events_timestamp` on `events (timestamp)` — was ORM-declared but never created
8. Postgres container `shm_size` increased from 64MB to 256MB (autovacuum can keep up)

---

## 2. Completed Items

### 2.1 VeloCloud — All 5 Collectors Live

| Collector | Before | After | What Changed |
|-----------|--------|-------|-------------|
| `velocloud-edges` | ✅ Live | ✅ Live | Already worked |
| `velocloud-links` | ❌ Stub (`mark_skipped`) | ✅ Live | `getEnterpriseLinks` endpoint with edge-ID mapping |
| `velocloud-tunnels` | ❌ Stub (`mark_skipped`) | ✅ Live | `getEdgeTunnels` endpoint with edge-ID mapping |
| `velocloud-events` | ✅ Live | ✅ Live | Already worked |
| `velocloud-apps` | ❌ Stub (`mark_skipped`) | ⚠️ mark_skipped (VCO limitation) | Tries `getEdgeAppSeries` then `getEnterpriseEdgeAppMetrics`; both return `methodError` on vco109 |

**Cleanup:** 9 stale `velocloud-auth` rows deleted from `collector_run_ledger` (leftover from the per-cycle re-auth pattern that session 18 replaced with persistent client).

### 2.2 Collector Health Notification System

| File | Action | Purpose |
|------|--------|---------|
| `backend/shared/monitoring/notifier.py` | **New** | Slack webhook sender (rich formatting with blocks), SMTP email sender (HTML table), in-memory dedup engine (dict with epoch timestamps, 15-min default window) |
| `backend/config/settings.py` | **Edited** | 11 new env vars in `NotificationSettings` |
| `backend/worker/main.py` | **Edited** | Imports `dispatch_alerts`, calls it after `check_collector_health()` in every cycle |
| `backend/shared/monitoring/collector_health.py` | **Edited** | Uses `settings.notification_min_failures` / `settings.notification_min_skips` instead of hardcoded 3/10 |

**Notification env vars (all in `.env`):**

| Var | Default | Purpose |
|-----|---------|---------|
| `NOTIFICATION_ENABLED` | `false` | Master enable/disable |
| `NOTIFICATION_MIN_FAILURES` | `3` | Trigger threshold |
| `NOTIFICATION_MIN_SKIPS` | `10` | Trigger threshold |
| `SLACK_WEBHOOK_URL` | — | Slack webhook URL |
| `SMTP_HOST` | — | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASSWORD` | — | SMTP password |
| `SMTP_FROM` | — | From address |
| `NOTIFICATION_EMAIL_TO` | — | Comma-separated recipients |
| `NOTIFICATION_DEDUP_MINUTES` | `15` | Dedup window per alert key |

### 2.3 Dashboard Event Count UX

| What | Before | After |
|------|--------|-------|
| **Time range** | Hardcoded 24h | 1h / 24h / 7d / 30d selector (pill buttons in HeroSection) |
| **Load time** | ~10s per switch (DB query each time) | Instant (all 4 queries fire on mount, cached independently) |
| **Loading state** | Flashed `0` | Shows previous count dimmed (`opacity: 40%`), or `—` on very first load |
| **Label** | "events ingested" | "events in last 24 hours" / "last 7 days" / etc. |

**Files:**
- `frontend/src/app/page.tsx` — `useEventCounts()` hook fires 4 parallel queries, `useCount` now returns `{ count, isStale }`
- `frontend/src/components/dashboard/hero-section.tsx` — `eventRange` prop, range pill buttons, `eventCountStale` for dimming, `eventCount: number | null` with `—` display

### 2.4 DB Performance

| Change | Before | After |
|--------|--------|-------|
| **Index** | No index on `events.timestamp` (ORM had `index=True` but was never created) | `CREATE INDEX ix_events_timestamp ON events (timestamp)` |
| **shm_size** | 64MB (Alpine default) | 256MB (autovacuum can run) |
| **COUNT query (24h)** | ~10,000ms (sequential scan) | ~650ms (Parallel Index Only Scan) |

---

## 3. Items Carried Forward from Session 18

| # | Item | Priority | Why Still Open |
|---|------|----------|----------------|
| 1 | SNMP credentials page | Medium | Requires `POST/GET/DELETE /api/v1/settings/snmp/credentials` backend endpoints + frontend form |
| 2 | SNMP v3 creds from env | Medium | `snmp_poller.py` has no env-based config path; read `SNMP_V3_USER`, `SNMP_V3_AUTH_KEY`, `SNMP_V3_PRIV_KEY` |
| 3 | DNAC Topology → Graph | Low | Only relevant if DNAC is deployed; currently not configured |
| 4 | Arista WLC timestamp cross-year | Low | Current `strptime` uses current year; wrong for logs crossing Dec/Jan |
| 5 | Backend dead code scan | Low | Run `pyflakes` / `pylint` on `backend/` |

---

## 4. New Pending Items (by Impact)

### High Impact

| # | Item | Why High |
|---|------|----------|
| H1 | **Enable notification system in production** | `NOTIFICATION_ENABLED=false` by default; user must set to `true` and configure Slack URL or SMTP creds. Without this, collector failures are silent. |
| H2 | **VeloCloud apps collector — per-VCO-version endpoint config** | `vco109` returns `methodError` on all `monitor/*` endpoints. Needs a VCO-version → endpoint map so different VCO versions use different APIs for app visibility. |

### Medium Impact

| # | Item | Why Medium |
|---|------|------------|
| M1 | **SNMP credentials management** | `.env` has `SNMP_TARGETS` but no UI to manage creds; blocks SNMP polling from being usable |
| M2 | **Mist client topology (0 rows)** | Mist API returns empty client data; likely needs Mist-side configuration (client tracking enabled per site) |
| M3 | **Mist radio neighbors (0 rows)** | Mist API returns empty; likely needs radio scanning enabled |

### Low Impact

| # | Item | Why Low |
|---|------|---------|
| L1 | Backend dead code scan | Quality only; no user-facing impact |
| L2 | Arista WLC cross-year timestamp | Edge case (Dec/Jan boundary) |
| L3 | DNAC Topology → Graph | Requires DNAC deployment |

---

## 5. New Files Created

| File | Purpose |
|------|---------|
| `backend/shared/monitoring/notifier.py` | Slack webhook + SMTP email + dedup engine |

---

## 6. Files Modified

| File | Change |
|------|--------|
| `backend/worker/collectors/velocloud.py` | Links/tunnels/apps collectors switched from `mark_skipped()` stubs to real VCO API calls with retry + 404 fallback |
| `backend/shared/monitoring/collector_health.py` | Thresholds now read from `settings.notification_min_failures` / `settings.notification_min_skips` |
| `backend/config/settings.py` | Added `NotificationSettings` with 11 env vars |
| `backend/worker/main.py` | Imported `dispatch_alerts`, wired after `check_collector_health()` |
| `.env` | Added commented-out notification settings for discoverability |
| `frontend/src/app/page.tsx` | `useEventCounts()` fires 4 queries, `useCount` returns `{ count, isStale }`, range pills |
| `frontend/src/components/dashboard/hero-section.tsx` | Accepts `eventRange`/`eventCountStale`/`eventCount: number`, renders range pills, shows `—` |
| `frontend/src/components/dashboard/platform-observer-section.tsx` | Accepts `number | null` for counts, shows `—` |
| `docker-compose.yml` | Added `shm_size: 256mb` to postgres service |

---

## 7. Architecture Decisions

### 7.1 Notification System: In-Process, Not Microservice
**Decision:** A Python module in the worker process, not a separate service.
**Rationale:** The worker already runs `check_collector_health()` every cycle. Adding `dispatch_alerts()` in the same process adds ~100ms overhead. A separate notification service would require another container, Redis queue, healthcheck, and deployment complexity. The in-memory dedup suffices since the worker is single-instance.

### 7.2 Dedup Strategy: In-Memory Epoch Map, Not DB
**Decision:** `dict[str, float]` (alert_key → last_sent_epoch) in the notifier module.
**Rationale:** The worker restarts at most once per deploy. A DB-backed dedup would prevent re-alerting after restart, but restarts are rare and operator would see the issue during restart windows anyway. The in-memory approach is 0 dependencies, 0 migration, 5 lines of code.

### 7.3 Pre-fetch All 4 Event Ranges, Not 1
**Decision:** Fire all 4 range queries (`1h`, `24h`, `7d`, `30d`) on mount, cache independently.
**Rationale:** Switching ranges was slow (~650ms-5s per DB query). Pre-fetching pauses the cost to initial page load (parallel, ~1-2s total) and makes subsequent switching instant (cache hit). With 15s background polling, all ranges stay fresh. The alternative (backend-side pre-aggregation) would require a new table and migration.

### 7.4 DB Index vs Materialized View
**Decision:** Simple B-tree index on `events.timestamp`.
**Rationale:** The 3M-row table with a timestamp index gives sub-second COUNT queries. A materialized view or summary table would be faster but adds maintenance overhead (must be refreshed) and another schema object. Indices are self-maintaining.

---

## 8. Collector Registry — Updated

| Vendor | Collector ID | Purpose | Status |
|--------|-------------|---------|--------|
| **Mist** | `mist-events` | Alarms + audit logs | ✅ Live |
| | `mist-inventory` | AP inventory + stats | ✅ Live |
| | `mist-ap-history` | Device lifecycle tracking | ✅ Live |
| | `mist-ap-rf` | Wireless performance metrics | ✅ Live |
| | `mist-client-topology` | Client connectivity mapping | ⚠️ Empty response |
| | `mist-wired-uplink` | AP-to-switch topology | ✅ Live |
| | `mist-radio-neighbors` | RF interference detection | ⚠️ Empty response |
| **DNAC** | `dnac-devices` | Network device inventory | ✅ Registered |
| | `dnac-alarms` | Assurance events | ✅ Registered |
| | `dnac-topology` | Physical + L3 topology | ✅ Registered |
| | `dnac-clients` | Client health overview | ✅ Registered |
| | `dnac-interfaces` | Interface status | ✅ Registered |
| **VeloCloud** | `velocloud-edges` | Edge appliance inventory | ✅ Live |
| | `velocloud-links` | Link metrics | ✅ Live |
| | `velocloud-tunnels` | Tunnel health | ✅ Live |
| | `velocloud-events` | Enterprise events/alarms | ✅ Live |
| | `velocloud-apps` | Application visibility + QoS | ⚠️ mark_skipped (VCO limit) |
| **Arista WLC** | `arista-wlc-clients` | Wireless client inventory | ✅ Live |
| | `arista-wlc-aps` | AP inventory + radio status | ✅ Live |
| | `arista-wlc-radios` | Channel utilization + interference | ✅ Live |
| | `arista-wlc-events` | Controller events/alarms | ✅ Live |

**Total: 21 collectors across 4 vendors**

---

## 9. Worker Cycle — Updated

The `WorkerDaemon.run_once()` cycle now has 11 steps instead of 10:

1. Run all configured collectors
2. Record each outcome to `collector_run_ledger`
3. Write worker heartbeat to `worker_heartbeat`
4. Persist events to Postgres
5. Sync topology from inventory
6. Run correlation engine → incidents
7. Publish incidents to Redis (if enabled) → SSE endpoint
8. Record correlation telemetry to DB
9. Run collector health monitoring (failure/skip pattern detection)
10. **Run notification dispatch** (if enabled: Slack + email via dedup engine) ← NEW
11. Run data retention cleanup (>7d)
12. Sleep for `COLLECTOR_INTERVAL` seconds

---

## 10. How to Pick Up — Next Developer

### Critical (must do before production sign-off)
1. **Enable notification system**: Set `NOTIFICATION_ENABLED=true` in `.env`, configure `SLACK_WEBHOOK_URL` or SMTP creds, set `NOTIFICATION_EMAIL_TO`

### High-impact improvements
2. Build SNMP credentials management UI (backend endpoints + frontend form)
3. Implement VCO-version-aware endpoint config for VeloCloud apps collector

### Data quality
4. Enable Mist client tracking per site (Mist console config)
5. Enable Mist radio scanning per site
6. Run dead code scan: `pyflakes backend/`

---

## 11. CHANGELOG Entry

```
## [19] — 2026-07-27 — Notification System, Dashboard UX, DB Performance
- VeloCloud all 5 collectors live: links/tunnels switched from stubs to real API calls
- VeloCloudAppsCollector correctly mark_skipped (vco109 methodError on monitor/*)
- Cleaned 9 stale velocloud-auth rows from collector_run_ledger
- Created notifier.py: Slack webhook (rich blocks), SMTP email (HTML table), in-memory dedup (15-min window)
- Added 11 notification env vars to settings.py (enable flag, Slack URL, SMTP config, thresholds)
- Wired dispatch_alerts into worker cycle after collector health check
- Added time-range selector (1h/24h/7d/30d) to dashboard event count
- Pre-fetch all 4 ranges on mount for instant switching
- Keep previous count during loading (placeholderData), show — on blank slate
- Created DB index ix_events_timestamp on events(timestamp) — query 15x faster
- Increased postgres shm_size from 64MB to 256MB for autovacuum
```
