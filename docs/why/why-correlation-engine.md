# Why the Correlation Engine is Naxis's Next Priority

## The Honest Diagnosis

The Naxis platform today is a **CRUD application dressed as an intelligence platform**. It collects normalized telemetry from Mist, VeloCloud SD-WAN, DNAC, and Arista WLC — tens of thousands of events per day — and presents them as flat lists with severity badges and filter dropdowns. The platform has:

- **Mist collector**: Pulls alarms + events from the Mist API → normalized `UnifiedEvent` objects
- **VeloCloud SD-WAN collector**: Pulls edges, links, tunnels, events → normalized `UnifiedEvent` objects
- **DNAC collector**: Pulls device inventory, alarms, topology, client health → normalized `UnifiedEvent` objects
- **Events API + UI**: A sorted, filterable list of raw events
- **Incident model**: A schema with blast radius fields, confidence scoring, lifecycle status
- **Correlation engine code**: A deterministic rule engine (`backend/shared/correlation/engine.py`) that groups events by site + time window, applies topology cascade (Stage 2), and produces `Incident` objects — **wired into the production pipeline as of Session 15**

**The gap**: Raw telemetry is not intelligence. A NOC engineer staring at a list of 500 Mist events cannot answer the four questions that define operational intelligence:

1. What is broken right now?
2. What is the blast radius?
3. What is the most likely cause?
4. What changed that I should investigate?

Without correlation, the platform is no different from Splunk, PagerDuty, or any other NMS — except with fewer features.

---

## Why Correlation — Not More Collectors, Not Better UI, Not AI

### 1. Collectors Already Produce the Data

| Collector | Status | Events Produced |
|-----------|--------|-----------------|
| Mist events | ✅ Active | Alarms, AP down, client disconnects, RF degradation |
| Mist inventory | ✅ Active | AP lifecycle, firmware, reachability |
| Mist topology | ✅ Active | AP history, RF, client topology, wired uplinks, radio neighbors |
| VeloCloud SD-WAN | ✅ Active (credentials set) | Edge inventory, link metrics, tunnels, events, app visibility |
| DNAC | ❌ Not configured | Network devices, alarms, topology, client health, interfaces |
| Arista WLC | ❌ Not configured | Clients, APs, radios, events |

**Two vendors are already feeding real data.** DNAC and Arista WLC are configured but disabled. The raw pipeline works. The missing step is **turning events into operational stories**.

### 2. The Current Frontend Proves the Gap Exists

The correlation page at `/correlation` (`frontend/src/app/correlation/page.tsx`) **re-implements correlation on the client side**: it fetches all 5000 events, groups them by device in JavaScript, computes severity stats, and shows cards. This works but doesn't persist — refresh the page and it's gone. There's no incident lifecycle, no status tracking, no confidence scoring, no link between events and the incidents they belong to.

The `CorrelationEngine` backend already does this better (with configurable time windows, severity thresholds, confidence formulas, deduplication) — it just isn't called.

### 3. The Whitepaper's Five-Stage Roadmap

From `docs/NAXIS_WHITEPAPER.md`:

| Stage | What It Does | Impact |
|-------|-------------|--------|
| **Stage 1** (exists, unwired) | Group events by site + time window (5 min) | 50 raw events → 3-5 incidents |
| **Stage 2** (next) | Group by shared infrastructure (uplink, controller) | Cross-domain incidents (WAN + wireless together) |
| **Stage 3** | Path-aware: detect upstream, suppress downstream | 1 incident instead of N for WAN failures |
| **Stage 4** | Live blast radius computation | "3 sites, 12 devices, 42 clients affected" |
| **Stage 5** | Deterministic RCA with scored hypotheses | "82% confident: MPLS BGP flap on edge-sfo-01" |

**Stage 1 alone transforms the product.** It takes the same events and turns them into structured incidents with titles like *"Site SFO-01 — connectivity issues affecting 3 devices"*, confidence scores, and blast radius. This is the minimum viable step to stop being a dashboard.

### 4. Without Correlation, Every Future Feature Is Built on Sand

- **Topology visualization** — what's the point without knowing what's broken?
- **RCA / probable cause** — can't explain a problem you haven't grouped
- **Timeline / narrative** — can't write the story if you haven't identified the characters
- **Incident workspace** — the flagship screen in the whitepaper has no data to show
- **AI enrichment** — Claude API integration in v2+ needs correlated incidents to enrich

The correlation engine is the **keystone**. It's the intermediate output that every downstream feature depends on.

---

## How the Correlation Engine Works

### Architecture

```
Collectors (Mist, VeloCloud, DNAC, Arista WLC)
    │
    ▼
UnifiedEvent (normalized, vendor-agnostic)
    │
    ▼
CorrelationEngine.process_events()
    │
    ├── Filter by severity threshold (≥ MAJOR default)
    ├── Group by site_id + time window (5 min default)
    ├── Apply rules (min event count, single-critical flag)
    ├── Generate incident title (template: "{Site} — {Category} affecting {N} devices")
    ├── Compute blast radius (affected sites/devices/clients)
    └── Calculate confidence score (event count × severity × device diversity)
    │
    ▼
Incident (with incident_id, severity, status, confidence, blast radius)
    │
    ▼
Persist to PostgreSQL → Link events to incident → Publish via Redis
```

### What Gets Correlated

