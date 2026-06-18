# Naxis MVP Architecture - Refined for 2-Person Team

**Version:** 2.0 (Simplified)  
**Date:** 2026-05-28  
**Focus:** Execution practicality over microservice purity

---

## Executive Summary

**Problem:** Original architecture had 7 backend services - too complex for 2-person MVP.

**Solution:** Consolidated to **2 backend services** (Worker + API) while preserving:
- Event-driven architecture
- Polyglot persistence
- Future scalability path
- Local development simplicity

**Result:** 70% reduction in operational complexity, 50% faster development cycle.

---

## 1. Refined Service Decomposition

### Original (Too Complex)
```
7 Backend Services:
├── api (API Gateway)
├── collectors (Vendor polling)
├── ingestion (Normalization)
├── correlation (Event correlation)
├── topology (Graph sync)
├── rca (AI analysis)
└── shared (Library)
```

### MVP (Simplified)
```
2 Backend Services:
├── worker (Background processing - ALL collection/processing logic)
└── api (FastAPI Gateway - REST endpoints + queries)
```

### Service Consolidation Strategy

| Original Services | Consolidated Into | Rationale |
|------------------|-------------------|-----------|
| collectors + ingestion + topology | **worker** | All background I/O, no HTTP serving |
| api + correlation + rca | **api** | All HTTP serving, on-demand processing |
| shared | **shared** | Remains as library |

---

## 2. Simplified Service Responsibilities

### Worker Service (`backend/worker/`)

**Type:** Background daemon (no HTTP server)  
**Entry:** Single `main.py` with asyncio event loop

**Responsibilities:**
1. **Vendor Collection**
   - Poll DNAC, Mist, Arista SD-WAN, Arista WLC APIs
   - Configurable interval (default: 60s)
   - Handle authentication and session management

2. **Event Normalization**
   - Transform vendor events to UnifiedEvent schema
   - Enrich with topology context from Neo4j
   - Write to ClickHouse `events` table

3. **Topology Synchronization**
   - Sync devices, links, clients from vendor APIs
   - Upsert to Neo4j graph
   - Detect topology changes
   - Refresh every 5 minutes

4. **Event Correlation**
   - Run correlation logic after each collection cycle
   - Time-window based (5-minute windows)
   - Proximity-based using Neo4j queries
   - Create/update incidents in ClickHouse

5. **Real-Time Publishing**
   - Publish new events to Redis Pub/Sub channel
   - Publish incident updates to Redis Pub/Sub
   - Enable real-time frontend updates via API SSE

**Key Files:**
```python
worker/
├── main.py                    # Entry point with asyncio loop
├── collectors/
│   ├── dnac.py               # Cisco DNAC collector
│   ├── mist.py               # Juniper Mist collector
│   ├── arista_sdwan.py       # Arista SD-WAN collector
│   └── arista_wlc.py         # Arista WLC collector
├── processors/
│   ├── normalizer.py         # Event normalization
│   └── enrichment.py         # Topology enrichment
├── topology/
│   ├── device_sync.py        # Device synchronization
│   ├── link_sync.py          # Link synchronization
│   └── client_sync.py        # Client synchronization
├── correlation/
│   ├── time_window.py        # Time-based correlation
│   ├── proximity.py          # Graph proximity correlation
│   └── incident_manager.py   # Incident CRUD
└── scheduler.py              # Task scheduling logic
```

**Main Loop:**
```python
async def main():
    logger.info("Starting Naxis Worker...")
    
    while True:
        try:
            # Run all collection tasks in parallel
            await asyncio.gather(
                collect_and_process_dnac(),
                collect_and_process_mist(),
                collect_and_process_arista_sdwan(),
                collect_and_process_arista_wlc(),
                sync_topology(),
                run_correlation_check(),
            )
        except Exception as e:
            logger.error(f"Worker cycle failed: {e}")
        
        await asyncio.sleep(settings.collection_interval)
```

---

### API Service (`backend/api/`)

**Type:** FastAPI HTTP server  
**Entry:** `main.py` with Uvicorn

**Responsibilities:**
1. **REST API Gateway**
   - Serve all HTTP endpoints
   - Request validation with Pydantic
   - CORS middleware for frontend

2. **Data Queries**
   - Query events from ClickHouse
   - Query incidents from ClickHouse
   - Query topology from Neo4j
   - Apply filters, pagination, sorting

3. **On-Demand RCA**
   - Trigger RCA analysis for specific incidents
   - Call Ollama for LLM inference
   - Generate human-readable explanations
   - Cache results in Redis

4. **Real-Time Streaming**
   - Server-Sent Events (SSE) for live updates
   - Subscribe to Redis Pub/Sub channels
   - Push events/incidents to connected clients

5. **Health Checks**
   - Liveness probe (process alive)
   - Readiness probe (dependencies healthy)

**Key Files:**
```python
api/
├── main.py                    # FastAPI app entry
├── routers/
│   ├── health.py             # Health check endpoints
│   ├── events.py             # GET /events (list, filter, search)
│   ├── incidents.py          # GET /incidents (list, detail)
│   ├── topology.py           # GET /topology (graph data)
│   ├── rca.py                # POST /rca/{incident_id} (trigger analysis)
│   └── stream.py             # GET /stream (SSE endpoint)
├── services/
│   ├── event_service.py      # Event business logic
│   ├── incident_service.py   # Incident business logic
│   ├── topology_service.py   # Topology business logic
│   └── rca_service.py        # RCA business logic (Ollama)
└── dependencies.py           # DI singletons
```

