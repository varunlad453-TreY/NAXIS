# Naxis: The Operational Reasoning Layer for Enterprise Networks

## A White Paper on Architecture, Product Direction, and the 90-Day Path to Operational Intelligence

---

**Document Type:** Strategic White Paper & Definitive Blueprint
**Version:** 1.0
**Date:** May 2026
**Status:** Internal — Founding Team Review
**Audience:** Engineering Leadership, Product Strategy, Founding Team

---

## Abstract

This white paper presents the definitive architectural and product blueprint for Naxis, an emerging Network Operations Intelligence Platform. It is the product of a critical review across four perspectives — Principal Architect, Product Strategist, Enterprise Platform Designer, and Network Operations Domain Expert — and is intended to guide the next 6–12 months of development.

The central thesis is simple and uncomfortable: **the platform, as it exists today, is a CRUD application dressed as an intelligence platform.** The gap between the current implementation and the stated vision cannot be closed by adding endpoints, refining the UI, or invoking AI. It can only be closed by earning the right to claim operational intelligence — by ensuring every screen, every endpoint, and every incident teaches the operator something they did not already know.

This paper is not a feature list. It is a strategic frame, an architectural commitment, and a sequenced execution plan.

---

## Table of Contents

0. The Honest Diagnosis
1. Final Product Vision
2. Product Positioning
3. System Architecture
4. Module Architecture
5. PostgreSQL Data Model Blueprint
6. Infrastructure Model
7. Correlation Engine Roadmap
8. Timeline Strategy
9. RCA Strategy
10. Topology Strategy
11. Frontend Experience Blueprint
12. Incident Workspace Blueprint
13. Operations Overview Blueprint
14. Infrastructure Explorer Blueprint
15. 90-Day Roadmap
16. Risks
17. Architectural Tradeoffs
18. Features To Remove
19. Features To Delay
20. Features To Prioritize
21. Critical Reflection: Weaknesses, Wrong Assumptions, and Differentiation
22. Closing Recommendation
23. API Integration Strategy (SD-WAN, Cisco DNAC, Wireless)

---

## 0. The Honest Diagnosis

Before presenting the deliverables, the truth must be stated plainly.

**The Naxis platform is currently a CRUD application dressed as an intelligence platform.**

The system has an incident model, a list view, a detail view, and a correlation engine that groups events by site and time. That is not operational intelligence — that is **alert grouping with extra fields**. Splunk did this in 2008. PagerDuty does this. Every Network Management System does this.

The gap between what exists today and what the vision document describes is enormous, and it cannot be closed by:

- Adding more endpoints
- Making the UI darker
- Adding a "timeline" tab
- Sprinkling "AI" anywhere in the architecture

It can only be closed by **earning the right to claim operational intelligence**. That right comes from one thing:

> **The platform must explain something the operator did not already know.**

If a senior NOC engineer opens an incident page and learns nothing they could not have inferred from the raw alerts in 30 seconds, the platform has failed — regardless of how the UI looks.

This standard must be held against every feature decision in this blueprint.

---

## 1. Final Product Vision

**Naxis is the operational reasoning layer for enterprise networks.**

It is not monitoring. It is not observability. It is not alerting. It is a layer that sits *above* existing telemetry sources and answers four questions, in increasing depth:

1. **What is broken right now?** — state
2. **What is the blast radius?** — scope
3. **What is the most likely cause?** — reasoning
4. **What changed that I should investigate?** — causality

The product wins when an operator opens an incident and within 10 seconds knows where to click next. The product loses the moment they have to open a second tool to validate what Naxis told them.

### The One-Sentence Vision

> *"Naxis turns thousands of vendor-specific events into a small number of well-reasoned operational stories."*

---

## 2. Product Positioning

### The Category Problem

The current vision document correctly defines what Naxis is *not* — but the market does not have a clean slot for what Naxis *is*. Without deliberate framing, Naxis will be miscategorized as "yet another NMS" or "AIOps lite," and will lose budget conversations on that basis alone.

### The Positioning Frame

| Dimension | Position |
|---|---|
| **Category Name** | Network Operations Intelligence Platform (NOIP) — own the term |
| **Primary Buyer** | NOC Lead / Director of Network Engineering |
| **Primary User** | Tier 2/3 Network Engineer during incidents |
| **Adjacent Tools (sit beside, not replace)** | DNAC, Mist, vManage, ThousandEyes, ServiceNow, Splunk |
| **What Naxis Replaces** | The mental work of stitching those tools together during incidents |
| **One-Line Pitch** | "Stop swivel-chairing between five vendor consoles to figure out what just broke." |

### Why This Matters

If leadership perceives Naxis as "another dashboard," it dies in budget review. If they perceive it as **the place to start every investigation**, it becomes critical infrastructure. The Incident Workspace must be designed to be the literal first browser tab a NOC engineer opens at the start of their shift.

---

## 3. System Architecture

### Logical Layers — Deliberately Small

```
┌─────────────────────────────────────────────────────────────────┐
│                    Experience Layer (Next.js)                    │
│  Operations Overview │ Incident Workspace │ Infra Explorer       │
└─────────────────────────────────────────────────────────────────┘
                                │
                          REST + SSE
                                │
┌─────────────────────────────────────────────────────────────────┐
│                  Reasoning API (FastAPI Monolith)                │
│ ┌──────────┬───────────┬─────────────┬──────────┬─────────────┐ │
│ │  Ingest  │ Normalize │ Correlation │   RCA    │ Topology    │ │
│ │ Module   │  Module   │   Engine    │ Engine   │  Service    │ │
│ └──────────┴───────────┴─────────────┴──────────┴─────────────┘ │
│ ┌──────────┬───────────┬─────────────┬──────────┬─────────────┐ │
│ │ Incident │ Timeline  │  Blast      │ Config   │ Notification│ │
│ │ Service  │ Service   │  Radius     │ Service  │  Service    │ │
│ └──────────┴───────────┴─────────────┴──────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                       PostgreSQL 16                              │
│   OLTP tables │ Partitioned event tables │ Materialized views    │
│   ltree for hierarchy │ JSONB for raw payloads │ pg_trgm search  │
│   Full-text search on incident narratives                        │
└─────────────────────────────────────────────────────────────────┘
                                ▲
                                │
┌─────────────────────────────────────────────────────────────────┐
│              Background Workers (single Python process)          │
│  Mock Ingestors │ Correlation Tick │ RCA Tick │ Retention        │
└─────────────────────────────────────────────────────────────────┘
```

### Components Deliberately Rejected

| Rejected | Reason |
|---|---|
| **Redis** | One process, single host, low event rate. PostgreSQL `LISTEN/NOTIFY` plus a queue table covers this for ≥12 months. Adding Redis is +1 dependency for zero current value. |
| **Kafka / Event Bus** | A Postgres outbox plus cron-tick correlator is sufficient for thousands of events per second at this scale. |
| **Celery** | A FastAPI background task runner with APScheduler covers the workload. Celery is over-spec'd. |
| **Microservices** | The team has 1.5 developers. Microservices solve an organizational problem that does not exist here. |
| **Object Store (S3 / MinIO)** | No large blobs in the data model. Skip. |

