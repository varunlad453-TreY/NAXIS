# Naxis MVP Structure - Simplified for 2-Person Team

**Version:** 2.0  
**Date:** 2026-05-28  
**Services:** 2 backend services (down from 7)

---

## Simplified Directory Structure

```
naxis/
├── .env                              # Environment variables (git-ignored)
├── .gitignore
├── README.md
├── ARCHITECTURE.md                   # Original architecture (reference)
├── MVP_ARCHITECTURE.md               # ✨ NEW: Simplified architecture
├── STRUCTURE.md                      # Original structure
├── MVP_STRUCTURE.md                  # ✨ This file
├── Makefile
├── docker-compose.yml                # ✨ UPDATED: 7 services (4 infra + 3 app)
├── docker-compose.dev.yml            # ✨ NEW: Development overrides
│
├── backend/
│   ├── shared/                       # Common libraries (unchanged)
│   │   ├── pyproject.toml
│   │   ├── models/
│   │   │   ├── event.py
│   │   │   ├── incident.py
│   │   │   ├── topology.py
│   │   │   └── identity.py          # ✨ NEW: Identity stitching
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
│   ├── worker/                       # ✨ NEW: Consolidated worker service
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   ├── main.py                  # Main event loop
│   │   ├── collectors/              # Vendor API collectors
│   │   │   ├── __init__.py
│   │   │   ├── dnac.py
│   │   │   ├── mist.py
│   │   │   ├── arista_sdwan.py
│   │   │   └── arista_wlc.py
│   │   ├── processors/              # Event normalization
│   │   │   ├── __init__.py
│   │   │   ├── normalizer.py
│   │   │   └── enrichment.py
│   │   ├── topology/                # Topology sync
│   │   │   ├── __init__.py
│   │   │   ├── device_sync.py
│   │   │   ├── link_sync.py
│   │   │   └── client_sync.py
│   │   ├── correlation/             # Event correlation
│   │   │   ├── __init__.py
│   │   │   ├── time_window.py
│   │   │   ├── proximity.py
│   │   │   └── incident_manager.py
│   │   └── scheduler.py             # Task scheduling
│   │
│   └── api/                          # FastAPI service (simplified)
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── README.md
│       ├── main.py                  # FastAPI app entry
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── health.py
│       │   ├── events.py
│       │   ├── incidents.py
│       │   ├── topology.py
│       │   ├── rca.py
│       │   └── stream.py            # ✨ NEW: SSE endpoint
│       ├── services/                # ✨ NEW: Business logic layer
│       │   ├── __init__.py
│       │   ├── event_service.py
│       │   ├── incident_service.py
│       │   ├── topology_service.py
│       │   └── rca_service.py
│       └── dependencies.py
│
├── frontend/                         # Next.js (unchanged)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── components.json
│   └── src/
│       ├── app/
│       ├── components/
│       ├── lib/
│       ├── hooks/
│       ├── types/
│       └── styles/
│
├── schemas/
│   ├── clickhouse/
│   │   ├── 001_events.sql
│   │   ├── 002_incidents.sql
│   │   ├── 003_metrics.sql
│   │   └── 004_identity_map.sql     # ✨ NEW: Identity mapping
│   └── neo4j/
│       ├── 001_constraints.cypher
│       └── 002_indexes.cypher
│
├── config/
│   └── .env.example
│
├── docs/
│   ├── MVP_ARCHITECTURE.md          # ✨ NEW: Detailed MVP design
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── DEVELOPMENT.md
│
├── scripts/
│   ├── init-db.sh
│   ├── seed-data.sh
│   └── backup.sh
│
└── .github/
    └── workflows/
        ├── ci.yml
        └── docker-build.yml
```

---

## Service Comparison: Before vs After

### Before (Original Architecture)

```
Backend Services (7):
├── shared        # Library
├── api           # API Gateway
├── collectors    # Vendor polling
├── ingestion     # Normalization
├── correlation   # Event correlation
├── topology      # Graph sync
└── rca           # AI analysis

Docker Compose: 11 containers
├── 4 infrastructure (Redis, ClickHouse, Neo4j, Ollama)
└── 7 application (api, collectors, ingestion, correlation, topology, rca, web)
```

### After (MVP Architecture)

```
Backend Services (2):
├── shared        # Library (unchanged)
├── worker        # ✨ Consolidates: collectors + ingestion + topology + correlation
└── api           # ✨ Simplified: REST endpoints + RCA on-demand

Docker Compose: 7 containers
├── 4 infrastructure (Redis, ClickHouse, Neo4j, Ollama)
└── 3 application (worker, api, web)
```

