# Correlation Engine — Architecture Documentation

> **Version:** 2.0 · **Date:** July 2026 · **Status:** Implemented (Stage 1 + Stage 2)

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [Architecture Overview](#2-architecture-overview)
3. [Stage 1: Site + Time-Window Grouping](#3-stage-1-site--time-window-grouping)
4. [Stage 2: Topology Cascade](#4-stage-2-topology-cascade)
5. [Incident Model](#5-incident-model)
6. [Configuration](#6-configuration)
7. [Code Map](#7-code-map)
8. [Usage Guide](#8-usage-guide)
9. [Testing Guide](#9-testing-guide)
10. [Extending the Engine](#10-extending-the-engine)
11. [FAQ](#11-faq)

---

## 1. What It Is

The correlation engine is the core intelligence layer of Naxis. It takes raw `UnifiedEvent` objects from network collectors (Mist, VeloCloud, DNAC, Arista) and turns them into structured `Incident` objects — grouped by site, time, and network topology.

**Without correlation:** "Here are 500 events, good luck."
**With correlation:** "Site SFO-01 — core-switch-01 failure cascading to 3 dependent devices. 82% confidence."

The engine is **deterministic** — same events in, same incidents out. No ML, no probabilities, no black boxes. Every decision is traceable to configurable thresholds and defined topology relationships.

### Two Stages

| Stage | What It Does | Output |
|-------|-------------|--------|
| **Stage 1** (stable) | Groups events by site + 5-minute time window | Flat incidents: "SFO-01 — connectivity issues affecting 3 devices" |
| **Stage 2** (new) | Restructures Stage 1 groups using topology: infra device = root, leaf devices = symptoms | Cascade incidents: "core-switch-01 — failure cascading to 3 dependent devices" |

---

## 2. Architecture Overview

```
Collectors (Mist, VeloCloud, DNAC, Arista)
    │
    ▼  UnifiedEvent (normalized, vendor-agnostic)
    │
CorrelationEngine.process_events()
    │
    ├── 1. Filter by severity (≥ MAJOR)
    ├── 2. Stage 1: group by site_id + time window (5 min)
    ├── 3. For each group → Stage 2: TopologyCascadeRule.evaluate()
    │       ├── Mode A: Topology-aware (DB-backed) — exact parent-child edges
    │       └── Mode B: Device-type heuristics (fallback) — infra vs leaf by device_type
    ├── 4. Create Incidents (one per CascadeGroup + residuals)
    └── 5. Mark events as processed (dedup)
```

### Key Design Principles

- **Deterministic**: Same input always produces same output. No randomness.
- **Configurable**: Time windows, severity thresholds, device type classifications all adjustable via `CorrelationConfig`.
- **Graceful degradation**: Stage 2 falls back to heuristics when topology DB is unavailable. Stage 1 runs standalone when Stage 2 is disabled.
- **Deduplication**: Processed events are tracked by `event_id` and skipped on subsequent calls.
- **Auditable**: Every incident links back to its source event IDs for full traceability.

---

## 3. Stage 1: Site + Time-Window Grouping

Stage 1 is the foundation. It groups events by spatial proximity (same site) and temporal proximity (within configured time window).

### Algorithm

1. **Filter**: Discard events below `min_severity` (default: MAJOR).
2. **Sort**: Events sorted by timestamp.
3. **Group**: Each event is placed into a group keyed by `site:{site_id}` (fallback to `device:{device_id}` for events without a site).
4. **Window check**: A new event joins an existing group only if it's within `time_window_seconds` of at least one event already in that group. If outside the window, a new subgroup is created (`site:site-abc:1`, `site:site-abc:2`, etc.).
5. **Correlate**: A group becomes an incident only if it meets the correlation threshold (≥ `min_event_count` high-severity events, or a single CRITICAL event if `correlate_single_critical` is enabled).

### What Gets an Incident Title

```
"{Site Name} — {Most Common Category} affecting {N} devices"
```

Example: `"SFO-01 — connectivity issues affecting 3 devices"`

### Relevant Code

| File | Key Function |
|------|-------------|
| `rules.py` | `group_events_by_site_and_time()` (line 149) |
| `rules.py` | `SiteTimeWindowRule.should_correlate()` (line 85) |
| `rules.py` | `generate_incident_title()` (line 243) |
| `engine.py` | `CorrelationEngine.process_events()` (line 73) — lines 97-101 run Stage 1 |

---

## 4. Stage 2: Topology Cascade

Stage 2 is the infrastructure-aware upgrade. It takes each Stage 1 group and reorganizes events into root-cause + symptom groups based on network topology.

### Why This Matters

In a typical network, one infrastructure failure (switch dies) causes many downstream symptoms (5 APs lose connectivity). Without Stage 2, all 6 events become one flat incident. With Stage 2, the switch events become the **root incident** and the AP events become **symptoms** — yielding a title like:

```
"naxis-core-01 — failure cascading to 3 dependent devices"
```

This tells an operator what actually broke, not just what's wrong.

### TopologyCascadeRule Algorithm

For each Stage 1 group:

1. **Separate**: Split events into `infra_events` and `leaf_events` based on `device_type`. Types like "switch", "router", "wan_edge", "gateway" are infra. Types like "ap", "client", "endpoint" are leaf. Unknown types default to leaf.

2. **Evaluate** (two modes):

   **Mode A — Topology-aware** (requires a `TopologyProvider`):
   - Calls `get_parent_child_map(device_ids)` to get all parent→child edges.
   - Groups infra events by `device_id` (multiple events on the same device become root_events together).
   - For each infra device that has matching children in the topology → creates one `CascadeGroup`.
   - Leaf events and other infra events whose devices match as children are placed in `symptom_events`.

   **Mode B — Heuristic fallback** (no DB needed):
   - Merges ALL infra events at the same site as a single `root_events` list.
   - Merges ALL leaf events at the same site as `symptom_events`.
   - Conservative — does not split events across incidents when topology is unknown.

3. **If no cascade groups found**: Falls back to Stage 1 flat incident for the entire group.

4. **Residual handling**: Any events in the original Stage 1 group not assigned to any cascade group become a separate flat residual incident. Nothing is silently dropped.

### CascadeGroup Dataclass

```python
@dataclass
class CascadeGroup:
    root_events: List[UnifiedEvent]       # Events on the failed infra device
    symptom_events: List[UnifiedEvent]    # Events on leaf devices affected
    root_device_id: str                    # The infra device that failed
```

### Cascade Incident Title

```
"{root_device_name} — failure cascading to {N} dependent devices"
```

Example: `"naxis-core-01 — failure cascading to 3 dependent devices"`

If no symptom events exist (infra-only group), falls back to the standard Stage 1 title.

### TopologyProvider Protocol

```python
class TopologyProvider(Protocol):
    async def get_parent_child_map(self, device_ids: Set[str]) -> Dict[str, List[str]]:
        """Return parent device_id → list of direct children.
        Only include entries where both parent and at least one child
        are in device_ids. Implementations query topology_nodes/edges from DB."""

    async def get_all_descendants(self, device_id: str, max_depth: int = 5) -> List[str]:
        """Return all descendants reachable via topology edges (blast radius)."""
```

In tests, `MockTopologyProvider` is seeded with known relationships. In production, a `PostgresTopologyProvider` would query `topology_nodes` + `topology_edges` tables (see [Next Steps](#611-implement-postgrestopologyprovider)).

### Relevant Code

| File | Key Function |
|------|-------------|
| `rules.py` | `TopologyCascadeRule.evaluate()` (line 381) |
| `rules.py` | `TopologyCascadeRule._evaluate_with_topology()` (line 417) |
| `rules.py` | `TopologyCascadeRule._evaluate_by_device_type()` (line 496) |
| `rules.py` | `TopologyCascadeRule._separate_by_device_type()` (line 563) |
| `rules.py` | `TopologyProvider` protocol (line 285) |
| `rules.py` | `CascadeGroup` dataclass (line 315) |
| `engine.py` | `CorrelationEngine._create_from_cascade()` (line 184) |
| `engine.py` | `process_events()` cascade loop (lines 117-170) |

---

## 5. Incident Model

### Fields

```python
class Incident(BaseModel):
    incident_id: str                       # Auto-generated: "inc-{uuid}"
    title: str                             # Human-readable summary
    severity: IncidentSeverity             # CRITICAL / MAJOR / MINOR / WARNING / INFO
    status: IncidentStatus                 # OPEN / INVESTIGATING / MITIGATED / RESOLVED / CLOSED / SUPPRESSED
    confidence_score: float                # 0.0 - 1.0
    probable_cause: Optional[str]          # AI-enriched (future)
    affected_sites: List[str]              # Deduplicated site IDs
    affected_devices: List[str]            # Deduplicated device IDs
    affected_clients: List[str]            # Deduplicated client IDs
    related_event_ids: List[str]           # All event IDs in this incident
```

### Confidence Score

```
confidence = (event_score × 0.4) + (avg_severity × 0.4) + (device_diversity × 0.2)
```

| Factor | Description | Scale |
|--------|-------------|-------|
| `event_score` | log-scaled event count: `log(N+1) / log(10)` | 0.0 - 1.0 |
| `avg_severity` | weighted average: CRITICAL=1.0, MAJOR=0.7, MINOR=0.4, WARNING=0.2, INFO=0.1 | 0.0 - 1.0 |
| `device_diversity` | unique devices / 5 (capped at 1.0) | 0.0 - 1.0 |

### Status Lifecycle

```
OPEN → INVESTIGATING → MITIGATED → RESOLVED → CLOSED
  ↓                                           ↓
 SUPPRESSED (terminal)                    CLOSED (terminal)
```

Terminal statuses (RESOLVED, CLOSED, SUPPRESSED) reject new events.

---

## 6. Configuration

### CorrelationConfig (Python)

```python
@dataclass
class CorrelationConfig:
    # Stage 1
    time_window_seconds: int = 300
    min_severity: EventSeverity = EventSeverity.MAJOR
    min_event_count: int = 2
    correlate_single_critical: bool = True

    # Stage 2
    topology_cascade_enabled: bool = True
    topology_fallback_to_device_type: bool = True
    infrastructure_device_types: Set[str] = {
        "switch", "router", "wan_edge", "gateway",
        "controller", "firewall", "core_switch",
        "distribution_switch", "access_switch",
    }
    leaf_device_types: Set[str] = {
        "ap", "access_point", "client", "endpoint",
        "sensor", "camera", "iot",
    }
    symptom_severity: str = "info"
```

### Environment Variables

Set in `.env` file, consumed by `backend/config/settings.py` → `CorrelationSettings`:

| Variable | Default | Description |
|----------|---------|-------------|
| `CORRELATION_TIME_WINDOW` | `300` | Time window in seconds |
| `CORRELATION_MIN_SEVERITY` | `MAJOR` | Minimum severity to trigger |
| `CORRELATION_MIN_EVENT_COUNT` | `2` | Minimum events for incident |
| `CORRELATION_SINGLE_CRITICAL` | `True` | Single critical creates incident |
| `CORRELATION_TOPOLOGY_CASCADE` | `True` | Enable Stage 2 cascade |
| `CORRELATION_TOPOLOGY_FALLBACK` | `True` | Enable heuristic fallback |

### Device Type Classification

| Category | Device Types |
|----------|--------------|
| **Infrastructure** (root causes) | `switch`, `router`, `wan_edge`, `gateway`, `controller`, `firewall`, `core_switch`, `distribution_switch`, `access_switch` |
| **Leaf** (symptoms) | `ap`, `access_point`, `client`, `endpoint`, `sensor`, `camera`, `iot` |
| **Unknown** (defaults to leaf) | Everything else |

---

## 7. Code Map

```
backend/shared/correlation/
├── __init__.py          # Public exports
├── engine.py            # CorrelationEngine — main entry point
└── rules.py             # SiteTimeWindowRule, TopologyCascadeRule, CascadeGroup,
                         # TopologyProvider, grouping, confidence, title generation

backend/shared/models/
├── event.py             # UnifiedEvent, DeviceInfo, ClientInfo, enums
└── incident.py          # Incident model with blast radius, confidence, lifecycle

backend/config/
└── settings.py          # CorrelationSettings (env var → CorrelationConfig)

backend/tests/
├── conftest.py          # make_event(), MockTopologyProvider, all test fixtures
└── test_correlation_engine.py  # All 78 tests

backend/worker/
└── main.py              # WorkerDaemon — has # TODO: correlate at line ~106
```

### Where to Wire It in the Worker

In `WorkerDaemon.run_once()` (`backend/worker/main.py:106`), there's:

```python
# TODO: correlate + create incidents
```

Integration is straightforward:
```python
from backend.shared.correlation import CorrelationEngine, CorrelationConfig

engine = CorrelationEngine(config=CorrelationConfig())
incidents = await engine.process_events(all_events)
for incident in incidents:
    await db.upsert_incident(incident)
    await db.link_events_to_incident(incident.incident_id, incident.related_event_ids)
```

---

## 8. Usage Guide

### Basic Usage

```python
from backend.shared.correlation import CorrelationEngine, CorrelationConfig
from backend.shared.models.event import UnifiedEvent

engine = CorrelationEngine(
    config=CorrelationConfig(topology_cascade_enabled=False)  # Stage 1 only
)
incidents = await engine.process_events(my_events)
```

### With Topology Cascade

```python
from backend.shared.correlation import CorrelationEngine, CorrelationConfig

engine = CorrelationEngine(
    config=CorrelationConfig(topology_cascade_enabled=True),
    topology_provider=my_provider,  # Optional — falls back to heuristics if None
)
incidents = await engine.process_events(my_events)

for incident in incidents:
    print(f"{incident.title} — {incident.severity} — {incident.confidence_score:.0%} confidence")
    print(f"  Devices: {incident.affected_devices}")
    print(f"  Events: {incident.related_event_ids}")
```

### Convenience Function

```python
from backend.shared.correlation import correlate_events

incidents = await correlate_events(my_events)
```

### Resetting Dedup Cache

```python
engine = CorrelationEngine()
await engine.process_events(batch_1)  # 3 incidents
await engine.process_events(batch_1)  # 0 (all deduped)
engine.reset()
await engine.process_events(batch_1)  # 3 incidents again
```

### Site-Specific Correlation

```python
incidents = await engine.correlate_site_events(all_events, site_id="site-sfo-01")
```

---

## 9. Testing Guide

### Run All Correlation Tests

```powershell
pytest backend/tests/test_correlation_engine.py -v
```

### Run by Category

```powershell
# Stage 1 only
pytest backend/tests/test_correlation_engine.py::TestCorrelationEngineProcessEvents -v

# Stage 2 unit tests
pytest backend/tests/test_correlation_engine.py::TestTopologyCascadeRuleUnit -v

# Stage 2 full pipeline
pytest backend/tests/test_correlation_engine.py::TestCorrelationEngineStage2 -v

# Incident model
pytest backend/tests/test_correlation_engine.py::TestIncidentModel -v

# Rules (grouping, confidence, title)
pytest backend/tests/test_correlation_engine.py::TestGroupEventsBySiteAndTime -v
pytest backend/tests/test_correlation_engine.py::TestConfidenceScore -v
pytest backend/tests/test_correlation_engine.py::TestIncidentTitle -v
```

### Creating Test Events

```python
from backend.tests.conftest import make_event

# Basic event (defaults to MIST, MAJOR, ap, site-sfo-01)
event = make_event("my-event-1", severity=EventSeverity.CRITICAL)

# Infrastructure device
switch_event = make_event("sw-1", device_id="core-01", device_type="switch")

# With client info
client_event = make_event("cl-1", client_id="mac-aa-bb-cc-dd-ee-ff")

# Cross-vendor
mist_event = make_event("m-1", source=EventSource.MIST)
vc_event = make_event("v-1", source=EventSource.VELOCLOUD)
```

### MockTopologyProvider

```python
from backend.tests.conftest import MockTopologyProvider

provider = MockTopologyProvider({
    "core-switch-01": ["ap-101", "ap-102", "ap-103"],
    "edge-router-01": ["ap-201"],
})
parent_map = await provider.get_parent_child_map(
    {"core-switch-01", "ap-101", "ap-102", "ap-103"}
)
# Returns: {"core-switch-01": ["ap-101", "ap-102", "ap-103"]}
```

### Writing New Tests

1. Create events using `make_event()` (defined in `conftest.py`).
2. For Stage 1 tests, use the `default_config` fixture (cascade disabled).
3. For Stage 2 tests, use `topology_aware_config` or create `CorrelationConfig(topology_cascade_enabled=True)`.
4. For topology tests, use `mock_topology_provider` fixture or create a `MockTopologyProvider` with your own map.
5. Mark async tests with `@pytest.mark.asyncio`.

---

## 10. Extending the Engine

### Adding a New Correlation Rule

1. Define a rule class following the `CorrelationRule` protocol in `rules.py`:
   ```python
   class MyRule:
       def should_correlate(self, events, config) -> bool: ...
       def group_key(self, event) -> str: ...
   ```
2. Wire it into `CorrelationEngine.process_events()` in `engine.py`.
3. Add tests in `test_correlation_engine.py`.

### Adding Infrastructure Device Types

Simply add to the set in `CorrelationConfig`:
```python
config = CorrelationConfig(
    infrastructure_device_types={"switch", "router", "wan_edge", "gateway", "firewall", "load_balancer"}
)
```

### Implementing a Real TopologyProvider

For production, implement a `PostgresTopologyProvider`:
```python
class PostgresTopologyProvider:
    def __init__(self, db):
        self.db = db

    async def get_parent_child_map(self, device_ids):
        rows = await self.db.fetch("""
            SELECT e.source_device_id, e.target_device_id
            FROM topology_edges e
            JOIN topology_nodes n1 ON e.source_device_id = n1.device_id
            JOIN topology_nodes n2 ON e.target_device_id = n2.device_id
            WHERE n1.device_type = ANY($1) AND n2.device_type = ANY($2)
            AND (e.source_device_id = ANY($3) OR e.target_device_id = ANY($3))
        """, infra_types, leaf_types, list(device_ids))
        # ... group into parent_child_map
```

### Adding a New Stage (e.g., Stage 3: Path-Aware Suppression)

Follow the pattern of Stage 2 in `engine.py`:
1. Add a new config flag to `CorrelationConfig`.
2. Create a new rule class in `rules.py`.
3. In `process_events()`, run the new rule after or before cascade.
4. Add tests.

---

## 11. FAQ

### Why deterministic rules instead of ML?

Operational teams need to trust and audit every incident. Deterministic rules provide perfect traceability — given the same events, you always get the same incidents. ML is planned for Stage 5 (RCA scoring).

### What happens when cascade is enabled but no topology provider is given?

The engine falls back to device-type heuristics (`_evaluate_by_device_type`). It merges all infra events at a site as root and all leaf events as symptoms. This is conservative — it never splits a cascading failure into separate incidents when topology is unknown.

### Can multiple infra devices at the same site cause separate incidents?

Yes — in topology-aware mode, each infra device with children in the topology gets its own cascade group. In heuristic mode, all infra at the same site is merged into a single root, since we can't attribute symptoms to specific parents without topology data.

### What happens to events not covered by any cascade group?

They become a "residual" flat Stage 1 incident. Nothing is silently dropped.

### How does deduplication work?

The engine tracks `event_id` values in `_processed_events: Set[str]`. On each call to `process_events()`, it filters out any events whose IDs are already in the set. `reset()` clears the cache. The dedup is per-engine-instance — restarting the process or creating a new engine starts fresh.

### Can events from different vendors be correlated together?

Yes. The engine is vendor-agnostic — it works with `UnifiedEvent` objects regardless of `source`. Events from Mist, VeloCloud, and DNAC at the same site within the same time window will be grouped together (see `test_cross_vendor_correlation`).

### How do I disable Stage 2 and use Stage 1 only?

Set `CorrelationConfig(topology_cascade_enabled=False)`. The engine will skip cascade entirely and create flat incidents from all Stage 1 groups.

### Why do Stage 1 tests all have cascade disabled?

The `default_config` fixture sets `topology_cascade_enabled=False` so existing Stage 1 tests are not affected by Stage 2 behavior (e.g., cascade-style titles, device-type splitting). Stage 2 tests opt in explicitly via `topology_aware_config`.

---

## Appendix: File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `backend/shared/correlation/__init__.py` | 37 | Module exports |
| `backend/shared/correlation/engine.py` | 398 | `CorrelationEngine` — main entry point, incident creation, cascade integration |
| `backend/shared/correlation/rules.py` | 585 | `SiteTimeWindowRule`, `TopologyCascadeRule`, `CascadeGroup`, `TopologyProvider`, grouping, confidence, title |
| `backend/shared/models/event.py` | — | `UnifiedEvent`, `DeviceInfo`, `ClientInfo`, `EventSeverity`, `EventCategory`, etc. |
| `backend/shared/models/incident.py` | — | `Incident` Pydantic model with blast radius, confidence, lifecycle |
| `backend/config/settings.py` | — | `CorrelationSettings` (env var → config mapping, lines ~85-99) |
| `backend/tests/conftest.py` | 537 | `make_event()`, `MockTopologyProvider`, all fixtures |
| `backend/tests/test_correlation_engine.py` | 1020 | 78 tests across 13 test classes |
| `backend/worker/main.py` | — | WorkerDaemon with `# TODO: correlate + create incidents` (line ~106) |
| `docs/5_handoff.md` | — | AI session handoff (not for human onboarding) |
| `docs/why/why-correlation-engine.md` | 216 | Product rationale and business case for the engine |

---

**Document Version:** 2.0
**Last Updated:** 2026-07-07
**Authors:** Naxis Development Team
**License:** MIT