### One Challenge to a Locked Decision

**The ClickHouse rejection is correct *for now*, but has a known cliff.**

PostgreSQL handles event ingest comfortably to ~10–50 million rows per day with proper partitioning (BRIN indexes, monthly partitions, `pg_partman`). Beyond that, query latency on multi-month timeline scans degrades sharply.

**Decision rule:** Revisit ClickHouse only when (a) production sustains >25 million events per day, *and* (b) timeline queries exceed 2 seconds at p95. This is a tripwire — documented now, not a roadmap commitment.

---

## 4. Module Architecture

The point of a modular monolith is that the *modules* are real — strong internal boundaries, clear contracts — and only the **deployment** is monolithic. A modular monolith without enforced boundaries is simply a monolith with extra steps.

### Module Boundaries

```
backend/
├── ingest/          # vendor-specific adapters → UnifiedEvent
├── events/          # event store, querying, retention
├── topology/        # sites, devices, interfaces, paths, relationships
├── correlation/     # rules engine, incident grouping
├── incidents/       # incident lifecycle, state machine
├── rca/             # root cause reasoning, contributing factors
├── timeline/        # narrative reconstruction
├── blast_radius/    # impact computation
├── api/             # FastAPI routers — orchestration only
└── shared/          # cross-cutting: db, config, logging, types
```

### Module Contract Rules

1. **Modules expose Python interfaces, not tables.** The `incidents` module does not query `events.unified_events` directly. It calls `events.query(...)`.
2. **No circular dependencies.** Topology is foundational; correlation depends on topology; RCA depends on correlation; timeline depends on RCA and events.
3. **The API layer is the only orchestrator.** Cross-module workflows live in `api/`, not inside modules.
4. **Each module owns its tables.** PostgreSQL schema namespacing (`topology.devices`, `incidents.incidents`) makes boundaries visible without microservices.

This discipline is the difference between a codebase that survives a year and one that requires a rewrite.

---

## 5. PostgreSQL Data Model Blueprint

### The Bet

> Graph-shaped relationships fit comfortably in PostgreSQL up to mid-enterprise scale, *if* modeled deliberately.

Neo4j is not required until traversals exceed 4 hops at sub-100ms latency across millions of edges. Naxis will not be there in v1, v2, or likely v3.

### Core Schemas and Entities

```
schema: topology
├── sites
│   id, code, name, region, parent_site_id, hierarchy ltree, lat/lng, criticality
├── devices
│   id, site_id, vendor, model, role, serial, mgmt_ip, status, last_seen
├── interfaces
│   id, device_id, name, type, speed, status, peer_interface_id
├── connections (typed graph edges)
│   id, src_device_id, dst_device_id, src_interface_id, dst_interface_id,
│   connection_type [physical|logical|tunnel|wireless], metadata jsonb
├── wan_paths
│   id, name, transport [mpls|internet|lte|direct], src_site_id, dst_site_id,
│   ordered_hops jsonb, sla_class
├── ap_clusters
│   id, name, controller_device_id, site_id
├── ap_cluster_members (join)
└── service_dependencies
    id, application_name, depends_on_path_id | device_id | site_id, criticality

schema: events
├── unified_events  (PARTITIONED BY RANGE created_at, monthly)
│   id, ts, source, type, severity, category, site_id, device_id,
│   interface_id, client_id, raw jsonb, fingerprint, dedupe_key
├── event_dedup_index (partial unique on fingerprint within window)
└── ingest_outbox  (durable queue for correlation tick)

schema: incidents
├── incidents
│   id, opened_at, resolved_at, severity, status, title,
│   probable_cause_id, confidence, sla_impact, narrative_version
├── incident_events (incident_id ↔ event_id, ordering, role enum)
│   role [trigger|contributing|symptom|consequence]
├── incident_infrastructure (typed: incident_id, infra_type, infra_id, role)
├── incident_state_log
└── incident_narratives (versioned generated narratives)

schema: rca
├── probable_causes
│   id, incident_id, title, description, confidence,
│   reasoning_path jsonb, generated_by [rule|heuristic|llm]
├── contributing_factors
│   id, probable_cause_id, factor_type, evidence_event_ids[], weight
└── rca_rules (declarative, hot-reloadable)
    id, name, conditions jsonb, output_template, weight, enabled
```

### Graph Queries in PostgreSQL — The Patterns That Matter

| Pattern | PostgreSQL Feature |
|---|---|
| Site hierarchy (region > campus > floor > closet) | `ltree` extension. Subtree queries in O(log n). |
| Topology traversal (1–4 hops) | Recursive CTE on `connections`. <50ms with proper indexes. |
| Find all paths between A and B | Recursive CTE with cycle detection. Pre-compute and store in `wan_paths`. |
| "Devices upstream of X" | Recursive CTE walking `connections.src_device_id`. |
| Search incidents by narrative | `pg_trgm` + GIN index. Replaces Elasticsearch at this scale. |
| Time-series scan of events | Partitioned tables + BRIN on `ts`. |
| Recent-event lookup by device | B-tree on `(device_id, ts DESC)`. |

### When the Model Breaks

- **Cross-cluster traversals beyond 5 hops with >10M edges** → consider materialized closure tables
- **Query latency on >100M event rows** → consider ClickHouse for events only; keep topology in PostgreSQL
- **Real-time path failure correlation across thousands of paths** → consider precomputed `path_health` table refreshed by trigger

These are *future* problems. Do not solve them now.

---

## 6. Infrastructure Model

The infrastructure model is **the single most underbuilt piece of the current platform** and the largest source of differentiation potential. A typed, navigable infrastructure model is what separates "alert list" from "operational intelligence."

### Conceptual Model

```
Site (hierarchical)
  └── Device (typed by role)
        └── Interface (typed by role)
              └── Connection (typed: physical/logical/tunnel/wireless)
                    └── Peer Interface → Peer Device

Cross-cutting overlays:
  • WAN Path  = ordered hops across devices and connections
  • AP Cluster = controller + APs grouped logically
  • Service Dependency = app → path/device/site
```

### Device Roles — Controlled Vocabulary

```
WAN_EDGE | CORE_SWITCH | DISTRIBUTION_SWITCH | ACCESS_SWITCH |
WIRELESS_CONTROLLER | ACCESS_POINT | FIREWALL | LOAD_BALANCER |
SDWAN_HUB | SDWAN_SPOKE
```

Roles are essential because **correlation rules and UI rendering both branch on role**. Without typed roles, every rule degenerates into vendor-specific logic.

### Population Strategy

Three viable inventory sources, in priority order:

1. **Vendor APIs** — Pull inventory via DNAC, Mist, vManage on schedule
2. **CSV Import** — For v1, an admin uploads infrastructure CSVs
3. **Inferred from Telemetry** — Auto-create stubs for unknown devices (fallback only — produces dirty data)