**Reduction:**
- Backend services: 7 → 2 (71% reduction)
- Total containers: 11 → 7 (36% reduction)
- Codebase complexity: ~50% reduction

---

## Worker Service Internal Structure

The worker consolidates all background processing into a single service:

```python
# backend/worker/main.py
async def main():
    logger.info("Starting Naxis Worker...")
    
    # Initialize database connections
    redis = get_redis()
    clickhouse = get_clickhouse()
    neo4j = get_neo4j()
    
    while True:
        try:
            # Run all tasks in parallel
            await asyncio.gather(
                # Collection & Processing
                collect_and_process_dnac(),      # collectors/dnac.py
                collect_and_process_mist(),      # collectors/mist.py
                collect_and_process_arista_sdwan(),
                collect_and_process_arista_wlc(),
                
                # Topology Sync
                sync_topology(),                 # topology/device_sync.py
                
                # Correlation
                run_correlation_check(),         # correlation/time_window.py
            )
            
            logger.info("Worker cycle completed successfully")
            
        except Exception as e:
            logger.error(f"Worker cycle failed: {e}", exc_info=True)
        
        # Wait for next cycle
        await asyncio.sleep(settings.collection_interval)

if __name__ == "__main__":
    asyncio.run(main())
```

**Key Point:** All background processing happens in ONE service, ONE codebase, ONE deployment unit.

---

## API Service Structure

The API service is now purely a query gateway with on-demand RCA:

```python
# backend/api/main.py
from fastapi import FastAPI
from .routers import health, events, incidents, topology, rca, stream

app = FastAPI(title="Naxis API", version="2.0.0")

# Register routers
app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(events.router, prefix="/api/v1/events", tags=["events"])
app.include_router(incidents.router, prefix="/api/v1/incidents", tags=["incidents"])
app.include_router(topology.router, prefix="/api/v1/topology", tags=["topology"])
app.include_router(rca.router, prefix="/api/v1/rca", tags=["rca"])
app.include_router(stream.router, prefix="/api/v1/stream", tags=["stream"])
```

**Services Layer:**
```python
# backend/api/services/event_service.py
class EventService:
    def __init__(self, clickhouse: ClickHouseClient):
        self.clickhouse = clickhouse
    
    async def list_events(
        self,
        start_time: datetime,
        end_time: datetime,
        severity: Optional[List[str]] = None,
        source: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[UnifiedEvent]:
        """Query events from ClickHouse with filters"""
        query = """
            SELECT * FROM events
            WHERE timestamp BETWEEN %(start)s AND %(end)s
        """
        params = {"start": start_time, "end": end_time}
        
        if severity:
            query += " AND severity IN %(severities)s"
            params["severities"] = severity
        
        if source:
            query += " AND source IN %(sources)s"
            params["sources"] = source
        
        query += " ORDER BY timestamp DESC LIMIT %(limit)s OFFSET %(offset)s"
        params.update({"limit": limit, "offset": offset})
        
        rows = self.clickhouse.query(query, params)
        return [UnifiedEvent(**row) for row in rows]
```

---

## Data Flow

### Collection Flow (Worker)

```
1. Poll Vendor API
   └─> collectors/dnac.py: fetch_events()
   
2. Normalize Event
   └─> processors/normalizer.py: normalize_dnac_event()
   
3. Stitch Identity
   └─> models/identity.py: stitch_device_identity()
   
4. Enrich with Topology
   └─> processors/enrichment.py: enrich_event()
   
5. Store in ClickHouse
   └─> database/clickhouse.py: insert("events", ...)
   
6. Publish to Redis
   └─> database/redis.py: publish("naxis:events", ...)
   
7. Correlate Events (end of cycle)
   └─> correlation/time_window.py: correlate_recent_events()
   
8. Create Incidents
   └─> correlation/incident_manager.py: create_incident()
```

### Query Flow (API)

```
1. HTTP Request
   └─> routers/events.py: list_events()
   
2. Business Logic
   └─> services/event_service.py: list_events()
   
3. Database Query
   └─> database/clickhouse.py: query()
   
4. Response
   └─> Return JSON to client
```

### Real-Time Flow (API + Worker)

```
Worker:                     API:                      Frontend:
  │                          │                           │
  ├─ Publish event           │                           │
  │  to Redis Pub/Sub        │                           │
  │                          │                           │
  │                          ├─ Subscribe to channel     │
  │                          │                           │
  │                          ├─ Receive message          │
  │                          │                           │
  │                          ├─ Send via SSE ───────────>│
  │                          │                           │
  │                          │                           └─ Update UI
```