---

## 3. Simplified Docker Compose Stack

### MVP Stack (7 Containers)

```yaml
version: '3.8'

services:
  # Infrastructure (4 containers)
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
  
  clickhouse:
    image: clickhouse/clickhouse-server:23.8-alpine
    ports: ["8123:8123", "9000:9000"]
    environment:
      CLICKHOUSE_DB: naxis
    volumes:
      - clickhouse_data:/var/lib/clickhouse
      - ./schemas/clickhouse:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
  
  neo4j:
    image: neo4j:5.15-community
    ports: ["7474:7474", "7687:7687"]
    environment:
      NEO4J_AUTH: neo4j/naxis_password
      NEO4JLABS_PLUGINS: '["apoc"]'
    volumes:
      - neo4j_data:/data
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "naxis_password", "RETURN 1"]
  
  ollama:
    image: ollama/ollama:latest
    ports: ["11434:11434"]
    volumes:
      - ollama_models:/root/.ollama
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
  
  # Application (3 containers)
  worker:
    build:
      context: .
      dockerfile: backend/worker/Dockerfile
    env_file: .env
    depends_on:
      redis: { condition: service_healthy }
      clickhouse: { condition: service_healthy }
      neo4j: { condition: service_healthy }
    restart: unless-stopped
  
  api:
    build:
      context: .
      dockerfile: backend/api/Dockerfile
    ports: ["8000:8000"]
    env_file: .env
    depends_on:
      redis: { condition: service_healthy }
      clickhouse: { condition: service_healthy }
      neo4j: { condition: service_healthy }
      ollama: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health/live"]
    restart: unless-stopped
  
  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    depends_on:
      api: { condition: service_healthy }
    restart: unless-stopped

volumes:
  clickhouse_data:
  neo4j_data:
  ollama_models:

networks:
  default:
    name: naxis-net
```

**Complexity Comparison:**
- **Before**: 11 services (4 infra + 7 app)
- **After**: 7 services (4 infra + 3 app)
- **Reduction**: 36% fewer containers to manage

---

## 4. Updated Event Flow

### Simplified Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Vendor APIs                               │
│  [Cisco DNAC] [Juniper Mist] [Arista SD-WAN] [Arista WLC]  │
└────────────────────────┬────────────────────────────────────┘
                         │ Poll every 60s
                         ▼
          ┌──────────────────────────────┐
          │      Worker Service          │
          │  ┌────────────────────────┐  │
          │  │  1. Collect Events     │  │
          │  │  2. Normalize          │  │
          │  │  3. Enrich (Topology)  │  │
          │  │  4. Store ClickHouse   │  │
          │  │  5. Publish Redis      │  │
          │  │  6. Correlate Events   │  │
          │  │  7. Create Incidents   │  │
          │  └────────────────────────┘  │
          └────┬────────────────┬─────────┘
               │                │
               ▼                ▼
       ┌─────────────┐   ┌────────────┐
       │ ClickHouse  │   │   Redis    │
       │  (Storage)  │   │  (Pub/Sub) │
       └─────┬───────┘   └─────┬──────┘
             │                 │
             │ Query           │ Subscribe
             │                 │
             ▼                 ▼
       ┌─────────────────────────────┐
       │       API Service           │
       │  ┌───────────────────────┐  │
       │  │  REST Endpoints       │  │
       │  │  Query Logic          │  │
       │  │  RCA (Ollama)         │  │
       │  │  SSE Streaming        │  │
       │  └───────────────────────┘  │
       └──────────────┬──────────────┘
                      │ HTTP/SSE
                      ▼
            ┌────────────────────┐
            │   Frontend (Web)   │
            │  Next.js App       │
            └────────────────────┘
```

### Event Processing Pipeline

**Step 1: Collection (Worker)**
```python
# Worker collects from vendor API
raw_events = await dnac_client.get_events(since=last_poll)

# Normalize to UnifiedEvent
for raw in raw_events:
    event = normalize_dnac_event(raw)
    
    # Enrich with topology
    device = neo4j.query("MATCH (d:Device {device_id: $id})", id=event.device_id)
    event.site_id = device.site_id
    
    # Store in ClickHouse
    clickhouse.insert("events", [event.dict()])
    
    # Publish to Redis for real-time
    redis.publish("naxis:events", json.dumps(event.dict()))
```

**Step 2: Correlation (Worker)**
```python
# After collection, run correlation
recent_events = clickhouse.query("""
    SELECT * FROM events 
    WHERE timestamp > now() - INTERVAL 5 MINUTE
    AND severity IN ('critical', 'major')
    ORDER BY timestamp DESC
""")

# Time-window correlation
correlated = correlate_by_time_window(recent_events, window=300)