**Decision:** v1 = CSV import + scheduled DNAC API pull. Inference is a fallback, not the design.

### Why This Matters Most

Path-aware correlation, blast radius computation, and topology-aware RCA are all **dependent on this model being populated with real-shaped data**. The Infrastructure Model is the prerequisite for every "intelligence" claim in the vision. If this is sparse, the rest is theatre.

---

## 7. Correlation Engine Roadmap

### Honest Assessment of Current State

`same site + time window + severity` is **alert grouping**, not correlation. It will produce noisy, low-value incidents that operators distrust within a week.

### Five Evolution Stages

#### Stage 1: Domain-Aware Correlation (Weeks 2–3)

Group events by **(site, domain, time_window)** where domain ∈ {WAN, Wireless, Switching, Client}. A WAN event and a wireless event in the same site at the same time become **two incidents** unless a known causal link exists.

#### Stage 2: Infrastructure-Aware Correlation (Weeks 4–5)

Group events by **shared infrastructure**, not just shared site:

- Events on devices connected through the same uplink → one incident
- Events on APs sharing the same controller → one incident
- Events on devices upstream/downstream of a failing device → one incident

This requires the topology model. **This is where Naxis stops being a dashboard.**

#### Stage 3: Path-Aware Correlation (Weeks 6–8)

A WAN path failure causes events at every site downstream of it. Today, the system would create N incidents. With path-awareness:

- Detect the upstream failure
- Suppress downstream symptom incidents
- Mark them as `consequence` role and link them to the parent

This is the single most important feature for operator trust.

#### Stage 4: Blast Radius Computation (Weeks 9–10)

For an open incident, compute and continuously update:

- Sites impacted (direct + via dependency)
- Devices impacted
- Clients impacted (when known)
- Applications impacted (via service_dependencies)
- SLA tier impacted (criticality-weighted)

#### Stage 5: Confidence-Based RCA (Weeks 11–14)

Deterministic rule engine with scored hypotheses — not ML, not LLM:

- **Rules** are declarative pattern matchers (`condition → cause + base_confidence`)
- Multiple rules may fire; engine emits **ranked hypotheses**, not a single answer
- Confidence is computed from: rule weight × evidence count × topology proximity × temporal precedence
- Operator can mark "this was correct" → reinforces rule weight (lightweight learning loop, no ML)

### Declarative Correlation Rule Format

```yaml
- name: "MPLS uplink degradation cascades to wireless"
  conditions:
    - event_type: HIGH_LATENCY
      domain: WAN
      role: WAN_EDGE
    - within_seconds: 120
      event_type: HIGH_RETRIES
      domain: WIRELESS
      site_path: downstream_of(WAN_EDGE)
  emit:
    incident_role:
      WAN event: trigger
      Wireless event: consequence
    probable_cause:
      title: "MPLS transport degradation"
      base_confidence: 0.75
```

Rules live in PostgreSQL, are loaded on tick, and are versioned. Operators can author rules without redeploying.

### What Should NOT Be Built