---

## Docker Compose Services

### Infrastructure (4 services)

1. **redis**: Pub/Sub + caching
2. **clickhouse**: Time-series storage
3. **neo4j**: Graph database
4. **ollama**: LLM inference

### Application (3 services)

5. **worker**: Background processing daemon
6. **api**: REST API gateway
7. **web**: Next.js frontend

### Development Additions (docker-compose.dev.yml)

8. **adminer**: ClickHouse web UI (port 8080)
9. **redis-commander**: Redis web UI (port 8081)

---

## Key Files

### Configuration
- `docker-compose.yml` - Production stack
- `docker-compose.dev.yml` - Development overrides
- `.env` - Environment variables
- `config/.env.example` - Template

### Backend Worker
- `backend/worker/main.py` - Entry point
- `backend/worker/Dockerfile` - Multi-stage build
- `backend/worker/requirements.txt` - Dependencies
- `backend/worker/README.md` - Documentation

### Backend API
- `backend/api/main.py` - FastAPI app
- `backend/api/Dockerfile` - Multi-stage build
- `backend/api/requirements.txt` - Dependencies
- `backend/api/README.md` - Documentation

### Shared Libraries
- `backend/shared/models/incident.py` - Incident model
- `backend/shared/models/identity.py` - Identity stitching
- `backend/shared/database/*.py` - Database clients

### Database Schemas
- `schemas/clickhouse/001_events.sql`
- `schemas/clickhouse/002_incidents.sql`
- `schemas/clickhouse/004_identity_map.sql`
- `schemas/neo4j/001_constraints.cypher`

### Documentation
- `docs/MVP_ARCHITECTURE.md` - Complete MVP design
- `MVP_STRUCTURE.md` - This file

---

## Development Workflow

### Initial Setup

```bash
# 1. Create .env file
make setup

# 2. Edit .env with vendor credentials
nano .env

# 3. Start all services
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 4. Pull LLM model
make ollama

# 5. Initialize database schemas
make init-db

# 6. Check service health
docker compose ps
```

### Daily Development

```bash
# View logs (all services)
docker compose logs -f

# View worker logs only
docker compose logs -f worker

# View API logs only
docker compose logs -f api

# Restart worker after code changes
docker compose restart worker

# Rebuild worker
docker compose up -d --build worker

# Access worker shell
docker compose exec worker bash

# Access API shell
docker compose exec api bash

# Run tests
docker compose exec worker pytest
docker compose exec api pytest
```

### Debugging

```bash
# Enable debug logging
# Edit .env: LOG_LEVEL=DEBUG
docker compose restart worker api

# Check database connections
docker compose exec worker python -c "from shared.database.redis import get_redis; import asyncio; asyncio.run(get_redis().ping())"

# Manually trigger collection cycle
docker compose exec worker python -c "from worker.collectors.dnac import collect_dnac_events; import asyncio; asyncio.run(collect_dnac_events())"

# Query ClickHouse directly
docker compose exec clickhouse clickhouse-client --query "SELECT COUNT(*) FROM naxis.events"

# Query Neo4j directly
docker compose exec neo4j cypher-shell -u neo4j -p naxis_password "MATCH (n:Device) RETURN count(n)"
```

---

## Migration Notes

### From Original Architecture

If you started with the original 7-service architecture:

```bash
# 1. Backup data
make backup

# 2. Stop old services
docker compose down

# 3. Remove old service directories
rm -rf backend/collectors backend/ingestion backend/correlation backend/topology backend/rca

# 4. Create new worker directory
mkdir -p backend/worker/{collectors,processors,topology,correlation}

# 5. Merge code into worker/
# Move collectors/* → worker/collectors/
# Move ingestion/processors/* → worker/processors/
# Move topology/* → worker/topology/
# Move correlation/* → worker/correlation/

# 6. Update imports
# Change: from ingestion.processors import X
# To: from worker.processors import X

# 7. Test worker locally
cd backend/worker
python main.py

# 8. Rebuild containers
docker compose up -d --build
```

---

## Next Steps

See [docs/MVP_ARCHITECTURE.md](docs/MVP_ARCHITECTURE.md) for:
- Complete service responsibilities
- Incident model definition
- Identity stitching strategy
- Development priority order (Phases 2-10)

**Start with Phase 2:** Data Layer (Week 3)
- Implement shared models (event, incident, identity)
- Implement database clients
- Create database schemas

---

Generated: 2026-05-28  
Version: 2.0 (MVP)  
Team Size: 2 developers  
Complexity: 50% reduction from original