# Proximity correlation using Neo4j
for cluster in correlated:
    devices = [e.device_id for e in cluster]
    proximity = neo4j.query("""
        MATCH (d1:Device)-[:CONNECTED_TO*1..2]-(d2:Device)
        WHERE d1.device_id IN $devices OR d2.device_id IN $devices
        RETURN d1, d2
    """, devices=devices)
    
    if len(proximity) > 1:
        # Create incident
        incident = create_incident(cluster, proximity)
        clickhouse.insert("incidents", [incident.dict()])
        redis.publish("naxis:incidents", json.dumps(incident.dict()))
```

**Step 3: Query (API)**
```python
# API serves queries
@router.get("/api/v1/events")
async def list_events(
    start_time: datetime,
    end_time: datetime,
    severity: Optional[List[str]] = None,
    clickhouse: ClickHouseClient = Depends(get_clickhouse)
):
    query = """
        SELECT * FROM events
        WHERE timestamp BETWEEN %(start)s AND %(end)s
    """
    if severity:
        query += " AND severity IN %(severities)s"
    
    events = clickhouse.query(query, {
        "start": start_time,
        "end": end_time,
        "severities": severity
    })
    return {"events": events}
```

**Step 4: Real-Time Updates (API)**
```python
# API streams updates via SSE
@router.get("/api/v1/stream")
async def event_stream(redis: RedisClient = Depends(get_redis)):
    async def event_generator():
        pubsub = redis.subscribe("naxis:events", "naxis:incidents")
        async for message in pubsub:
            yield f"data: {message}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream"
    )
```

---

## 5. Updated Folder Structure

```
naxis/
├── backend/
│   ├── shared/                      # Common libraries
│   │   ├── models/
│   │   │   ├── event.py            # UnifiedEvent
│   │   │   ├── incident.py         # Incident model
│   │   │   ├── topology.py         # Device, Site, Link
│   │   │   └── identity.py         # Identity mapping
│   │   ├── database/
│   │   │   ├── redis.py
│   │   │   ├── clickhouse.py
│   │   │   └── neo4j.py
│   │   ├── config/
│   │   │   └── settings.py
│   │   └── utils/
│   │       ├── logging.py
│   │       └── retry.py
│   │
│   ├── worker/                      # Background worker
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── main.py                 # Entry point
│   │   ├── collectors/
│   │   │   ├── dnac.py
│   │   │   ├── mist.py
│   │   │   ├── arista_sdwan.py
│   │   │   └── arista_wlc.py
│   │   ├── processors/
│   │   │   ├── normalizer.py
│   │   │   └── enrichment.py
│   │   ├── topology/
│   │   │   ├── device_sync.py
│   │   │   ├── link_sync.py
│   │   │   └── client_sync.py
│   │   ├── correlation/
│   │   │   ├── time_window.py
│   │   │   ├── proximity.py
│   │   │   └── incident_manager.py
│   │   └── scheduler.py
│   │
│   └── api/                         # FastAPI application
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── main.py                 # FastAPI app
│       ├── routers/
│       │   ├── health.py
│       │   ├── events.py
│       │   ├── incidents.py
│       │   ├── topology.py
│       │   ├── rca.py
│       │   └── stream.py
│       ├── services/
│       │   ├── event_service.py
│       │   ├── incident_service.py
│       │   ├── topology_service.py
│       │   └── rca_service.py
│       └── dependencies.py
│
├── frontend/                        # Next.js (unchanged)
├── schemas/                         # DB schemas
├── config/                          # Configuration
├── docs/                            # Documentation
└── scripts/                         # Utility scripts
```

**Key Changes:**
- ❌ Removed: `collectors/`, `ingestion/`, `correlation/`, `topology/`, `rca/` services
- ✅ Added: `worker/` (consolidates all background processing)
- ✅ Simplified: `api/` (no embedded correlation logic, just queries)

---

## 6. Incident Model

### Complete Incident Schema

```python
from enum import Enum
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