- ML-based correlation (insufficient labeled data, brittle, opaque)
- Bayesian network inference (overkill, hard to debug)
- Generic anomaly detection (the platform's job is not to find anomalies — it is to *explain* them)

---

## 8. Timeline Strategy

### The Principle

A timeline is **not** a sorted list of events. A timeline is a **narrative**: noise removed, events grouped, roles assigned, gaps explained.

### The Three-Layer Timeline

```
Layer 1: Raw event timeline (debug view, hidden by default)
   - Every related event in chronological order

Layer 2: Operational timeline (default view)
   - Deduplicated, grouped, categorized
   - Each entry: timestamp, icon, source, title, category, role
   - Roles: trigger | contributing | symptom | recovery

Layer 3: Narrative summary (top of timeline, prose)
   - 2-3 sentences:
     "At 10:01, MPLS latency spiked on edge-sfo-01.
      This degraded wireless retries across mist-west-2 starting at 10:02,
      impacting 42 clients."
   - Generated by templating from RCA + ordered events
   - Optionally LLM-rewritten in v2 (Claude API)
```

### Implementation Approach

- The **operational timeline** is computed at incident view time from `incident_events` (with role) joined to `unified_events`.
- The **narrative summary** is generated post-correlation by a template engine using the triggering event, the probable cause title, the blast radius, and the first symptom event per affected domain.

### Mediocre vs. Premium Timeline

| Mediocre | Premium |
|---|---|
| All events listed | Only narrative-relevant events |
| Generic "alert received" entries | Domain-specific phrasing ("MPLS latency exceeded SLA") |
| Single timestamp column | Ordered with elapsed time deltas ("+2m later…") |
| Same icon for everything | Distinct icons per domain |
| No causal indication | Visual link from trigger → consequence |

The visual style of timeline entries is one of the highest-leverage perception levers in the product.

---

## 9. RCA Strategy

### Move from "Field" to "Explanation"

The current `probable_cause: string` becomes a structured object:

```
ProbableCause {
  title:           short label  ("MPLS Transport Degradation")
  description:     1-3 sentences explaining the hypothesis
  confidence:      0.0–1.0
  reasoning_path:  ordered steps the engine took to reach this
  contributing_factors: [
    { factor, evidence_event_ids, weight }
  ]
  alternative_hypotheses: [...]   // crucial — show ranked alternatives
}
```

### The Principle That Wins Trust

**Show the work.** A confidence score with no reasoning is a number operators learn to ignore. A confidence score with a visible chain of evidence is a number they learn to trust.

The detail page must let an operator click "Why 82%?" and see:

1. Which rules fired
2. Which events provided evidence
3. Which topology relationships were used
4. What ranked alternatives were considered

This is how Naxis differentiates from AIOps tools that present a black-box "AI says…" answer.

### When (and Only When) to Use Claude API

In v2/v3, use Claude API for **post-RCA narrative generation only**:

- **Input:** structured RCA + timeline + topology context
- **Output:** human-readable executive summary
- **Constraint:** the LLM may NEVER change the RCA conclusion — it only rephrases what the deterministic engine already decided

This keeps AI optional, auditable, and replaceable.

---

## 10. Topology Strategy

### The Four Views

1. **Site hierarchy view** — tree, expandable (file-browser style)
2. **Site internal view** — devices in a site, grouped by role, with connection lines
3. **WAN topology view** — sites + WAN paths between them, colored by health
4. **Incident topology view** — overlay an incident's blast radius on the relevant topology

### Rendering Choices

- Do **not** build a generic graph renderer. Use React Flow for site-internal and WAN views, but with **opinionated layouts** — not free-form draggable spaghetti.
- Site hierarchy: a tree view, not a graph
- WAN topology: a force-directed graph constrained by geography (sites laid out by lat/lng)
- Incident overlay: highlight nodes and edges in the blast radius; dim everything else

### What Kills Topology UIs

- Zooming and panning that loses context
- Free-form layouts that move nodes between sessions
- Showing every device at every zoom level (use clustering)
- Treating topology as a "feature" instead of a "context provider"

The topology view should never be the *destination* — it is the **context surrounding an incident**. Users land on it from an incident, see what's affected, and click back.

---

## 11. Frontend Experience Blueprint

### The Four Screens, Redefined

| # | Screen | Purpose | Time-on-Screen Target |
|---|---|---|---|
| 1 | **Operations Overview** | "Is the network okay right now?" | 5–10 seconds |
| 2 | **Incident Workspace** | Investigate a specific incident | 2–10 minutes |
| 3 | **Infrastructure Explorer** | Look up a device/site/path | 30 seconds |
| 4 | **Timeline View** | Cross-incident historical scan | Rare |

**Challenge to assumption:** Timeline View as a top-level destination is questionable. The valuable timeline is *per-incident*. A global timeline is mostly useful for post-incident review and compliance.

**Recommendation:** Demote Timeline from top-nav to a tab inside Operations Overview ("History").

### Design System Principles — Non-Negotiable

1. **Density without clutter** — Linear-class information density, ruthlessly aligned
2. **One color does one thing** — red = critical, amber = degraded, green = healthy. No purples, no teals, no decorative gradients.
3. **Typography is the design** — IBM Plex Sans or Inter, tight tracking, careful hierarchy. shadcn defaults are too generic; tune them.
4. **No charts unless they answer a question** — banish decorative sparklines. Each chart must answer a specific question.
5. **Motion is purposeful** — Framer Motion only for state transitions, never decoration.
6. **Empty states are designed** — "All systems operational" should feel earned, not boring.

---

## 12. Incident Workspace Blueprint

This is the flagship screen.

### Layout (Desktop, 1440px+)

```
┌────────────────────────────────────────────────────────────────────┐
│  [← Back]  Incident Title                  [Status]  [Actions ▾]   │
│  INC-2026-05-29-1005  • opened 18m ago  • 3 sites • 42 clients     │
├──────────────────┬──────────────────────────┬──────────────────────┤
│                  │                          │                      │
│  PROBABLE CAUSE  │   NARRATIVE              │   BLAST RADIUS       │
│  (the headline) │   (2-3 sentence story)   │   (live-updating)    │
│                  │                          │                      │
│  Confidence ring │   TIMELINE               │   Sites: 3           │
│  Title           │   (operational layer,    │   Devices: 12        │
│  Description     │    not raw events)       │   Clients: 42        │
│                  │                          │   Apps: 1            │
│  Reasoning ▾     │   [trigger] event A      │   SLA: HIGH          │
│  Alternatives ▾  │   [contributing] B       │                      │
│                  │   [symptom] C            │   AFFECTED INFRA     │
│                  │   [recovery] (none yet)  │   (typed list)       │
│                  │                          │   • WAN Edge         │
│                  │                          │   • AP Cluster       │
│                  │                          │   • MPLS Path        │
│                  │   [View topology →]      │                      │
│                  │                          │   [Investigate ▾]    │
└──────────────────┴──────────────────────────┴──────────────────────┘
```

### What Makes This a Workspace, Not a Page

- **Live updates** — incident state reflects in real time (SSE or polling)
- **Contextual actions** — Acknowledge, Mark as known, Suppress similar, Export to ServiceNow
- **Investigation breadcrumbs** — every click that leaves this page is captured and surfaced as an investigation trail
- **Comments / notes** — operators can drop text notes on the incident (low-tech, high-value, often skipped)
- **Adjacent incidents** — small panel: "3 similar incidents in the last 30 days"

### The Differentiation Moment

When an operator opens this page during a real incident and the **Probable Cause panel says something they didn't already know** — that is the moment Naxis becomes indispensable. Every architectural decision must serve that moment.

---

## 13. Operations Overview Blueprint

### The 30-Second Principle

A NOC engineer should be able to glance at this screen and answer "is anything broken?" in three seconds, and "what should I look at first?" in ten.

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  Operations              [System Status: All Systems Operational]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  CRITICAL    │  │   MAJOR      │  │    MINOR     │             │
│  │     1        │  │      2       │  │      3       │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                    │
│  ACTIVE INCIDENTS (sorted by priority, not time)                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ [CRITICAL] WAN Degradation — 3 sites, 42 clients   18m ago  │ │
│  │ [MAJOR]    High Retries on APs — 2 sites, 18 clients 31m ago│ │
│  │ ...                                                           │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  HEALTH BY DOMAIN                                                  │
│  ┌──────────┬──────────┬───────────┬──────────────┐               │
│  │  WAN     │ Wireless │ Switching │  Client Exp  │               │
│  │  ⚠ 1     │   ⚠ 1    │     ✓     │      ✓       │               │
│  └──────────┴──────────┴───────────┴──────────────┘               │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### What This Screen Is NOT

- Not 12 charts
- Not metrics tiles (CPU%, memory%, etc.)
- Not "click to drill down" everywhere
- Not a customizable dashboard

This screen has one job. Do not bloat it.

---

## 14. Infrastructure Explorer Blueprint

### The Mental Model: "Filesystem for the Network"

Operators navigate hierarchically (Region → Site → Device → Interface) with a search bar that jumps to any entity by name or IP.

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  [Search: device name, IP, site code...]                           │
├──────────────────┬─────────────────────────────────────────────────┤
│                  │                                                 │
│  HIERARCHY       │   ENTITY DETAIL                                 │
│  (tree)          │                                                 │
│                  │   edge-sfo-01    [WAN Edge] [Healthy]           │
│  ▾ Americas      │   ────────────────────────────────────────      │
│   ▾ SFO-01       │   Vendor: Cisco       Model: ISR4451            │
│     ▸ Edge       │   Mgmt IP: 10.x.x.x   Last seen: 3s ago         │
│     ▸ Core       │                                                 │
│     ▾ Wireless   │   Connections (7)    Active Incidents (1)       │
│       • AP-001   │   Recent Events (12) Configuration (latest)     │
│       • AP-002   │                                                 │
│  ▸ EMEA          │                                                 │
│  ▸ APAC          │                                                 │
│                  │                                                 │
└──────────────────┴─────────────────────────────────────────────────┘
```

### Why This Matters

When an operator is investigating an incident on AP-002 and wants to see "what else lives on this controller?" — Infrastructure Explorer is the answer. **It is the lookup tool, not the dashboard.**

---

## 15. 90-Day Roadmap

The proposed sequencing in the original initiative ("Operational Intelligence Experience Layer") lists Timeline, RCA, and Infrastructure in the *wrong* order. Topology is the foundation; Timeline and RCA depend on it.

### Corrected Sequencing

```
Phase 0 — Foundation Reset (Weeks 1–2)
├─ Schema migration to PostgreSQL-only model (drop ClickHouse/Neo4j refs)
├─ Module boundary enforcement (PostgreSQL schemas, contract layer)
├─ Drop everything that doesn't fit the new vision
└─ Define controlled vocabularies (device roles, event types, domains)

Phase 1 — Infrastructure Model (Weeks 3–5)
├─ Sites, devices, interfaces, connections schema
├─ CSV import flow + first DNAC adapter
├─ Infrastructure Explorer screen (basic hierarchy + detail)
└─ Smoke test: navigate a 50-site, 500-device dataset

Phase 2 — Topology-Aware Correlation (Weeks 6–8)
├─ Connections → recursive CTE traversal queries
├─ Stage 2 correlation: shared-infrastructure rules
├─ Typed incident_infrastructure linking
├─ Blast radius computation (sites/devices/clients)
└─ Acceptance: incident page shows typed Affected Infrastructure

Phase 3 — Hydrated Timeline + Structured RCA (Weeks 9–11)
├─ incident_events with role assignments
├─ TimelineService (operational layer)
├─ Narrative templating (deterministic, no LLM)
├─ ProbableCause with reasoning_path + alternatives
└─ Acceptance: operator opens incident, reads narrative, finds it accurate

Phase 4 — Path-Aware Correlation (Weeks 12–13)
├─ wan_paths schema + population
├─ Stage 3 correlation: parent/consequence linking
├─ Suppression of downstream symptoms
└─ Acceptance: WAN failure produces ONE incident with N consequences

Phase 5 — Polish + Leadership Demo (Week 14)
├─ Dark theme refinement, motion polish
├─ Narrative quality pass (5 hand-written incidents → templates tuned)
├─ End-to-end demo script
└─ Internal leadership review
```

### Deliberately Not in 90 Days

- AI / Claude API integration — Phase 6+
- Authentication — Phase 6+
- Multi-tenant — much later
- Advanced topology rendering (force-directed) — Phase 7
- Reports / analytics — Phase 8

---

## 16. Risks (Ranked by Severity)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Cannot get realistic data.** Without representative telemetry, the platform demos beautifully and fails in production. | CRITICAL | Partner with one friendly enterprise to mirror real telemetry into a sandbox by week 8. Treat as a hard milestone. |
| 2 | **Correlation rules don't generalize.** Rules tuned for one customer break for another. | HIGH | Make rules *per-tenant* from day one (even without auth). Don't ship hardcoded rules. |
| 3 | **Topology data quality is low.** CSVs are stale; vendor APIs disagree. | HIGH | Build a "topology confidence" score per relationship; surface low-confidence data in the UI. |
| 4 | **Team is too small.** 1 NetEng + 1.5 devs cannot deliver this in 90 days at high quality. | HIGH | Cut scope. Phase 4 (path-aware correlation) is optional for the first leadership demo. |
| 5 | **Leadership reaction is "looks like X tool."** Without strong differentiation, the platform is dismissed. | HIGH | Narrative + reasoning_path features are the differentiation. Invest disproportionately there. |
| 6 | **Postgres scale cliff hits earlier than expected.** | MEDIUM | Set tripwires (event count, query latency) and document the migration path. |
| 7 | **AI temptation creeps in.** Pressure to add LLMs everywhere because competitors do. | MEDIUM | Hold the line. AI is a quality-of-life feature, not a core feature. |
| 8 | **No auth in v1 blocks first customer.** Even friendly customers may require basic SSO. | MEDIUM | Have a 2-week auth implementation plan ready (basic email+password, no SSO). |

---

## 17. Architectural Tradeoffs

| Choice | What You Gain | What You Give Up |
|---|---|---|
| **Modular monolith** | Speed, simplicity, single deploy | Cannot scale modules independently; future split is painful if boundaries weren't real |
| **PostgreSQL only** | One operational system, simple ops | Time-series performance ceiling; no native graph traversal beyond ~5 hops |
| **Polling + SSE (no Kafka)** | Trivial ops | Event throughput ceiling around 5–10K/sec sustained |
| **Deterministic correlation** | Auditable, debuggable, trustworthy | Cannot detect novel patterns; rules require maintenance |
| **No auth in v1** | Faster product iteration | Cannot ship to enterprise customers; security debt accrues |
| **CSV inventory import** | Works day one | Stale data; not viable as long-term primary mechanism |
| **No real-time event bus** | One fewer system | Correlation latency is tick-bound (10–30s, not sub-second) |
| **Single host deployment** | Trivial to deploy | Single point of failure; capacity ceiling |

### The Most Uncomfortable Tradeoff

The team is betting that **deterministic correlation + good UX > AI-based pattern detection + mediocre UX**. This is the right bet for product trust and enterprise adoption, but it will lose individual feature comparisons against AIOps tools. Be prepared to defend the bet with conviction; do not fold mid-cycle when a competitor demos something flashy.

---

## 18. Features To Remove

| Feature | Why |
|---|---|
| Generic "All Incidents" tab | Replace with filters; tab is wasted real estate |
| 10-second polling | Replace with SSE or polling-on-visibility |
| Confidence ring on every incident card | Move to detail page; on cards, use color + numeric only |
| Mock telemetry as a permanent feature | Move to a `--demo-mode` flag; do not ship demo data in production builds |
| `affected_clients_count` shown only in detail | Promote to summary OR remove from detail (consistency) |
| `IncidentQuery` model with 9 filters | YAGNI. Ship 2 filters (severity, status). Add others when users ask. |
| Health check endpoint that only reports the API | Replace with platform-wide health rollup or remove from UI |
| Auto-generated UUID-based incident IDs (`inc-abc123`) | Replace with human-readable IDs (`INC-2026-05-29-1005`) |

---

## 19. Features To Delay

| Feature | When to Revisit |
|---|---|
| Authentication / RBAC | After first paid customer commits |
| Claude API integration | After deterministic RCA is trusted (Phase 6+) |
| Real-time topology animation | After topology is correct (Phase 7) |
| Multi-tenancy | After authentication |
| Reports / analytics | After 6 months of incident history exists |
| Notifications service (email/Slack) | After workspace UX is solid |
| Mobile / responsive | After desktop is excellent |
| Configuration drift detection | Powerful, but a separate product surface; later |
| ML-based anomaly detection | Possibly never. Re-evaluate at 18 months. |

---

## 20. Features To Prioritize

The ten things that, if done well, make Naxis irreplaceable:

1. **Typed infrastructure model with real data** — the foundation
2. **Path-aware correlation** with parent/consequence linking — the moment Naxis stops being a dashboard
3. **Reasoning path on every probable cause** — the trust mechanism
4. **Operational timeline with role-tagged events** — the narrative
5. **Blast radius that updates live** — the operator's "is it spreading?" answer
6. **Investigation trail / breadcrumbs** — the workflow tool
7. **Per-incident topology overlay** — the spatial context
8. **Domain-aware health rollup on Operations Overview** — the 30-second answer
9. **Hot-reloadable correlation rules** — the operability lever
10. **Human-readable incident IDs** — the small detail that screams "we built this for you"

---

## 21. Critical Reflection

### Where the Architecture Is Weak

1. **Topology data freshness is hand-waved.** In week 6, the team will discover that nobody's CSV is up to date and the DNAC adapter pulls 3,000 devices that don't match real life. **Plan a "topology validation" workflow now**, not later.

2. **No event bus means correlation latency is tick-bound.** Fine for v1, but it limits how "live" the platform can feel. Operators will notice if incidents take 30 seconds to materialize. Define the latency budget and design backwards from it.

3. **"Modular monolith" is a discipline, not a deliverable.** Without enforcement (linting, schema separation, code review), it becomes a regular monolith in 4 months. Set up `import-linter` or equivalent in Phase 0.

4. **The frontend has no real-time channel design.** Incident pages must feel alive. Polling at 10s is a code smell operators will feel. SSE plan should be in Phase 2, not Phase 5.

5. **Schema treats events as monolithic.** A monthly-partitioned `unified_events` table with a `raw jsonb` column is fine to ~25M rows/month. Beyond that, columnar storage becomes necessary. Define the tripwire.

6. **No story for configuration data.** Network operations is fundamentally about *what changed*. There is no schema for device configs, change events, or config drift. This gap will surface in user research within months.

7. **No story for synthetic checks.** Real NOCs use synthetic probes (ping, traceroute, app monitors). Without an ingestion path for these, the event picture is incomplete. Plan an adapter pattern in Phase 5+.

### Which Assumptions Are Wrong

1. **"Operational intelligence is the differentiation."** Half-true. The differentiation is **trust through transparency**. Operators have been burned by black-box AIOps. Show the work, every time, and Naxis wins.

2. **"AI is optional."** True today. False in 18 months. Customers will *expect* an AI summary feature. The right framing is not "no AI" — it is "**AI is the icing, deterministic reasoning is the cake.**" Plan for the icing.

3. **"PostgreSQL is enough."** True for inventory and incidents forever. Probably *not* true for events past ~25M/day. Plan the ClickHouse fallback now, even if never executed.

4. **"The Incident Workspace is the flagship."** Mostly true, but the **Operations Overview is the leadership-impression screen**. Leadership opens the homepage, not an incident. Optimize the overview's first impression as if the demo depends on it — because it does.

5. **"Modular monolith is the right architecture."** Right answer. But the team has underestimated how much discipline it requires to keep modules truly modular. Budget review time for it.

6. **"Four screens cover the product."** Probably three. Demote Timeline to a tab on Operations Overview. Each top-level destination must earn its keep.

### What Is Unnecessary

- The notifications service (until v2)
- A separate Reports screen (until v3)
- More than 2 incident filters (until users ask)
- Custom dashboard widgets (forever — opinionated views beat configurable dashboards)
- Anything matching the words "platform" or "engine" without a clear user-visible benefit within 14 days of merging

### What Creates Real Differentiation

In order of importance:

1. **The reasoning panel on every incident.** Show the rules that fired, the topology relationships used, the alternatives considered, the confidence math. This is unique. Competitors hide this.

2. **The operational narrative.** Two well-written sentences that summarize an incident are more valuable than 47 well-formatted alert cards. Most tools cannot do this; the ones that can use LLMs to do it badly. Naxis will do it deterministically and accurately.

3. **The path-aware suppression.** When a WAN edge fails and 12 sites go red, every other tool creates 12 incidents. Naxis creates 1. This is the demo moment that closes deals.

4. **The investigation trail.** No tool tracks how operators investigate. Naxis can. This becomes a "common investigation patterns" feature in v2 that *learns* from operator behavior — without ML, simply by observation.

5. **The premium feel.** Real and undervalued. Linear didn't win on features; it won on craft. Match Linear's craft and the buyer's frame changes from "compare features" to "this team gets it."

### How Naxis Becomes a True Operational Intelligence Platform

By holding one rule above all others:

> **Every screen, every endpoint, every incident must teach the operator something they did not already know.**

If the incident detail page just lists what the alerts already said, the platform is a dashboard. If it explains *why those alerts happened together*, *what they imply*, and *what to look at next*, the platform is an intelligence layer.

Every product decision in the next 90 days reduces to that test.

---

## 22. Closing Recommendation

If the team had one week and one engineer, the right work would not be UI-related. It would be:

1. Populate a realistic topology dataset (50 sites, 500 devices, 1000 connections)
2. Build the recursive-CTE-based "downstream of X" query
3. Author 5 correlation rules that produce parent/consequence incident pairs
4. Hand-write 5 incident narratives that read like a senior engineer's analysis

Then, with that data and those incidents loaded, open the existing UI and ask: *does it now feel like an intelligence platform?*

If yes, the path is UI polish.
If no, the issue was never the UI.

The UI is downstream of the data and the reasoning. **Fix those first.** Everything else follows.

---

## 23. API Integration Strategy (SD-WAN, Cisco DNAC, Wireless)

This section was added after the initial blueprint to reflect a committed product decision: **Naxis will integrate directly with vendor APIs**, not rely solely on CSV imports or syslog forwarding. The integration surface spans three vendor families:

| Domain | Vendor | Estimated Footprint | Integration Path |
|---|---|---|---|
| SD-WAN | Cisco vManage / Catalyst SD-WAN (or Arista EOS-CloudVision, depending on customer) | 100% of SD-WAN scope | Direct REST API |
| Wired / Campus | Cisco DNA Center (DNAC) | 100% of campus switching scope | Intent API |
| Wireless | Juniper Mist | 85% of wireless footprint | Cloud REST + Webhooks |
| Wireless | HPE Aruba Central | 10% of wireless footprint | Cloud REST + Webhooks |
| Wireless | Cisco wireless (Catalyst 9800 / AireOS) | 5% of wireless footprint | **Via DNAC** — no separate integration |

A critical implication: because Cisco wireless flows through DNAC, the integration surface is **three vendor APIs, not four**. This is a meaningful simplification.

### 23.1 Why Direct API Integration Changes the Architecture

The white paper originally treated CSV import as a viable v1 inventory mechanism. With committed API integration, that recommendation is downgraded to *fallback only*. Direct API integration introduces:

- **Authentication and secret management** as a first-class concern
- **Rate limit awareness** as a constant operational consideration
- **Polling cadences** as a per-vendor design decision
- **Schema drift** as an ongoing maintenance burden
- **Vendor outages** as a Naxis availability concern

These are not minor additions. They reshape the operational model of the platform.

### 23.2 The Three Integration Patterns Vendors Expose

Each of the three vendors exposes data in a different shape. The architecture must accommodate all three without leaking vendor concerns into the core.

| Pattern | Used By | Naxis Adapter Behavior |
|---|---|---|
| **Pull / Polling** | DNAC, vManage, Aruba Central (inventory + events), Mist (inventory) | Scheduled adapter ticks at vendor-appropriate intervals |
| **Webhook / Push** | Mist (events), Aruba Central (events) | HTTPS endpoint receives events; adapter normalizes and enqueues |
| **Streaming / Long-lived** | Mist WebSocket (optional) | Avoid in v1 — operational complexity not justified |

**Recommendation for v1:** Use **polling for inventory** across all vendors, and **webhooks for events** where supported (Mist, Aruba). Only fall back to polling for events when webhooks are unavailable (DNAC, vManage).

### 23.3 Adapter Architecture

Every vendor integration lives behind a uniform internal contract:

```
backend/ingest/
├── base/
│   ├── adapter.py            # abstract VendorAdapter interface
│   ├── normalizer.py         # vendor-specific → UnifiedEvent
│   ├── inventory_sync.py     # vendor-specific → topology entities
│   └── secrets.py            # credential resolution
├── vendors/
│   ├── dnac/
│   │   ├── client.py         # thin REST wrapper
│   │   ├── adapter.py        # implements VendorAdapter
│   │   ├── normalizers.py    # DNAC event → UnifiedEvent
│   │   └── inventory.py      # DNAC devices → topology.devices
│   ├── vmanage/
│   ├── mist/
│   │   ├── webhook.py        # FastAPI router for inbound webhooks
│   │   └── ...
│   └── aruba_central/
└── webhook_router.py         # /webhooks/{vendor} endpoint
```

The `VendorAdapter` interface enforces:

```
class VendorAdapter:
    def authenticate() -> Session
    def sync_inventory(since) -> list[InventoryDelta]
    def fetch_events(since) -> list[UnifiedEvent]      # for polling vendors
    def handle_webhook(payload) -> list[UnifiedEvent]  # for push vendors
    def health_check() -> AdapterHealth
```

This contract is the seam that keeps vendor messiness out of correlation, RCA, and the UI.

### 23.4 Per-Vendor Integration Plan

#### Cisco DNA Center (DNAC)

| Aspect | Detail |
|---|---|
| **API** | DNAC Intent API (REST, OAuth2 token via `/api/system/v1/auth/token`) |
| **Token lifetime** | 1 hour — refresh logic mandatory |
| **Inventory endpoint** | `/dna/intent/api/v1/network-device` (paginated) |
| **Events** | `/dna/intent/api/v1/event` and Assurance APIs (`/dna/intent/api/v1/assurance/...`) |
| **Webhooks** | DNAC supports outbound webhooks for events — prefer this over polling for events |
| **Rate limits** | ~5 req/sec sustained per cluster; design for 2 req/sec to leave headroom |
| **Inventory sync cadence** | Every 6 hours (full) + every 15 min (delta if API supports it) |
| **Event polling cadence** | 60 sec if webhooks unavailable; webhooks otherwise |
| **Topology gain** | Provides device list, interfaces, links (`/topology/physical-topology`) — populates `connections` table |
| **Wireless coverage** | Includes Cisco AP and WLC events — covers the 5% Cisco wireless footprint without separate integration |

**Architectural note:** DNAC is the most valuable integration for Naxis because it provides **physical topology** — the connections table foundation. Build this first.

#### Cisco vManage / Catalyst SD-WAN

| Aspect | Detail |
|---|---|
| **API** | vManage REST API (session-cookie auth via `/j_security_check`) |
| **Inventory endpoint** | `/dataservice/device` |
| **Events** | `/dataservice/event`, `/dataservice/alarms` |
| **Webhooks** | Limited support; expect polling-based integration |
| **Rate limits** | Varies by vManage cluster size; design for 1 req/sec |
| **Inventory sync cadence** | Every 4 hours |
| **Event polling cadence** | 30 sec |
| **Topology gain** | Provides WAN edges, transport tunnels, BFD sessions — populates `wan_paths` |
| **Critical signal** | Tunnel up/down and BFD events — these are the high-value triggers for Stage 3 path-aware correlation |

**Architectural note:** If the customer is on Arista EOS-CloudVision instead of Cisco vManage, the adapter shape is similar but the endpoints differ. Build the contract first, the specific vendor implementation second.

#### Juniper Mist (85% of wireless)

| Aspect | Detail |
|---|---|
| **API** | Mist Cloud REST API (`api.mist.com`, API token auth) |
| **Inventory endpoint** | `/api/v1/orgs/{org_id}/inventory`, `/sites/{site_id}/devices` |
| **Events** | Webhooks (preferred) — register at org level for `device-events`, `client-sessions`, `alarms` |
| **Rate limits** | 5000 req/hour — generous; webhooks bypass this entirely |
| **Inventory sync cadence** | Every 12 hours |
| **Event ingestion** | **Webhook-driven** — near-real-time |
| **Webhook signature verification** | HMAC-SHA256 with shared secret — mandatory |
| **Topology gain** | AP-to-controller mapping, AP-to-switch LLDP neighbors (rich) — populates `ap_clusters` and partial `connections` |
| **Critical signal** | High-retry, AP disconnect, RRM channel changes — Stage 2 correlation triggers |

**Architectural note:** Mist's webhook quality is excellent. Trust it. Don't over-engineer a polling fallback; if webhooks fail, treat it as an alarm condition rather than building a parallel polling path.

#### HPE Aruba Central (10% of wireless)

| Aspect | Detail |
|---|---|
| **API** | Aruba Central REST API (OAuth2) |
| **Token lifetime** | 2 hours, refresh tokens valid 14 days |
| **Inventory endpoint** | `/monitoring/v1/aps`, `/monitoring/v2/switches` |
| **Events** | `/monitoring/v2/events` (polling) and Streaming API (gRPC, complex) |
| **Webhooks** | Available via Central NetConductor / Activate — limited |
| **Rate limits** | 100 req/min per OAuth2 app — tight; design carefully |
| **Inventory sync cadence** | Every 12 hours |
| **Event polling cadence** | 60 sec |
| **Topology gain** | AP and switch inventory, neighbor data |

**Architectural note:** Aruba's rate limits are the tightest of the three. The adapter must implement exponential backoff and a token bucket. Do not parallelize Aruba calls naively.

### 23.5 Cross-Cutting Concerns

#### Authentication and Secret Management

- v1: Encrypted credentials in PostgreSQL using `pgcrypto`, key in environment
- v2: Migrate to HashiCorp Vault or cloud secrets manager when multi-tenant
- **Never** store secrets in config files committed to git
- Per-tenant credential scoping from day one (even pre-auth) — avoid retrofitting later

#### Rate Limit Strategy

A single token bucket per (vendor, tenant) pair, enforced in the adapter base class. The bucket is the only place rate limit logic lives — adapter implementations call `bucket.acquire()` before any request and have no further rate-limit responsibility.

#### Schema Drift and Versioning

Vendor APIs change. Naxis must:

- Pin to a specific API version per vendor (`v1`, `v2`)
- Log all unmapped fields in raw payloads (`raw jsonb` already in event schema)
- Alert on unexpected response shapes (Pydantic strict mode + a "drift counter" metric)
- Keep raw vendor payloads for 7 days minimum so debugging post-drift is possible

#### Inventory Reconciliation

Multiple vendors may claim the same device (rare but possible — DNAC and Aruba Central could both inventory a switch in a hybrid environment). The adapter framework must:

- Compute a canonical device fingerprint (serial number is the strongest signal)
- Apply a **vendor authority hierarchy** per device class (DNAC authoritative for Cisco wired, Mist for Mist wireless, etc.)
- Record provenance on every device row (`source_vendor`, `last_synced_at`)

#### Event Deduplication Across Vendors

The same physical link going down may produce events from both DNAC (port-down) and vManage (interface-flap) within seconds. The dedup logic in `events.event_dedup_index` must use a **device-and-interface-keyed fingerprint**, not a vendor-keyed one, to merge these correctly.

This is the kind of detail that separates a polished platform from a noisy one. **Test it explicitly.**

### 23.6 Operational Posture

| Concern | v1 Approach |
|---|---|
| **Adapter health monitoring** | Each adapter exposes `health_check()`; surface in Operations Overview as "Integrations" panel |
| **Vendor outage handling** | Mark adapter degraded; suppress correlation rules that depend on absent data; surface a banner in UI ("Mist data lagging — wireless intelligence reduced") |
| **Backfill on reconnect** | Pull events from `last_successful_sync` watermark when connectivity returns |
| **Webhook replay** | Mist supports webhook replay via API — implement this for missed events |
| **Adapter logging** | Every adapter call logs: vendor, endpoint, latency, status, payload size — without payload contents |

### 23.7 Updated 90-Day Roadmap Impact

Direct API integration changes Phase 1's scope materially. The corrected sequencing:

```
Phase 1 — Infrastructure Model + DNAC Integration (Weeks 3–6, +1 week)
├─ Sites, devices, interfaces, connections schema
├─ Adapter base contract + secret management
├─ DNAC adapter (inventory + topology + events)
├─ Infrastructure Explorer (real DNAC data, not CSV)
└─ Smoke test: DNAC sync produces a navigable topology

Phase 1.5 — Mist Wireless Integration (Week 7) [NEW]
├─ Mist adapter (inventory polling + webhook events)
├─ Webhook signature verification + replay handling
├─ AP cluster modeling
└─ Smoke test: AP failure event arrives in <30s end-to-end

Phase 2 — Topology-Aware Correlation (Weeks 8–10, was 6–8)
├─ (unchanged from prior plan)

Phase 2.5 — vManage SD-WAN Integration (Week 11) [NEW]
├─ vManage adapter (inventory + events polling)
├─ wan_paths population from BFD/tunnel topology
└─ Smoke test: tunnel-down event correlates with site degradation

Phase 3 — Hydrated Timeline + Structured RCA (Weeks 12–14)
├─ (unchanged from prior plan)

Phase 4 — Path-Aware Correlation + Aruba Central (Weeks 15–16)
├─ Aruba Central adapter (lower priority due to 10% footprint)
├─ Stage 3 correlation
└─ Suppression of downstream symptoms

Phase 5 — Polish + Leadership Demo (Week 17)
```

The 90-day plan extends to ~17 weeks. **This is honest scope.** The original 14-week plan assumed CSV inventory; real API integration adds 3 weeks. Cut Aruba Central from the first leadership demo if needed — its 10% footprint does not justify schedule pressure.

### 23.8 What This Section Replaces in the Original Blueprint

- Section 6 ("Population Strategy") — CSV import is now fallback, vendor APIs are primary
- Section 15 ("90-Day Roadmap") — superseded by Section 23.7
- Section 16 ("Risks") — add new risks below

### 23.9 New Risks Introduced by Direct Integration

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 9 | **Vendor API breakage during demo** | HIGH | Maintain a "recorded fixture" mode that replays past adapter responses for demos |
| 10 | **DNAC topology data is incomplete** (common in real deployments) | HIGH | Allow CSV supplementation of API-discovered inventory |
| 11 | **Webhook endpoint exposure** (Mist/Aruba require public URL) | HIGH | Use Cloudflare Tunnel or ngrok for dev; reverse proxy with allowlist for prod |
| 12 | **Secret leakage in logs** | HIGH | Mandatory log scrubber middleware; pre-commit secret scanner |
| 13 | **Rate limit exhaustion during incident storm** | MEDIUM | Token bucket + adaptive backoff; never let event polling starve inventory sync |
| 14 | **Schema drift breaks correlation silently** | MEDIUM | Drift counter metric + weekly review; raw payload retention for replay |

### 23.10 The Strategic Implication

Direct vendor integration is the single largest investment in the platform after the reasoning engine itself. It is also the single largest source of operational risk and ongoing maintenance burden.

The right framing: **vendor adapters are not features — they are infrastructure.** They must be built with the same care as the database schema. Treat them as load-bearing.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **NOIP** | Network Operations Intelligence Platform — the proposed product category |
| **Blast Radius** | The set of sites, devices, clients, and applications impacted by an incident |
| **Incident Role** | The function of an event within an incident: trigger, contributing, symptom, consequence, recovery |
| **Reasoning Path** | The ordered sequence of rules and evidence the engine used to reach a conclusion |
| **Operational Narrative** | A 2–3 sentence prose summary generated deterministically from RCA + timeline |
| **Topology-Aware Correlation** | Correlation that uses infrastructure relationships, not just time and severity |
| **Path-Aware Correlation** | Correlation that recognizes upstream causes producing downstream symptoms |
| **Tripwire** | A measurable threshold that triggers re-evaluation of an architectural decision |
| **Vendor Adapter** | A bounded module that translates a single vendor's API into Naxis's internal models (UnifiedEvent, topology entities) |
| **Vendor Authority Hierarchy** | The rule defining which vendor's data is canonical when multiple vendors describe the same entity (e.g. DNAC authoritative for Cisco wired) |
| **Schema Drift** | Unannounced changes to vendor API response shape that break adapter parsing |
| **Webhook Replay** | A vendor capability (notably Mist) to re-deliver events missed during downtime |

---

## Appendix B: Decision Log Summary

| Decision | Rationale | Tripwire |
|---|---|---|
| PostgreSQL only | Operational simplicity; sufficient for current scale | >25M events/day OR >2s p95 timeline query |
| No Redis | LISTEN/NOTIFY + queue table sufficient | Sustained >5K events/sec |
| No Kafka | Single-tenant, single-host scale | >10K events/sec OR multi-region |
| No Neo4j | Recursive CTE handles ≤4 hop traversals | Common queries exceed 4 hops with >10M edges |
| No microservices | Team size 1.5 developers | Team scales to >8 engineers |
| Deterministic correlation only | Trust, auditability, debuggability | None — this is a permanent posture |
| AI as optional layer only | Differentiation is transparency, not AI | None — this is a permanent posture |

---

## Document Control

| Field | Value |
|---|---|
| **Author** | Naxis Founding Team Review |
| **Reviewers** | Pending |
| **Status** | Draft for Internal Review |
| **Next Review** | End of Phase 0 (Week 2) |
| **Supersedes** | All prior architecture documents in the `docs/` folder regarding direction (the implementation docs remain valid as historical artifacts) |

---

*This document is the definitive blueprint for Naxis development through 2026. Deviations from the principles outlined here should be documented as ADRs (Architectural Decision Records) and reviewed against the central thesis: every screen, every endpoint, every incident must teach the operator something they did not already know.*