| Dimension | Current (Stage 1) | Future (Stage 2+) |
|-----------|-------------------|-------------------|
| **Spatial** | Events at the same site_id within 5 minutes | Events on devices sharing an uplink/controller |
| **Temporal** | Configurable time window (default 300s) | Causal precedence (trigger → symptom) |
| **Severity** | Only MAJOR+ events trigger correlation | Domain-weighted severity |
| **Domain** | All domains grouped together | Domain-aware: WAN vs Wireless separated unless causal link |
| **Cross-vendor** | Mist + VeloCloud events at same site → one incident | Topology-aware: Mist AP downstream of VeloCloud edge |

### Confidence Score Formula

```
confidence = (event_score × 0.4) + (avg_severity × 0.4) + (device_diversity × 0.2)
```

Where:
- `event_score` = log-scaled event count (more events = higher confidence)
- `avg_severity` = weighted average of event severities (CRITICAL=1.0, MAJOR=0.7, ...)
- `device_diversity` = unique devices normalized by 5 (more devices involved = higher confidence)

---

## Benefits of Wiring It Now

### 1. The Product Stops Being a Dashboard

Today: "Here are 200 events, good luck."
With correlation: "Here are 3 active incidents. Site SFO-01 has a connectivity issue affecting 3 devices with 82% confidence."

### 2. The Incident Model Comes to Life

The `Incident` Pydantic model at `backend/shared/models/incident.py` already has:
- Severity lifecycle (open → investigating → mitigated → resolved → closed)
- Blast radius tracking (affected_sites, affected_devices, affected_clients)
- Confidence scoring
- Event attachment with deduplication
- Terminal status enforcement

All of this is **dead code** without the correlation engine producing real incidents.

### 3. The Frontend Correlation Page Gets Real Data

Currently the `/correlation` page:
- Fetches all events client-side and groups them in JavaScript
- Shows device-centric cards (per-device grouping)
- Has no persistence (refresh = data gone)

After wiring:
- The page fetches incidents from `GET /incidents` API
- Shows server-generated incidents with proper titles, confidence, blast radius
- Incidents persist across sessions
- Events are linked to their parent incident (click through)

### 4. Cross-Vendor Correlation Starts Working

The `CorrelationEngine.group_events_by_site_and_time()` groups by `site_id`. If Mist reports an AP failure at `site-sfo-01` and VeloCloud reports a link loss at `site-sfo-01` within 5 minutes, **they become one incident**. This is the core value proposition of Naxis — stitching together signals from different vendor consoles — working for the first time.

### 5. The Redis Pub/Sub Pipeline Activates

The `redis.publish_incident()` method exists but has nothing to publish. Once incidents are created, the Redis channel `naxis:incidents` receives real-time updates, enabling:
- Live incident counter on the sidebar
- Real-time push to the Operations Overview
- SSE endpoint for live-updating incident pages

### 6. The Incident API Starts Returning Data

The API at `GET /incidents` (`backend/api/routes/incidents.py`) has three endpoints:
- `GET /incidents` — list with severity/status filters
- `GET /incidents/active` — active (open/investigating/mitigated)
- `GET /incidents/{id}` — detail with blast radius

Today these return empty arrays. With correlation wired, they return real data.

---

## What Data Is Correlated Now

**Only Mist events are actively feeding the pipeline** (MIST_ENABLED=true in `.env`).

**VeloCloud SD-WAN** credentials are configured (VELOCLOUD_ENABLED=true) and the collector code exists, but it primarily fetches inventory/metrics — event data is produced by `velocloud_events.py` sub-collector.

**DNAC and Arista WLC** are disabled (no credentials in `.env`).

The correlation engine accepts `UnifiedEvent` objects **from any source**. When VeloCloud events are flowing, they will automatically be correlated with Mist events at the same sites. This is the key reason to wire the engine now — it immediately starts delivering value from Mist data, and the moment other collectors come online, they participate in correlation at zero additional cost.

---

## Implementation Plan

### Phase 1: Wire Correlation into WorkerDaemon (Today)
- Import `CorrelationEngine` and incident persistence into `backend/worker/main.py`
- After `insert_events()`, call `engine.process_events(all_events)`
- Persist resulting incidents via `upsert_incident()`
- Link events to incidents via `link_events_to_incident()`
- Publish incidents to Redis
- Write comprehensive tests

### Phase 2: Frontend Integration (Today)
- Update `/correlation` page to fetch real incidents from API
- Show incident cards with severity, confidence, blast radius
- Add incident detail drill-down (using existing `incidents/[id]/page.tsx`)
- Show correlation stats (total incidents, by severity, by source)

### Phase 3: Polish (Next)
- Add real-time SSE endpoint for live incident updates
- Add incident status transitions (acknowledge, resolve, suppress)
- Add per-incident event timeline showing correlated events

---

## Summary

The correlation engine is the **single highest-leverage change** in the codebase today. It transforms raw telemetry into operational intelligence with zero new collectors, zero new API endpoints, and zero new infrastructure. The engine code is written, tested in the mock pipeline, and production-ready. The only thing missing is `engine.process_events()` being called in the right place.

**After this change, Naxis goes from "a dashboard that shows you events" to "a platform that tells you what's broken, what's affected, and how confident it is."** That is the difference between a CRUD app and an intelligence platform.