class IncidentStatus(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    CLOSED = "closed"

class IncidentSeverity(str, Enum):
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    WARNING = "warning"

class AffectedEntity(BaseModel):
    """Entity affected by incident"""
    entity_type: str          # "device", "site", "client", "link"
    entity_id: str            # ID of the entity
    entity_name: str          # Human-readable name
    impact: str               # Description of impact

class CorrelationReason(BaseModel):
    """Why events were correlated"""
    method: str               # "time_window", "proximity", "pattern"
    confidence: float         # 0.0 to 1.0
    details: Dict[str, Any]   # Method-specific details

class RCAAnalysis(BaseModel):
    """Root cause analysis results"""
    root_cause: str           # Identified root cause
    explanation: str          # Human-readable explanation
    confidence: float         # 0.0 to 1.0
    evidence: List[str]       # Supporting evidence
    generated_at: datetime
    model: str                # "llama3.1:8b"

class Incident(BaseModel):
    """Complete incident model"""
    # Identity
    incident_id: str = Field(default_factory=lambda: f"inc-{uuid.uuid4().hex[:12]}")
    
    # Status
    status: IncidentStatus = IncidentStatus.OPEN
    severity: IncidentSeverity
    
    # Description
    title: str                           # Auto-generated summary
    description: str                     # Detailed description
    
    # Temporal
    first_event_time: datetime           # Earliest correlated event
    last_event_time: datetime            # Latest correlated event
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
    
    # Correlated Events
    event_ids: List[str]                 # IDs of correlated events
    event_count: int                     # Number of events
    
    # Affected Entities
    affected_devices: List[AffectedEntity] = []
    affected_sites: List[str] = []       # Site IDs
    affected_clients: List[str] = []     # Client MACs
    
    # Correlation
    correlation_reason: CorrelationReason
    
    # RCA
    rca_analysis: Optional[RCAAnalysis] = None
    
    # Tags & Metadata
    tags: List[str] = []
    metadata: Dict[str, Any] = {}
    
    # Assignment
    assigned_to: Optional[str] = None
    notes: List[str] = []

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
```

### ClickHouse Incident Table

```sql
-- schemas/clickhouse/002_incidents.sql
CREATE TABLE IF NOT EXISTS naxis.incidents (
    incident_id String,
    status LowCardinality(String),
    severity LowCardinality(String),
    title String,
    description String,
    
    first_event_time DateTime64(3),
    last_event_time DateTime64(3),
    created_at DateTime64(3),
    updated_at DateTime64(3),
    resolved_at Nullable(DateTime64(3)),
    
    event_ids Array(String),
    event_count UInt32,
    
    affected_devices Array(String),  -- JSON strings of AffectedEntity
    affected_sites Array(String),
    affected_clients Array(String),
    
    correlation_method LowCardinality(String),
    correlation_confidence Float32,
    correlation_details String,  -- JSON
    
    rca_root_cause Nullable(String),
    rca_explanation Nullable(String),
    rca_confidence Nullable(Float32),
    rca_generated_at Nullable(DateTime64(3)),
    
    tags Array(String),
    metadata String,  -- JSON
    assigned_to Nullable(String),
    
    INDEX idx_status status TYPE set(0) GRANULARITY 1,
    INDEX idx_severity severity TYPE set(0) GRANULARITY 1,
    INDEX idx_sites affected_sites TYPE bloom_filter GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (status, severity, created_at, incident_id)
TTL created_at + INTERVAL 180 DAY;
```

---

## 7. Identity Stitching Strategy

### Problem Statement

Different vendors use different identifiers:
- **DNAC**: Uses UUID for devices
- **Mist**: Uses MAC addresses
- **Arista**: Uses serial numbers
- **Client Tracking**: MAC address vs. username

### Solution: Identity Mapping Layer

#### Approach 1: Neo4j as Identity Hub

```cypher
// Device identity node with all vendor IDs
CREATE (d:Device {
    canonical_id: "device-12345",
    name: "Core-Switch-1",
    ip_address: "10.0.1.1",
    mac_address: "aa:bb:cc:dd:ee:ff"
})

// Vendor-specific identity nodes
CREATE (dnac:DnacDevice {device_id: "uuid-from-dnac"})
CREATE (mist:MistDevice {device_id: "mac-from-mist"})
CREATE (arista:AristaDevice {device_id: "serial-from-arista"})

// Link them
CREATE (dnac)-[:REPRESENTS]->(d)
CREATE (mist)-[:REPRESENTS]->(d)
CREATE (arista)-[:REPRESENTS]->(d)

// Query: Find canonical device from any vendor ID
MATCH (vendor)-[:REPRESENTS]->(d:Device)
WHERE vendor.device_id = 'uuid-from-dnac'
RETURN d.canonical_id
```

#### Approach 2: ClickHouse Mapping Table

```sql
-- schemas/clickhouse/004_identity_map.sql
CREATE TABLE IF NOT EXISTS naxis.device_identity_map (
    canonical_id String,
    vendor LowCardinality(String),  -- dnac, mist, arista_sdwan, arista_wlc
    vendor_device_id String,
    device_name String,
    ip_address Nullable(String),
    mac_address Nullable(String),
    serial_number Nullable(String),
    site_id String,
    last_seen DateTime64(3),
    
    PRIMARY KEY (vendor, vendor_device_id)
)
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY (vendor, vendor_device_id);

-- Query: Find canonical ID
SELECT canonical_id 
FROM device_identity_map 
WHERE vendor = 'dnac' AND vendor_device_id = 'uuid-from-dnac';
```

#### Approach 3: Hybrid (Recommended for MVP)

**Use Neo4j for:**
- Active topology relationships
- Path finding and impact analysis
- Devices with canonical IDs

**Use ClickHouse for:**
- Identity mapping lookups (faster)
- Historical identity changes
- Bulk queries

**Implementation:**
```python
# backend/shared/models/identity.py
class DeviceIdentity(BaseModel):
    canonical_id: str           # naxis-device-{hash}
    name: str
    ip_address: Optional[str]
    mac_address: Optional[str]
    site_id: str
    
    vendor_ids: Dict[str, str]  # {"dnac": "uuid", "mist": "mac"}

# Worker stitching logic
async def stitch_device_identity(vendor: str, vendor_device: Dict) -> str:
    """
    Stitch device identity across vendors.
    Returns canonical_id.
    """
    # Try to find existing device by unique attributes
    candidates = []
    
    # Match by MAC address (most reliable)
    if mac := vendor_device.get("mac_address"):
        candidates.extend(
            clickhouse.query(
                "SELECT canonical_id FROM device_identity_map WHERE mac_address = %(mac)s",
                {"mac": mac}
            )
        )
    
    # Match by IP address
    if ip := vendor_device.get("ip_address"):
        candidates.extend(
            clickhouse.query(
                "SELECT canonical_id FROM device_identity_map WHERE ip_address = %(ip)s",
                {"ip": ip}
            )
        )
    
    # Match by hostname pattern
    if name := vendor_device.get("hostname"):
        # Normalize hostname (remove domain, lowercase)
        normalized_name = normalize_hostname(name)
        candidates.extend(
            clickhouse.query(
                "SELECT canonical_id FROM device_identity_map WHERE device_name LIKE %(name)s",
                {"name": f"%{normalized_name}%"}
            )
        )
    
    if candidates:
        # Use most frequent canonical_id (voting)
        canonical_id = Counter([c["canonical_id"] for c in candidates]).most_common(1)[0][0]
    else:
        # Create new canonical ID
        canonical_id = f"naxis-device-{hashlib.sha256(mac or ip or name).hexdigest()[:12]}"
    
    # Upsert mapping
    clickhouse.insert("device_identity_map", [{
        "canonical_id": canonical_id,
        "vendor": vendor,
        "vendor_device_id": vendor_device["id"],
        "device_name": vendor_device.get("hostname"),
        "ip_address": vendor_device.get("ip_address"),
        "mac_address": vendor_device.get("mac_address"),
        "serial_number": vendor_device.get("serial"),
        "site_id": vendor_device["site_id"],
        "last_seen": datetime.utcnow()
    }])
    
    return canonical_id
```

### Site Stitching

```python
# Similar approach for sites
SITE_NAME_MAPPINGS = {
    "HQ": ["Headquarters", "Main Office", "Corporate HQ"],
    "DC1": ["Datacenter 1", "Data Center East", "DC-East"],
    "BRANCH-SF": ["San Francisco Branch", "SF Office", "Bay Area"],
}

def normalize_site_id(vendor_site_name: str) -> str:
    """Normalize site names across vendors"""
    for canonical, variants in SITE_NAME_MAPPINGS.items():
        if any(v.lower() in vendor_site_name.lower() for v in variants):
            return canonical
    
    # Fallback: slugify vendor name
    return slugify(vendor_site_name)
```

### Client Stitching

```python
# Clients are easier - MAC address is universal
def stitch_client_identity(client_data: Dict) -> str:
    mac = client_data["mac_address"]
    username = client_data.get("username")
    hostname = client_data.get("hostname")
    
    # Canonical ID is MAC (lowercase, no separators)
    canonical_id = mac.lower().replace(":", "").replace("-", "")
    
    # Store enrichment data
    clickhouse.insert("client_identity_map", {
        "canonical_id": canonical_id,
        "mac_address": mac,
        "username": username,
        "hostname": hostname,
        "last_seen": datetime.utcnow()
    })
    
    return canonical_id
```

---

## 8. Recommended MVP Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Next.js App (Port 3000)                           │     │
│  │  - Event List UI                                   │     │
│  │  - Incident Timeline                               │     │
│  │  - Topology Visualization                          │     │
│  │  - RCA Display                                     │     │
│  │  - Real-time updates (EventSource/SSE)            │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP + SSE
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Service                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │  FastAPI (Port 8000)                               │     │
│  │  ┌──────────────────────────────────────────────┐ │     │
│  │  │  REST Endpoints                              │ │     │
│  │  │  - GET /events (filter, paginate)           │ │     │
│  │  │  - GET /incidents                            │ │     │
│  │  │  - GET /topology                             │ │     │
│  │  │  - POST /rca/{id} (trigger analysis)        │ │     │
│  │  │  - GET /stream (SSE)                         │ │     │
│  │  └──────────────────────────────────────────────┘ │     │
│  │  ┌──────────────────────────────────────────────┐ │     │
│  │  │  Services                                     │ │     │
│  │  │  - EventService (query ClickHouse)           │ │     │
│  │  │  - IncidentService (query ClickHouse)        │ │     │
│  │  │  - TopologyService (query Neo4j)             │ │     │
│  │  │  - RCAService (call Ollama, cache Redis)    │ │     │
│  │  └──────────────────────────────────────────────┘ │     │
│  └────────────────────────────────────────────────────┘     │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
             │ Query                  │ Subscribe
             ▼                        ▼
┌───────────────────────┐   ┌────────────────────┐
│   ClickHouse          │   │   Redis            │
│   - events table      │   │   - Pub/Sub        │
│   - incidents table   │   │   - Cache          │
│   - identity_map      │   │   - RCA results    │
└───────────────────────┘   └────────────────────┘
             ▲                        ▲
             │ Write                  │ Publish
             │                        │
┌─────────────────────────────────────────────────────────────┐
│                     Worker Service                           │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Background Daemon (No HTTP server)                │     │
│  │  ┌──────────────────────────────────────────────┐ │     │
│  │  │  Collection Loop (every 60s)                 │ │     │
│  │  │  1. Poll vendor APIs                         │ │     │
│  │  │  2. Normalize events                         │ │     │
│  │  │  3. Stitch identities                        │ │     │
│  │  │  4. Enrich with topology                     │ │     │
│  │  │  5. Write to ClickHouse                      │ │     │
│  │  │  6. Publish to Redis Pub/Sub                 │ │     │
│  │  └──────────────────────────────────────────────┘ │     │
│  │  ┌──────────────────────────────────────────────┐ │     │
│  │  │  Correlation Loop (after collection)         │ │     │
│  │  │  1. Query recent events                      │ │     │
│  │  │  2. Time-window correlation                  │ │     │
│  │  │  3. Proximity correlation (Neo4j)            │ │     │
│  │  │  4. Create/update incidents                  │ │     │
│  │  │  5. Publish incident updates                 │ │     │
│  │  └──────────────────────────────────────────────┘ │     │
│  │  ┌──────────────────────────────────────────────┐ │     │
│  │  │  Topology Sync (every 5 min)                 │ │     │
│  │  │  1. Poll vendor topology APIs                │ │     │
│  │  │  2. Stitch device identities                 │ │     │
│  │  │  3. Upsert to Neo4j graph                    │ │     │
│  │  │  4. Detect topology changes                  │ │     │
│  │  └──────────────────────────────────────────────┘ │     │
│  └────────────────────────────────────────────────────┘     │
└───────────────────────┬──────────────────────────────────────┘
                        │ Query
                        ▼
              ┌──────────────────┐
              │   Neo4j Graph    │
              │   - Devices      │
              │   - Links        │
              │   - Sites        │
              │   - Clients      │
              └──────────────────┘
                        ▲
                        │ RCA Queries
                        │
              ┌──────────────────┐
              │   Ollama LLM     │
              │   - llama3.1:8b  │
              │   - Local        │
              └──────────────────┘
                        ▲
                        │ Inference
                        │
        (Called by API Service for RCA)
```

### Technology Stack

| Component | Technology | Port | Purpose |
|-----------|-----------|------|---------|
| Frontend | Next.js 14 | 3000 | Web UI |
| API | FastAPI | 8000 | REST Gateway + Business Logic |
| Worker | Python asyncio | - | Background Processing |
| Event Store | ClickHouse | 9000 | Events + Incidents Storage |
| Graph DB | Neo4j | 7687 | Topology Graph |
| Cache/Pub-Sub | Redis | 6379 | Real-time + Caching |
| LLM | Ollama | 11434 | AI Inference |

### Resource Requirements

**Minimum (Development):**
- CPU: 4 cores
- RAM: 16 GB (8GB ClickHouse, 4GB Neo4j, 2GB Ollama, 2GB services)
- Disk: 50 GB SSD

**Recommended (Production-like):**
- CPU: 8 cores
- RAM: 32 GB
- Disk: 200 GB NVMe SSD

---

## 9. Development Priority Order

### Phase 1: Foundation (Week 1-2) ✅ COMPLETE
- [x] Monorepo structure
- [x] Shared models and utilities
- [x] Docker Compose stack
- [x] Development workflow

### Phase 2: Data Layer (Week 3) 🎯 START HERE

**Priority 1: Shared Models**
```python
# backend/shared/models/
├── event.py        # UnifiedEvent, EventSource, EventSeverity
├── incident.py     # Incident, IncidentStatus, RCAAnalysis
├── topology.py     # Device, Site, Link, Client
└── identity.py     # DeviceIdentity, identity stitching
```

**Priority 2: Database Clients**
```python
# backend/shared/database/
├── redis.py        # RedisClient (pub/sub, cache)
├── clickhouse.py   # ClickHouseClient (query, insert)
└── neo4j.py        # Neo4jClient (graph queries)
```

**Priority 3: Database Schemas**
```sql
# schemas/clickhouse/
├── 001_events.sql
├── 002_incidents.sql
└── 004_identity_map.sql

# schemas/neo4j/
├── 001_constraints.cypher
└── 002_indexes.cypher
```

### Phase 3: Worker Service (Week 4-5)

**Priority 1: Single Collector (DNAC)**
```python
# backend/worker/collectors/dnac.py
- Authenticate with DNAC
- Poll events API
- Return raw events
```

**Priority 2: Normalization**
```python
# backend/worker/processors/normalizer.py
- Transform DNAC events to UnifiedEvent
- Write to ClickHouse
- Publish to Redis
```

**Priority 3: Basic Topology Sync**
```python
# backend/worker/topology/device_sync.py
- Sync devices from DNAC
- Stitch identities
- Upsert to Neo4j
```

**Priority 4: Main Worker Loop**
```python
# backend/worker/main.py
- Scheduler that runs every 60s
- Call collector → normalizer → storage
```

### Phase 4: API Service (Week 6)

**Priority 1: Health Checks**
```python
# backend/api/routers/health.py
- GET /health/live
- GET /health/ready (check dependencies)
```

**Priority 2: Events API**
```python
# backend/api/routers/events.py
- GET /api/v1/events (list with filters)
- GET /api/v1/events/{id} (detail)
```

**Priority 3: EventService**
```python
# backend/api/services/event_service.py
- Query ClickHouse with filters
- Pagination logic
```

### Phase 5: Frontend Basics (Week 7)

**Priority 1: Layout + Navigation**
```typescript
// frontend/src/app/layout.tsx
- Root layout with navigation
- TanStack Query provider
```

**Priority 2: Events List**
```typescript
// frontend/src/app/events/page.tsx
- Fetch events from API
- Display in table
- Basic filtering
```

**Priority 3: API Client**
```typescript
// frontend/src/lib/api.ts
- Axios client
- Type-safe methods
```

### Phase 6: Correlation (Week 8-9)

**Priority 1: Time-Window Correlation**
```python
# backend/worker/correlation/time_window.py
- Group events within 5-minute window
- Create incidents
```

**Priority 2: Incidents API**
```python
# backend/api/routers/incidents.py
- GET /api/v1/incidents (list)
- GET /api/v1/incidents/{id} (detail)
```

**Priority 3: Incident UI**
```typescript
// frontend/src/app/incidents/page.tsx
- Display incidents
- Show correlated events
```

### Phase 7: Topology (Week 10)

**Priority 1: Full Topology Sync**
```python
# backend/worker/topology/
- device_sync.py (devices)
- link_sync.py (connections)
- client_sync.py (clients)
```

**Priority 2: Topology API**
```python
# backend/api/routers/topology.py
- GET /api/v1/topology (graph data)
- GET /api/v1/topology/device/{id}
```

**Priority 3: Topology Visualization**
```typescript
// frontend/src/app/topology/page.tsx
- React Flow graph
- Device nodes, link edges
```

### Phase 8: RCA (Week 11-12)

**Priority 1: Ollama Integration**
```python
# backend/api/services/rca_service.py
- Call Ollama API
- Generate RCA explanations
- Cache in Redis
```

**Priority 2: RCA Endpoint**
```python
# backend/api/routers/rca.py
- POST /api/v1/rca/{incident_id}
- Trigger analysis
- Return results
```

**Priority 3: RCA UI**
```typescript
// frontend/src/app/rca/page.tsx
- Display RCA results
- Trigger analysis button
```

### Phase 9: Additional Collectors (Week 13-14)

**Priority by Ease:**
1. Juniper Mist (clean REST API)
2. Arista SD-WAN
3. Arista WLC

For each:
```python
# backend/worker/collectors/{vendor}.py
- Collector implementation
- Normalizer in processors/
- Add to main worker loop
```

### Phase 10: Polish (Week 15-16)

- Real-time updates (SSE)
- Advanced filtering
- Proximity correlation
- Error handling
- Performance optimization
- Documentation
- Demo environment

---

## 10. Migration Path to Microservices (Future)

When scale demands it, split services:

```
Worker → Split by function:
  ├── collector-dnac (dedicated DNAC poller)
  ├── collector-mist (dedicated Mist poller)
  ├── processor (normalization + enrichment)
  ├── correlator (incident detection)
  └── topology-sync (graph maintenance)

API → Split by domain:
  ├── events-api (event queries)
  ├── incidents-api (incident queries)
  ├── topology-api (graph queries)
  └── rca-api (AI analysis)
```

**Benefits of MVP First:**
- Faster development
- Easier debugging
- Lower infra cost
- Validated domain boundaries before splitting

---

## 11. Unified MCP Server (Vendor Abstraction Layer)

### Motivation

Three vendor SDKs currently leak through the codebase: Cisco DNAC's site/device hierarchy, Juniper Mist's org/site/AP model, and VMware VeloCloud's edge/gateway/business-policy model. Each collector hand-rolls auth, pagination, retry, and ID conventions.

A unified MCP server collapses these into one tool surface so:
- LLM-driven flows (RCA today, remediation tomorrow) reason over one schema, not three
- Worker collectors and API services share the same adapters — no duplicated vendor code
- Vendor quirks are isolated to one module per vendor
- A `raw_passthrough` tool keeps the server from becoming a bottleneck when the canonical schema is too narrow

### Where it slots into the architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Vendor APIs (3 vendors, 3 auth stories)         │
│   [Cisco DNAC]   [Juniper Mist]   [VMware VeloCloud SD-WAN] │
└────────────────┬───────────────┬──────────────┬─────────────┘
                 │               │              │
                 ▼               ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Unified MCP Server                          │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Canonical Tools (vendor-agnostic)                  │     │
│  │  list_devices · get_device · list_alarms            │     │
│  │  list_links · list_clients · get_path               │     │
│  │  push_policy · raw_passthrough                      │     │
│  └────────────────────────────────────────────────────┘     │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Adapters: dnac.py · mist.py · velocloud.py         │     │
│  │  Auth: token / api-key / session-cookie             │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────┬─────────────────────────┬────────────────────┘
               │ in-process              │ MCP protocol
               ▼                         ▼
       ┌──────────────────┐      ┌──────────────────┐
       │  Worker Service  │      │ LLM Agents       │
       │  (collectors,    │      │ (RCA via Ollama, │
       │   topology sync) │      │  future remed.)  │
       └──────────────────┘      └──────────────────┘
```

The MCP server is a library the Worker imports in-process AND an MCP-protocol server that LLM agents (Ollama/RCA service) connect to over stdio/HTTP. Same code path, two front doors.

### Canonical Tool Surface (start narrow)

Only model what a real correlation/RCA/remediation flow actually needs. Everything else stays in `raw_passthrough` until a workflow forces normalization.

| Tool | Returns | Notes |
|------|---------|-------|
| `list_devices` | `Device[]` | filters: `site`, `vendor`, `role` |
| `get_device` | `Device` | by `canonical_id` |
| `list_alarms` | `Alarm[]` | filters: time window, severity |
| `list_links` | `Link[]` | topology edges between devices |
| `list_clients` | `Client[]` | wired + wireless clients |
| `get_path` | `PathHop[]` | source → destination path (cross-vendor) |
| `push_policy` | `PolicyResult` | write op; gated by `policy.write` capability |
| `raw_passthrough` | `Any` | `{vendor, endpoint, method, params}` — escape hatch |

Canonical schemas (`Device`, `Alarm`, `Link`, `Client`) reuse `backend/shared/models/` — same canonical IDs that come out of [Section 7](#7-identity-stitching-strategy)'s identity stitcher.

### Adapter Layout

```
backend/mcp/
├── server.py                    # MCP server entry; registers tools
├── tools/
│   ├── devices.py               # list_devices, get_device
│   ├── alarms.py
│   ├── topology.py              # list_links, get_path
│   ├── policy.py                # push_policy
│   └── passthrough.py           # raw_passthrough
├── canonical/                   # Canonical schemas (or re-exports from shared/models)
│   ├── device.py
│   ├── alarm.py
│   ├── link.py
│   └── client.py
├── adapters/
│   ├── base.py                  # Adapter ABC: list_devices(), list_alarms(), ...
│   ├── dnac.py                  # Cisco DNAC adapter
│   ├── mist.py                  # Juniper Mist adapter
│   └── velocloud.py             # VMware VeloCloud SD-WAN adapter
└── auth/
    ├── dnac_session.py          # Token-based, refreshed on 401
    ├── mist_apikey.py           # Static API key in header
    └── velocloud_session.py     # Enterprise login → session cookie
```

### Auth — three different stories, isolated per adapter

- **DNAC**: username/password → bearer token (~1h TTL); refresh on 401
- **Mist**: static API key in header; no refresh
- **VeloCloud**: enterprise login → session cookie; refresh on 401

Each adapter owns its auth state behind `base.py`'s interface; canonical tools never see auth.

### How the existing services use it

- **Worker collectors** call MCP tools in-process instead of vendor SDKs. `worker/collectors/dnac.py` shrinks to "call `mcp.list_alarms(vendor='dnac', since=...)` and feed results to the normalizer." The vendor-specific normalization logic moves into the MCP adapter.
- **API RCA service** calls MCP tools when the LLM needs live device/alarm context during an investigation, instead of going to ClickHouse/Neo4j only.
- **External LLM agents** connect to MCP server over stdio/HTTP for ad-hoc analysis and (later) remediation actions via `push_policy`.

### Vendor scope note

The existing worker (Section 2) lists DNAC, Mist, Arista SD-WAN, Arista WLC. This MCP design uses **DNAC, Mist, VeloCloud** per the updated scope — Arista SD-WAN is replaced by VeloCloud, and Arista WLC's inclusion should be confirmed before adapter work begins. If WLC stays in scope, add a fourth adapter; the canonical tool surface doesn't change.

### When NOT to normalize

`raw_passthrough` exists so the canonical schema can stay small. These hit passthrough first and get promoted only when a real workflow needs them:
- Vendor-specific config primitives (DNAC templates, Mist site variables, VeloCloud business policies)
- Bulk telemetry exports
- Vendor-only entities (Mist Marvis insights, DNAC Assurance issues, VeloCloud QoE scores)

### Suggested rollout

Slot into the existing phased plan without disrupting it:

- **Phase 3 (Worker)**: Build MCP server with one adapter (DNAC) + `list_devices`, `list_alarms`, `raw_passthrough`. Worker DNAC collector calls into it in-process. Proves the abstraction with one vendor before committing to three.
- **Phase 8 (RCA)**: Stand up MCP-over-stdio so the RCA service / Ollama agent can call tools directly during investigation.
- **Phase 9 (Additional Collectors)**: Add Mist + VeloCloud adapters. By this point the canonical surface is validated; new adapters are mechanical.

### Trade-offs

⚠️ One more service abstraction to maintain — pays off only if at least two of {worker, RCA agent, future remediation} consume it.
⚠️ Canonical schema drift is a real risk — keep it narrow, lean on `raw_passthrough`, and resist adding fields that only one vendor populates.
⚠️ In-process + protocol dual mode means the server has to be safe to import as a library AND run as a daemon — design `server.py` accordingly.

---

## Summary

**MVP Architecture Benefits:**
✅ 70% fewer services (2 vs 7 backend)  
✅ Single worker codebase (easier debugging)  
✅ Faster development (less coordination)  
✅ Lower operational complexity  
✅ Same data architecture (ClickHouse + Neo4j + Redis)  
✅ Same event model (UnifiedEvent)  
✅ Clear migration path to microservices  

**Trade-offs:**
⚠️ Worker downtime affects all collection (mitigated by Docker restart)  
⚠️ Can't scale collectors independently (premature for MVP)  
⚠️ Single point of failure for background processing (acceptable for MVP)  

**When to Split Services:**
- When worker consumes >4 CPU cores continuously
- When vendor-specific collectors need different scaling
- When team grows beyond 2 developers
- When uptime requirements demand redundancy

**Current Status:** Ready for Phase 2 implementation (Data Layer)

---

Generated: 2026-05-28  
Version: 2.0 (MVP Architecture)  
Team Size: 2 developers  
Timeline: 12-16 weeks to production MVP
