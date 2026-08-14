# Telemetry Upgrade — Architecture Documentation

> **Version:** 1.3 · **Date:** August 14, 2026 · **Status:** Live (Phases 1–15 complete + WP-0–WP-2 delivered)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Was Before](#2-what-was-before)
3. [What Changed and Why](#3-what-changed-and-why)
4. [Architecture Deep Dive](#4-architecture-deep-dive)
5. [Collector Inventory](#5-collector-inventory)
6. [API Endpoints](#6-api-endpoints)
7. [Frontend Changes](#7-frontend-changes)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [Configuration & Environment](#9-configuration--environment)
10. [Advantages of the New Architecture](#10-advantages-of-the-new-architecture)
11. [Future Roadmap & Followups](#11-future-roadmap--followups)
12. [File Reference](#12-file-reference)

---

## 1. Executive Summary

This document describes the complete architectural upgrade of the Naxis Network Resilient Platform from a **static, in-memory integration model** to a **live, telemetry-driven collector architecture**. The upgrade makes every collector return structured outcomes, persists run history in Postgres, exposes live health via API, and renders per-collector status on the Integrations page.

**Core principle:** The UI never trusts static labels — every status, health score, and freshness indicator is derived from the live `collector_run_ledger` Postgres table.

---

## 2. What Was Before

### 2.1 The Problem

Before this upgrade, the Naxis platform had several critical gaps that prevented it from being a real operational intelligence tool:

| Area | Before | Impact |
|------|--------|--------|
| **Collector output** | Collectors did side effects (printing, writing to files) but returned nothing structured | No way to know if a collector succeeded, failed, or how many events it produced |
| **Worker pipeline** | `run_worker.py` used a `MockTelemetryPipeline` that generated fake data | The live worker was indistinguishable from a demo — operators couldn't trust the data |
| **Integration status** | `IntegrationService` had an in-memory `IntegrationRuntimeState` dataclass that was reset on every API restart | Status, health scores, and last-sync timestamps were lost on every restart |
| **Collector visibility** | No concept of individual collectors within an integration | The UI showed "Juniper Mist: Connected" but couldn't tell you if the events collector was working while the inventory collector was down |
| **Freshness tracking** | No timestamps for when data was last collected | Operators had no way to know if data was 2 minutes old or 2 hours old |
| **Alerting** | No staleness detection, no failure counting, no data gap detection | A collector could fail silently for days with no notification |
| **DNAC** | Only a mock generator existed (`DNACMockGenerator`) — no real DNAC API integration | Cisco DNA Center was marked "coming soon" with no actual collector |

### 2.2 The Old Data Flow

```
MockTelemetryPipeline  →  UnifiedEvent[]  →  Postgres (events table)
                                              ↑
                         Worker loop           │ No ledger, no heartbeat,
                         (sleep 60s)          │ no structured outcome
                                              │
                         IntegrationService    │ In-memory state,
                         (reset on restart) ←─┘ lost on crash
```

### 2.3 What the Integrations Page Showed

The old page had:
- A static list of 4 integrations (Mist, DNAC, VeloCloud, Arista WLC)
- DNAC, VeloCloud, and Arista marked "Coming soon"
- A single status badge per integration (connected/disconnected/not_configured)
- A "Configure" button that showed masked credentials
- A "Test" button that toggled between connected/disconnected with a fake delay
- **No visibility into individual collectors**

---

## 3. What Changed and Why

### 3.1 The Upgrade Plan (8 Phases)

The upgrade was executed in phases, each building on the previous:

| Phase | What | Why | Status |
|-------|------|-----|--------|
| 1 | `CollectorOutcome` model | Every collector must return a structured result, not just do side effects | ✅ Done |
| 2 | Mist collectors return `CollectorOutcome` | Prove the contract works with the existing Mist collector | ✅ Done |
| 3 | WorkerDaemon records heartbeats + collector runs | The telemetry ledger is the single source of truth for collector health | ✅ Done |
| 4 | `/telemetry` API endpoint + alerts | Expose live health to the UI, generate staleness/failure alerts | ✅ Done |
| 5 | IntegrationService derived from ledger | Replace in-memory state with live Postgres queries | ✅ Done |
| 6 | Expandable collector sections on Integrations page | Show per-collector status, health, and what each collects | ✅ Done |
| 7 | DNAC collector (5 sub-collectors) | First real multi-sub-collector vendor integration | ✅ Done |
| 8 | Mist topology collectors | Complete wireless telemetry coverage | ✅ Done (5 sub-collectors) |
| 9 | VeloCloud + Arista collectors | Vendor-agnostic collector contract for all vendors | ✅ Done (5 + 4 sub-collectors) |
| 10 | Staleness alerts UI | Visual alerts on the frontend for degraded collectors | ✅ Done (alert-banner.tsx + dismiss) |
| 11 | Pipeline wiring (SNMP, health_snapshot) | Wire existing but unused collectors into worker | ✅ Done |
| 12 | Collector health monitoring | Failure/skip pattern detection on collector_run_ledger | ✅ Done |
| 13 | Data retention cleanup | Purge >7d data from telemetry tables | ✅ Done |
| 14 | Frontend UX (cascade, dismiss, shortcuts) | Improve topology and incident detail usability | ✅ Done |
| 15 | Dashboard event count fix | Show last-24h data instead of lifetime total | ✅ Done |

### 3.2 Why Each Change Was Made

#### CollectorOutcome (Phase 1)

**Before:** Collectors returned `None` or bare lists. The worker had no idea if a collector succeeded.

**After:** Every collector returns a `CollectorOutcome` with:
- `collector_id` (e.g., `mist-events`, `dnac-devices`)
- `status` (`success` / `error` / `skipped`)
- `started_at` / `finished_at` timestamps
- `events` (normalized `UnifiedEvent` objects)
- `rows_written` count
- `error_text` on failure
- `metadata` for collector-specific data

**Why:** This makes every collector observable. The worker can record each run independently, and the UI can show per-collector health.

#### Worker Heartbeat (Phase 3)

**Before:** The worker ran in a loop with no liveness signal. If it crashed, nobody knew until data stopped appearing.

**After:** Every cycle writes a row to `worker_heartbeat` with:
- `worker_id` (unique per process instance)
- `heartbeat_at` timestamp
- `cycle_status` (`success` / `error`)
- `message` (e.g., "7 collectors, 142 events, 1 failed")

**Why:** The UI can show "Worker alive — last heartbeat 12s ago" vs "Worker stale — last heartbeat 5m ago".

#### Telemetry Ledger (Phase 3-5)

**Before:** No persistent record of collector runs. Status was held in a Python dataclass that reset on restart.

**After:** Every collector run writes to `collector_run_ledger` in Postgres:
```sql
CREATE TABLE collector_run_ledger (
    run_id          BIGSERIAL PRIMARY KEY,
    collector_id    TEXT        NOT NULL,  -- e.g. "mist-events"
    source_system   TEXT        NOT NULL,  -- e.g. "mist"
    started_at      TIMESTAMPTZ NOT NULL,
    finished_at     TIMESTAMPTZ,
    status          TEXT        NOT NULL,  -- success/error/skipped
    duration_ms     INTEGER,
    rows_written    INTEGER     NOT NULL DEFAULT 0,
    error_text      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Why:** The ledger is the single source of truth. It survives restarts, can be queried historically, and enables:
- Freshness calculation (how old is the newest data?)
- Failure counting (how many consecutive errors?)
- Health scoring (derived from age + failures + status)

#### IntegrationService from Ledger (Phase 5)

**Before:** `IntegrationRuntimeState` was a Python dataclass with fields like `status`, `last_sync`, `health_score`. It was reset every time the API restarted.

**After:** `IntegrationService` queries `list_collector_telemetry()` on every request and derives status, health, and collector summaries from the live ledger data.

**Why:** The API never returns stale data. If a collector fails at 2:00 AM and the operator checks the dashboard at 2:05 AM, they see the failure immediately.

#### Expandable Collector Sections (Phase 6)

**Before:** The Integrations page showed one status badge per integration. Individual collectors were invisible.

**After:** Each integration card has a "Collectors" button that expands to show:
- Per-collector status (active/working/inactive/not_configured)
- Health score per collector
- Last sync time per collector
- What each collector collects (chip tags)
- Error messages for failing collectors

**Why:** Operators need to know *which* collector is broken, not just that "Mist is having issues."

#### DNAC Collector (Phase 7)

**Before:** DNAC only had a mock generator. No real API calls were made.

**After:** 5 real sub-collectors that call the DNAC Intent API:
- `dnac-devices` — Network device inventory
- `dnac-alarms` — Assurance events/alarms
- `dnac-topology` — Physical + L3 topology graph
- `dnac-clients` — Client health overview
- `dnac-interfaces` — Per-device interface status

**Why:** DNAC is the primary wired infrastructure management platform. Without real collectors, the platform can't provide wired topology or assurance events.

---

## 4. Architecture Deep Dive

### 4.1 The CollectorOutcome Contract

Every collector in the system follows the same contract:

```python
class CollectorOutcome:
    collector_id: str          # Unique ID, e.g. "mist-events"
    source_system: str         # Vendor slug, e.g. "mist"
    status: str                # "success" | "error" | "skipped"
    started_at: datetime       # UTC when collection began
    finished_at: datetime      # UTC when collection ended
    events: List[UnifiedEvent] # Normalized events
    rows_written: int          # Events actually persisted
    error_text: str            # Error message if failed
    metadata: dict             # Collector-specific extra data
```

**Key methods:**
- `mark_success(rows_written)` — Sets status to success, records count, sets finished_at
- `mark_error(error_text)` — Sets status to error, records message, sets finished_at
- `mark_skipped(reason)` — Sets status to skipped (for disabled/unconfigured collectors)
- `duration_ms` — Computed property, wall-clock time in milliseconds
- `event_count` — Computed property, `len(self.events)`

### 4.2 Worker Daemon Pipeline

The `WorkerDaemon` in `backend/worker/main.py` orchestrates the full pipeline:

```
┌──────────────────────────────────────────────────────────────────┐
│                    WorkerDaemon.run_once()                        │
│                                                                   │
│  1. Run all collectors → List[CollectorOutcome]                   │
│     ├── MistCollector.collect()          → 7 mist sub-collectors  │
│     ├── DNACCollector.collect_all()      → 5 dnac sub-collectors  │
│     ├── VeloCloudCollector.collect_all() → 5 vc sub-collectors    │
│     ├── AristaWlcCollector.collect_all() → 4 awlc sub-collectors  │
│     ├── SnmpPoller.collect()             → SNMP targets           │
│     └── collect_health_snapshots()       → node health data       │
│                                                                   │
│  2. Record each outcome in collector_run_ledger                   │
│  3. Write worker heartbeat to worker_heartbeat table              │
│  4. Persist all UnifiedEvent objects to Postgres                  │
│  5. Run correlation engine → incidents (Stage 1 + Stage 2)        │
│  6. Publish incidents to Redis pub/sub → SSE stream to UI         │
│  7. Sync topology graph (Mist + VeloCloud + DNAC)                 │
│  8. Collector health monitoring (failure/skip pattern detection)  │
│  9. Data retention cleanup (purge >7d telemetry data)             │
│                                                                   │
│ 10. Sleep for collector_interval seconds                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Telemetry Query Pipeline

The `list_collector_telemetry()` function in `collector_telemetry.py` uses a CTE-based SQL query to compute:

1. **Latest run** per collector (DISTINCT ON collector_id, ordered by started_at DESC)
2. **Last successful run** per collector (WHERE status = 'success')
3. **Total failure count** per collector (COUNT WHERE status = 'error')

These are joined to produce a rich telemetry record per collector:
```json
{
    "collector_id": "mist-events",
    "source_system": "mist",
    "last_run": "2026-07-05T10:30:00Z",
    "last_success": "2026-07-05T10:30:00Z",
    "last_error": null,
    "last_status": "success",
    "failure_count": 0,
    "current_age_seconds": 45,
    "duration_ms": 1200,
    "rows_written": 23
}
```

### 4.4 Status Derivation Rules

The integration service derives runtime status from telemetry data using these rules:

| Condition | Integration Status | Operational Status |
|-----------|-------------------|-------------------|
| No entries + not configured | `not_configured` | `not_configured` |
| No entries + configured | `not_configured` | `not_configured` |
| All entries success, age < 5min | `connected` | `active` |
| All entries success, age > 5min | `connected` | `working` |
| Some entries error, some success | `connected` | varies per collector |
| All entries error | `error` | `inactive` |
| All entries stale (> 15min) | `error` | `inactive` |
| Entry skipped (disabled) | `not_configured` | `inactive` |
| Entry error + ≥ 3 failures | `error` | `inactive` |

**Freshness thresholds:**
- **5 minutes (300s):** Collector transitions from `active` → `working`
- **15 minutes (900s):** Collector transitions to `stale` / `inactive`
- **3+ consecutive failures:** Collector transitions to `error` / `inactive`

### 4.6 Collector Health Monitoring

The `collector_health.py` module runs inside `WorkerDaemon.run_once()` after collection and ledger recording. It queries `collector_run_ledger` for:

| Pattern | Detection | Action |
|---------|-----------|--------|
| **Repeated failures** | 3+ consecutive errors for same collector | Logs `CRITICAL` alert |
| **Skip storms** | 5+ skips in last 10 runs | Logs `WARNING` alert |
| **Recovery after failure** | Success after 2+ failures | Logs `INFO` recovery notification |

These are logged via the standard Python logger, not persisted to any table — designed for integration with external monitoring (e.g., Datadog, PagerDuty).

### 4.5 Alert Generation

The `/telemetry` endpoint generates three types of alerts:

1. **Repeated failures:** `failure_count >= 3` and `last_status == "error"`
   - Severity: `warning` (3-5 failures) or `critical` (6+ failures)

2. **Stale data:** `current_age_seconds > threshold`
   - Severity: `warning` (> 5min) or `critical` (> 15min)

3. **Data gaps:** Last run was error but there were previous successes, and age > 5min
   - Severity: `warning`

---

## 5. Collector Inventory

### 5.1 Juniper Mist Collectors (7 sub-collectors)

| Collector ID | What It Collects | API Endpoint | Status |
|-------------|-----------------|--------------|--------|
| `mist-events` | Alarms, audit logs, event payloads, severity, device/site context | `/api/v1/orgs/{org_id}/alarms/search`, `/api/v1/orgs/{org_id}/logs` | ✅ Live |
| `mist-inventory` | AP inventory, site mapping, live AP stats, client counts, uptime, firmware | `/api/v1/sites/{site_id}/stats/devices` | ✅ Live |
| `mist-ap-history` | Firmware changes, site moves, reboots | `/api/v1/sites/{site_id}/stats/devices` (history) | ✅ Live |
| `mist-ap-rf` | Channel, RSSI, utilization, BSSID | `/api/v1/sites/{site_id}/stats/devices` (RF) | ✅ Live |
| `mist-client-topology` | Client MAC, IP, SSID, band, RSSI | `/api/v1/orgs/{org_id}/clients` | ⚠️ 404 on API |
| `mist-wired-uplink` | AP-to-switch physical link graph | `/api/v1/orgs/{org_id}/wired/uplinks` | ⚠️ 404 on API |
| `mist-radio-neighbors` | Interference, co-channel contention | `/api/v1/sites/{site_id}/radio/neighbors` | ✅ Live |

### 5.2 Cisco DNAC Collectors

| Collector ID | What It Collects | API Endpoint | Status |
|-------------|-----------------|--------------|--------|
| `dnac-devices` | Network devices, hostname, management IP, platform, SW version, reachability, serial | `/dna/intent/api/v1/network-device` | ✅ Live |
| `dnac-alarms` | Assurance events, alerts, severity, domain, sub-domain, device context | `/dna/intent/api/v1/event/event-series` | ✅ Live |
| `dnac-topology` | Physical topology nodes/links, L3 topology nodes/links | `/dna/intent/api/v1/topology/physical-topology`, `/dna/intent/api/v1/topology/l3-topology` | ✅ Live |
| `dnac-clients` | Client health overview, poor/fair/good/idle counts, client type breakdown | `/dna/intent/api/v1/client-health` | ✅ Live |
| `dnac-interfaces` | Interface name, status, speed, VLAN, MAC address | `/dna/intent/api/v1/interface/network-device/{id}` | ✅ Live |

**DNAC Authentication:** Token-based via `POST /dna/system/api/v1/auth/token` with Basic auth. Token is obtained once per collection cycle and reused across all sub-collectors.

### 5.3 VeloCloud Collectors (5 sub-collectors)

| Collector ID | What It Collects | Purpose | Status |
|-------------|-----------------|---------|--------|
| `velocloud-edges` | Edge appliance inventory, status, version, WAN link data (interface, ISP, public IP, state, bandwidth) | WAN edge + link inventory | ✅ Registered |
| `velocloud-links` | Link metrics (latency, jitter, packet loss) per edge | WAN link performance | ✅ Registered |
| `velocloud-tunnels` | Tunnel health, encryption status, gateway peers | SD-WAN tunnel visibility | ✅ Registered |
| `velocloud-events` | Enterprise events, alarms from VCO API | Operational events | ✅ Registered |
| `velocloud-apps` | Application visibility, QoS stats per edge | Application performance | ✅ Registered |

**Performance note:** The VeloCloud orchestrator pre-fetches `edge_ids` once per cycle and passes them to all sub-collectors, avoiding N+1 authentication requests. Persistent `httpx.AsyncClient` avoids re-auth overhead (~500ms–2s) per cycle.

### 5.4 Arista WLC Collectors (4 sub-collectors)

| Collector ID | What It Collects | API Endpoint | Status |
|-------------|-----------------|--------------|--------|
| `arista-wlc-clients` | Wireless client inventory, association events, RSSI, band | WLC REST API | ✅ Registered |
| `arista-wlc-aps` | AP inventory, radio status, firmware version, uptime | WLC REST API | ✅ Registered |
| `arista-wlc-radios` | Channel utilization, interference, power levels, noise floor | WLC REST API | ✅ Registered |
| `arista-wlc-events` | Controller events, alarms, syslog messages | WLC REST API (show logging) | ✅ Registered |

**Note:** Arista WLC log timestamps use `MMM DD HH:MM:SS` format (no year). These are parsed with `strptime("%b %d %H:%M:%S")` using the current UTC year.

---

## 6. API Endpoints

### 6.1 Telemetry Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/telemetry` | Live telemetry for all collectors: last run, last success, last error, failure count, current age, derived status. Also returns alerts. |
| `GET` | `/telemetry/alerts` | Only the active alerts (stale collectors, repeated failures, data gaps). |

**Response structure for `/telemetry`:**
```json
{
    "collectors": [
        {
            "collector_id": "mist-events",
            "source_system": "mist",
            "last_run": "2026-07-05T10:30:00Z",
            "last_success": "2026-07-05T10:30:00Z",
            "last_error": null,
            "last_status": "success",
            "failure_count": 0,
            "current_age_seconds": 45,
            "duration_ms": 1200,
            "rows_written": 23,
            "derived_status": "healthy"
        }
    ],
    "alerts": [],
    "summary": {
        "total_collectors": 7,
        "healthy": 6,
        "degraded": 0,
        "stale": 0,
        "error": 0,
        "not_configured": 1,
        "alert_count": 0
    }
}
```

### 6.2 Integration Endpoints (Enhanced)

| Method | Path | Changes |
|--------|------|---------|
| `GET` | `/integrations` | Now returns `collectors[]` array per integration with per-collector status, health, and metadata |
| `GET` | `/integrations/{id}` | Same + config details |
| `POST` | `/integrations/{id}/test` | DNAC now supports live credential testing |
| `POST` | `/integrations/{id}/sync` | DNAC now supports manual sync triggering |

---

## 7. Frontend Changes

### 7.1 CollectorSection Component

**File:** `frontend/src/components/integrations/collector-section.tsx`

A new expandable section that renders under each integration card when the "Collectors" button is clicked. Shows:

- **Header:** "Collector status (X/Y active)" with a count badge
- **Per-collector rows:** Each showing:
  - Status dot (green/yellow/red)
  - Collector label
  - Operational status badge (Active/Working/Inactive/Not configured)
  - Purpose description
  - What it collects (chip tags)
  - Health score (%)
  - Last sync time
  - Error message (if failing)
  - Output description

### 7.2 IntegrationRow Changes

**File:** `frontend/src/components/integrations/integration-row.tsx`

Added:
- `isCollectorsOpen` prop — controls which integration's collectors are expanded
- `onToggleCollectors` prop — toggles the collector section
- New "Collectors" button with `Network` icon and count badge
- Button highlights when the collector section is open

### 7.3 Integration Types

**File:** `frontend/src/types/integration.ts`

Added:
- `CollectorOperationalStatus` type (`active | working | inactive | not_configured`)
- `IntegrationCollectorSummary` interface with fields: `id`, `label`, `status`, `operational_status`, `last_sync`, `health_score`, `message`, `collects[]`, `purpose`, `output`, `why_it_matters`

### 7.4 Integrations Page

**File:** `frontend/src/app/integrations/page.tsx`

Added:
- `expandedCollectorsId` state — tracks which integration's collectors are expanded
- `CollectorSection` rendered between `IntegrationRow` and `IntegrationConfigPanel`
- Each integration card now has three expandable sections: Collectors, Config

### 7.5 Dashboard Collector Health Widget

**File:** `frontend/src/components/dashboard/collector-health-widget.tsx`

A glass-card widget on the main dashboard that surfaces collector pipeline health at a glance:

- **Summary grid:** Four color-coded stat cards (healthy/degraded/error/stale) using the same counts from `GET /telemetry`
- **Inline alerts:** Expandable section rendering up to 3 `AlertBanner` items with a "+N more" overflow link to Integrations
- **Pulsing badge:** Animated red dot + critical count when critical alerts exist
- **All-healthy state:** Green accent badge + "All collectors operating normally" footer
- **States:** Loading skeleton, error with retry button, empty (zero collectors), healthy, has-alerts
- **Polling:** 30s refetch interval via `useQuery` with `api.getTelemetry()`

**File:** `frontend/src/lib/api.ts` — Added `api.getTelemetry()` returning the full `TelemetryResponse` (collectors + alerts + summary).

**File:** `frontend/src/types/integration.ts` — Added `TelemetryCollectorEntry`, `TelemetrySummary`, `TelemetryResponse` interfaces.

---

## 8. Data Flow Diagrams

### 8.1 Collector → Ledger → UI Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MistCollector│     │WorkerDaemon  │     │  Postgres    │     │  API / UI    │
│  .collect()   │────▶│  .run_once() │────▶│  collector_  │────▶│  /integrations│
│               │     │              │     │  run_ledger  │     │  /telemetry   │
│  Returns      │     │  Records     │     │              │     │              │
│  CollectorOutcome│  │  each outcome│     │  Query:      │     │  Derives     │
│               │     │  to ledger   │     │  latest run  │     │  status,     │
└──────────────┘     └──────────────┘     │  per collector│     │  health,     │
                                          └──────────────┘     │  alerts      │
                                                               └──────────────┘
```

### 8.2 DNAC Authentication Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  DNACCollector│     │  DNAC API    │     │  Sub-        │
│  .collect_all()│───▶│  POST /auth/ │───▶│  collectors  │
│               │     │  token       │     │  (5 parallel)│
│  Authenticates│     │              │     │              │
│  once, passes │     │  Returns     │     │  Each returns│
│  token to all │     │  X-Auth-Token│     │  CollectorOutcome│
└──────────────┘     └──────────────┘     └──────────────┘
```

### 8.3 Status Derivation Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Telemetry   │     │  Derivation  │     │  UI Display  │
│  Ledger      │────▶│  Functions   │────▶│              │
│              │     │              │     │              │
│  last_status │     │ _derive_status│    │  Status badge│
│  age_seconds │     │ _compute_health│   │  Health bar  │
│  failure_cnt │     │ _map_op_status│    │  Op status   │
│  rows_written│     │ _build_alerts │    │  Alert banner│
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## 9. Configuration & Environment

### 9.1 DNAC Environment Variables

```bash
# Cisco DNA Center
DNAC_HOST=https://dnac.example.com
DNAC_USERNAME=admin
DNAC_PASSWORD=secret
DNAC_ENABLED=true
DNAC_VERIFY_SSL=true
```

### 9.2 Worker Configuration

```bash
# Worker
COLLECTOR_INTERVAL=60          # Seconds between collection cycles
LOG_LEVEL=INFO
# DB connection is driven by DATABASE_URL; postgres is required for telemetry ledger
```

### 9.3 Freshness Thresholds (Hardcoded)

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `_STALE_THRESHOLD` | 300s (5min) | Collector transitions to "working" / "warning" |
| `_CRITICAL_THRESHOLD` | 900s (15min) | Collector transitions to "stale" / "inactive" |
| `_MAX_FAILURES` | 3 | Consecutive failures before "error" / "inactive" |

---

## 10. Advantages of the New Architecture

### 10.1 Operational Advantages

| Advantage | How It Helps |
|-----------|-------------|
| **Live health visibility** | Operators see real collector status, not static labels. If `dnac-devices` fails at 2 AM, the dashboard shows it by 2:01 AM. |
| **Per-collector granularity** | "Mist is broken" becomes "Mist events collector is active, but Mist inventory collector failed 5 times." |
| **Freshness tracking** | "Data is 3 minutes old" vs "Data is 2 hours old" — operators know exactly how current the view is. |
| **Failure detection** | Repeated failures generate alerts automatically. No more silent collector death. |
| **Data gap detection** | If a collector was working but stopped, the system detects the gap and alerts. |
| **Historical audit trail** | Every collector run is logged. You can answer "when did the DNAC collector last fail?" by querying the ledger. |

### 10.2 Architectural Advantages

| Advantage | How It Helps |
|-----------|-------------|
| **Vendor-agnostic contract** | Every collector (Mist, DNAC, VeloCloud, Arista) returns the same `CollectorOutcome`. Adding a new vendor is mechanical. |
| **Independent collector health** | Each sub-collector is tracked independently. One failing collector doesn't affect others. |
| **Stateless API** | The API derives all state from Postgres. It can restart, scale horizontally, or run multiple instances without losing status. |
| **Observable worker** | Heartbeats + ledger writes mean the worker's health is always visible. |
| **Extensible alerts** | The alert framework can be extended with new rules (e.g., "data volume dropped by 50%") without changing the collector code. |

### 10.3 Business Advantages

| Advantage | How It Helps |
|-----------|-------------|
| **Trust in data** | Operators can see exactly how fresh and reliable the data is before making decisions. |
| **Faster MTTR** | When a collector fails, the operator knows *which* collector, *what* it collects, and *why* it might be failing. |
| **Vendor coverage** | Mist (wireless) and VeloCloud (SD-WAN) are live. DNAC is registered but not configured. Arista WLC code exists but host/password not configured. |
| **Scalability** | New vendors follow the same contract — Aruba Central added post-Phase 9 without architectural changes. |

---

## 11. Completed Roadmap & Remaining Followups

### Phase 8: Mist Topology Collectors ✅

5 Mist topology collectors built and wired (`mist-ap-history`, `mist-ap-rf`, `mist-client-topology`, `mist-wired-uplink`, `mist-radio-neighbors`). Two (`client-topology`, `wired-uplink`) return 404 from Mist API — collectors handle gracefully (0 events).

### Phase 9: VeloCloud + Arista WLC Collectors ✅

**VeloCloud:** 5 sub-collectors (edges, links, tunnels, events, apps). Orchestrator pre-fetches `edge_ids` once per cycle. Persistent `httpx.AsyncClient` avoids re-auth overhead.

**Arista WLC:** 4 sub-collectors (clients, APs, radios, events). Timestamps parsed from `MMM DD HH:MM:SS` format (was `datetime.now()` stub).

### Phase 10: Staleness Alerts UI ✅

`AlertBannerGroup` component renders on Integrations page. Per-collector dismiss with `localStorage` persistence. "Dismiss all" button. Critical/warning severity badges.

### Phase 11: Pipeline Wiring ✅

SNMP poller, health snapshot collector wired into worker. Docker healthcheck added to worker service.

### Phase 12: Collector Health Monitoring ✅

`shared/monitoring/collector_health.py` queries `collector_run_ledger` for failure/skip patterns and logs actionable alerts.

### Phase 13: Data Retention ✅

`shared/database/retention.py` cleans `correlation_telemetry`, `collector_run_ledger`, `node_health_snapshots` > 7 days. Wired into worker every 24h.

### Phase 14: Frontend UX ✅

- Per-collector alert dismiss (localStorage)
- Cross-site device jump dropdown in topology
- Keyboard shortcut cheat sheet
- Cascade relationship badge in incident detail
- Export topology as PNG
- Auto fitView on site expand
- SSE incident stream (Redis → frontend)

### Phase 15: Dashboard & Debt ✅

- Event count now last 24h (was lifetime total)
- Vendor fallback fixed (`"mist"` → `""`)
- Arista WLC timestamp parsing (was `datetime.now()` stub)
- 404 page created
- Loading indicator for topology re-layout

### Remaining: OpenTelemetry Integration

**What:** Add OpenTelemetry traces and metrics for request-level and pipeline-level observability.

**Why:** Beyond collector-level health, we need request tracing (API latency, database query times) and pipeline metrics (events/second, correlation throughput).

**How:** Instrument FastAPI middleware, collector methods, and database calls with OpenTelemetry SDK.

**Advantage:** Full observability stack — from collector health to API performance to database latency.

---

## 12. File Reference

### New Files

| File | Purpose |
|------|---------|
| `backend/shared/models/collector_outcome.py` | `CollectorOutcome` dataclass — the universal collector contract |
| `backend/api/routes/telemetry.py` | `/telemetry` and `/telemetry/alerts` API endpoints |
| `backend/worker/collectors/dnac.py` | Cisco DNA Center collector with 5 sub-collectors |
| `backend/worker/collectors/velocloud.py` | VeloCloud SD-WAN collector with 5 sub-collectors |
| `backend/worker/collectors/arista_wlc.py` | Arista WLC collector with 4 sub-collectors |
| `backend/worker/collectors/snmp_poller.py` | SNMP polling collector |
| `backend/worker/collectors/health_snapshot.py` | Device health snapshot collector |
| `backend/shared/monitoring/collector_health.py` | Collector failure/skip pattern detection |
| `backend/shared/database/retention.py` | Data retention cleanup (>7d) |
| `frontend/src/components/integrations/collector-section.tsx` | Expandable per-collector status UI |
| `frontend/src/components/dashboard/collector-health-widget.tsx` | Dashboard glass-card widget |
| `frontend/src/app/not-found.tsx` | 404 page |
| `CHANGELOG.md` | Reverse-chronological session log |

### Modified Files

| File | Changes |
|------|---------|
| `backend/worker/main.py` | WorkerDaemon now records heartbeats and collector runs to ledger; runs DNAC, VeloCloud, Arista WLC, SNMP poller, health_snapshot, collector health monitoring, retention cleanup |
| `backend/main.py` | Telemetry schema ensured on API startup; telemetry router registered |
| `backend/api/services/integration_service.py` | Complete rewrite — derives all status from telemetry ledger; collector definitions for all 21 collectors across 4 vendors |
| `backend/api/routes/correlation.py` | Added SSE endpoint `GET /correlation/incidents/stream` |
| `backend/worker/collectors/velocloud.py` | Persistent `httpx.AsyncClient` avoids re-auth per cycle; `close()` method |
| `backend/worker/collectors/arista_wlc.py` | Timestamp parsing using `strptime("%b %d %H:%M:%S")` instead of `datetime.now()` stub |
| `frontend/src/app/page.tsx` | Event count filter: last 24h instead of lifetime total |
| `frontend/src/app/providers.tsx` | Removed dead `getInitialResolvedTheme()` |
| `frontend/src/app/integrations/page.tsx` | Added `expandedCollectorsId` state; renders `CollectorSection`; alert dismiss |
| `frontend/src/app/correlation/page.tsx` | Added engine health bar |
| `frontend/src/app/incidents/[id]/page.tsx` | Cascade relationship badge |
| `frontend/src/components/integrations/integration-row.tsx` | Added `isCollectorsOpen`/`onToggleCollectors` props; "Collectors" button |
| `frontend/src/components/integrations/alert-banner.tsx` | localStorage dismiss, "Dismiss all" button |
| `frontend/src/components/topology/topology-graph.tsx` | Site dropdown, Export PNG, keyboard shortcuts, device count in search, loading bar |
| `frontend/src/components/topology/layout.ts` | Vendor fallback `"mist"` → `""` |
| `frontend/src/types/integration.ts` | Added `TelemetryAlert`, `TelemetryCollectorEntry`, `TelemetrySummary`, `TelemetryResponse` |
| `frontend/src/lib/api.ts` | Added `getTelemetry()`, `getCorrelationStats()`, `listTelemetryAlerts()` |
| `docker-compose.yml` | Worker healthcheck added |

### Database Tables

| Table | Purpose |
|-------|---------|
| `collector_run_ledger` | Persistent record of every collector run (collector_id, status, timing, rows, errors) |
| `worker_heartbeat` | Worker liveness signal (worker_id, heartbeat_at, cycle_status) |
| `correlation_telemetry` | Correlation engine run statistics (events processed, incidents created, duration) |
| `node_health_snapshots` | Device health timeline data (CPU, memory, interface status) |
