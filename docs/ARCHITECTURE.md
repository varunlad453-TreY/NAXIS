# Naxis Platform Architecture
## Unified Enterprise Network Intelligence Platform

**Version:** 1.0  
**Date:** May 2026  
**Status:** Foundation Phase

---

## Executive Summary

Naxis is an open-source operational intelligence platform designed to provide topology-aware network reasoning, telemetry correlation, and AI-assisted root cause analysis. Unlike traditional monitoring tools, Naxis focuses on understanding the "why" behind network events through intelligent correlation and contextual analysis.

Built for small teams with enterprise-grade requirements, Naxis leverages modern event-driven architecture, polyglot persistence, and local AI inference to deliver powerful insights without vendor lock-in or cloud dependencies.

---

## 1. Platform Overview

### 1.1 Purpose and Scope

**What Naxis Is:**
- Operational intelligence platform for network telemetry
- Topology-aware reasoning engine
- Event correlation and incident intelligence system
- AI-assisted root cause analysis framework

**What Naxis Is NOT:**
- Not a monitoring tool (no metric collection agents)
- Not a replacement for existing observability platforms
- Not a network management system
- Not a cloud-based SaaS solution

### 1.2 Core Capabilities

1. **Multi-Vendor Telemetry Normalization**: Unified event schema across Cisco DNAC, Juniper Mist, Arista SD-WAN, and Arista WLC
2. **Topology-Aware Correlation**: Network graph-based event correlation using Neo4j
3. **Incident Intelligence**: Time-series analysis and pattern detection with ClickHouse
4. **AI-Assisted RCA**: Local LLM inference via Ollama with LangGraph workflows
5. **Real-Time Event Processing**: Redis Streams-based event bus architecture

### 1.3 Design Principles

- **Open Source First**: 100% free and self-hosted components
- **Small Team Optimized**: Docker Compose deployment on single laptop
- **Developer Experience**: Hot-reload, structured logging, health checks
- **Production Patterns**: Async I/O, connection pooling, graceful shutdown
- **Future-Ready**: Extensible architecture for AI workflows and advanced analytics

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend Layer                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js 14 (App Router) + TanStack Query + shadcn  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                          HTTP/REST
                              │
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          FastAPI + ASGI + CORS + Health Checks       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
┌───────────────────┐ ┌──────────────┐ ┌──────────────┐
│  ClickHouse DB    │ │  Neo4j Graph │ │ Redis Streams│
│  (Events/Metrics) │ │  (Topology)  │ │ (Event Bus)  │
└───────────────────┘ └──────────────┘ └──────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Processing Services                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Collectors  │  │ Ingestion   │  │ Correlation │        │
│  │   Service   │  │   Service   │  │   Service   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Topology   │  │     RCA     │  │   Ollama    │        │
│  │   Service   │  │   Service   │  │  (LLM Host) │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────┐
│                     Integration Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Cisco   │  │ Juniper  │  │  Arista  │  │  Arista  │   │
│  │   DNAC   │  │   Mist   │  │  SD-WAN  │  │   WLC    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Architecture Layers

#### Frontend Layer
- **Technology**: Next.js 14 with App Router
- **State Management**: TanStack Query for server state
- **UI Components**: shadcn/ui + Tailwind CSS
- **Visualization**: React Flow for topology graphs
- **API Communication**: Axios-based ApiClient with retry logic

#### API Gateway Layer
- **Framework**: FastAPI with async/await
- **Middleware**: CORS, request logging, exception handling
- **Dependency Injection**: Singleton database clients
- **Health Checks**: Readiness and liveness probes
- **API Versioning**: `/api/v1/` prefix pattern

#### Data Layer (Polyglot Persistence)
- **ClickHouse**: Time-series events and metrics storage
  - Partitioned by date for query performance
  - TTL-based data retention (90 days default)
  - Bloom filter indexes on device/site/client identifiers
  
- **Neo4j Community**: Network topology graph
  - Nodes: Sites, Devices, Clients, Links
  - Relationships: CONNECTED_TO, BELONGS_TO, ROUTES_THROUGH
  - APOC plugin for graph algorithms
  
- **Redis**: Event streaming and caching
  - Streams for event bus with consumer groups
  - Pub/Sub for real-time notifications
  - Cache for frequently accessed topology data

#### Processing Services Layer

**Collectors Service**
- Polls vendor APIs at configurable intervals
- Transforms vendor-specific data to internal format
- Publishes raw events to Redis Streams
- Maintains vendor API session state

**Ingestion Service**
- Consumes raw events from Redis Streams
- Normalizes to UnifiedEvent schema
- Enriches with topology context
- Persists to ClickHouse events table

**Correlation Service**
- Time-window based event correlation
- Proximity detection using Neo4j graph queries
- Incident creation and aggregation
- Pattern learning from historical incidents

**Topology Service**
- Syncs network topology from vendor APIs
- Maintains Neo4j graph model
- Detects topology changes
- Calculates graph metrics (centrality, paths)

**RCA Service**
- AI-assisted root cause analysis
- Integrates Ollama for local LLM inference
- Future: LangGraph workflows for multi-step reasoning
- Generates human-readable explanations

#### Integration Layer
- **Cisco DNAC**: REST API with token-based auth
- **Juniper Mist**: REST API with API key auth
- **Arista SD-WAN**: REST API with session-based auth
- **Arista WLC**: REST API with token-based auth

---

## 3. Data Architecture

### 3.1 Unified Event Model

```python
class UnifiedEvent:
    event_id: str              # UUID
    source: EventSource        # dnac|mist|arista_sdwan|arista_wlc
    timestamp: datetime        # UTC timezone-aware
    event_type: str           # Vendor-specific type
    category: EventCategory    # device|client|network|wireless|sdwan|security|performance
    severity: EventSeverity    # critical|major|minor|warning|info
    title: str                # Human-readable summary
    description: str          # Detailed message
    device_id: Optional[str]  # Normalized device identifier
    site_id: Optional[str]    # Normalized site identifier
    client_mac: Optional[str] # Client MAC address
    metrics: Dict[str, float] # Key-value metrics
    tags: List[str]           # Searchable tags
    raw_data: Dict[str, Any]  # Original vendor payload
```

**Design Rationale:**
- Vendor-agnostic schema allows unified querying
- Preserves raw data for forensic analysis
- Structured metrics enable time-series analysis
- Tags provide flexible categorization

### 3.2 Topology Model (Neo4j)

```cypher
// Node Types
(:Site {site_id, name, location, vendor})
(:Device {device_id, name, model, ip_address, site_id, role, status})
(:Client {mac_address, hostname, ip_address, device_id})
(:Link {link_id, bandwidth, latency, source_device, target_device})

// Relationships
(Site)-[:CONTAINS]->(Device)
(Device)-[:CONNECTED_TO]->(Device)
(Client)-[:CONNECTED_TO]->(Device)
(Device)-[:BELONGS_TO]->(Site)
```

**Graph Queries:**
- Impact analysis: "Which clients are affected by this device failure?"
- Path analysis: "What are alternate routes between sites A and B?"
- Proximity detection: "Which devices are within 2 hops of this failure?"

### 3.3 Event Storage (ClickHouse)

```sql
-- Events Table
CREATE TABLE events (
    event_id String,
    source LowCardinality(String),
    timestamp DateTime64(3),
    event_type LowCardinality(String),
    category LowCardinality(String),
    severity LowCardinality(String),
    title String,
    device_id Nullable(String),
    site_id Nullable(String),
    client_mac Nullable(String),
    metrics Map(String, Float64),
    tags Array(String),
    raw_data String  -- JSON
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (source, timestamp, event_id)
TTL timestamp + INTERVAL 90 DAY;

-- Indexes
INDEX idx_device_id device_id TYPE bloom_filter
INDEX idx_site_id site_id TYPE bloom_filter
INDEX idx_client_mac client_mac TYPE bloom_filter
```

**Query Patterns:**
- Time-range queries: "All critical events in last 24 hours"
- Device-centric: "Event timeline for device X"
- Site-level aggregation: "Event distribution by site"
- Correlation windows: "Events within 5-minute window"

---

## 4. Event-Driven Architecture

### 4.1 Redis Streams Flow

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Collectors  │────▶│  raw-events      │────▶│  Ingestion    │
│   Service    │     │   Stream         │     │   Service     │
└──────────────┘     └──────────────────┘     └───────────────┘
                                                       │
                                                       ▼
┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│ Correlation  │◀────│ unified-events   │◀────│  ClickHouse   │
│   Service    │     │    Stream        │     │   Insert      │
└──────────────┘     └──────────────────┘     └───────────────┘
       │                                              
       ▼                                              
┌──────────────┐     ┌──────────────────┐            
│  RCA Service │◀────│ incidents        │            
│              │     │   Stream         │            
└──────────────┘     └──────────────────┘            
```

### 4.2 Stream Semantics

**Stream: `raw-events`**
- Producer: Collectors service
- Consumer Group: `ingestion-group`
- Message Format: Vendor-specific JSON payloads
- Retention: 24 hours

**Stream: `unified-events`**
- Producer: Ingestion service
- Consumer Groups: `correlation-group`, `topology-group`
- Message Format: UnifiedEvent JSON
- Retention: 7 days

**Stream: `incidents`**
- Producer: Correlation service
- Consumer Group: `rca-group`
- Message Format: Incident JSON with correlated event IDs
- Retention: 30 days

### 4.3 Consumer Group Strategy

Each consumer service uses Redis consumer groups for:
- **At-least-once delivery**: Messages acknowledged after processing
- **Load balancing**: Multiple replicas share work (future scaling)
- **Failure recovery**: Pending messages reassigned after timeout
- **Idempotency**: Event IDs used for deduplication

---

## 5. Service Design Patterns

### 5.1 Shared Libraries

```
backend/shared/
├── models/
│   ├── event.py          # UnifiedEvent, enums
│   ├── incident.py       # Incident model
│   └── topology.py       # Node/Edge models
├── database/
│   ├── redis.py          # RedisClient with streams
│   ├── clickhouse.py     # ClickHouseClient
│   └── neo4j.py          # Neo4jClient
├── config/
│   └── settings.py       # Pydantic Settings
└── utils/
    ├── logging.py        # JSON formatter
    └── retry.py          # Retry decorators
```

**Benefits:**
- Code reuse across all services
- Consistent data models
- Shared database clients
- Centralized configuration

### 5.2 Service Template

```python
# Standard service structure
import asyncio
from contextlib import asynccontextmanager
from backend.shared.config import settings
from backend.shared.database import get_redis
from backend.shared.utils.logging import setup_logging

logger = setup_logging(settings.service_name)

@asynccontextmanager
async def lifespan():
    """Startup and shutdown lifecycle."""
    logger.info(f"Starting {settings.service_name}...")
    redis = get_redis()
    await redis.ping()
    yield
    logger.info("Shutting down...")
    await redis.close()

async def process_stream(stream_name: str):
    """Main processing loop."""
    redis = get_redis()
    while True:
        messages = await redis.xreadgroup(
            groupname=f"{settings.service_name}-group",
            consumername=settings.service_name,
            streams={stream_name: ">"},
            count=10,
            block=1000
        )
        for stream, msgs in messages:
            for msg_id, data in msgs:
                await process_message(data)
                await redis.xack(stream, f"{settings.service_name}-group", msg_id)

async def main():
    async with lifespan():
        await process_stream("unified-events")

if __name__ == "__main__":
    asyncio.run(main())
```

### 5.3 Health Check Pattern

All services expose:
- **`/health/live`**: Process is alive (200 OK)
- **`/health/ready`**: All dependencies healthy
  - Redis connection
  - ClickHouse connection
  - Neo4j connection
  - Stream consumer status

Used by Docker health checks and future orchestration systems.

---

## 6. AI/ML Integration Strategy

### 6.1 Ollama Local Inference

**Model Selection:**
- **Default**: Llama 3.1 8B (fits on 16GB RAM laptop)
- **Alternative**: Mistral 7B, Phi-3, or CodeLlama for specific tasks
- **No Cloud APIs**: All inference runs locally

**Use Cases:**
1. **Event Summarization**: Generate human-readable incident summaries
2. **RCA Suggestions**: Analyze correlated events and suggest root causes
3. **Natural Language Queries**: "Why is Site A experiencing latency?"
4. **Anomaly Explanations**: Explain detected patterns in plain language

### 6.2 LangGraph Workflows (Future)

```python
# Example RCA workflow
from langgraph.graph import Graph

workflow = Graph()
workflow.add_node("gather_context", gather_topology_and_events)
workflow.add_node("analyze_patterns", detect_correlation_patterns)
workflow.add_node("generate_hypothesis", llm_hypothesis_generation)
workflow.add_node("validate_hypothesis", query_historical_incidents)
workflow.add_node("explain_rca", llm_explanation_generation)

workflow.add_edge("gather_context", "analyze_patterns")
workflow.add_edge("analyze_patterns", "generate_hypothesis")
workflow.add_edge("generate_hypothesis", "validate_hypothesis")
workflow.add_edge("validate_hypothesis", "explain_rca")
```

**Benefits:**
- Multi-step reasoning with state management
- Tool calling for database queries
- Human-in-the-loop for validation
- Explainable AI decision paths

---

## 7. Deployment Architecture

### 7.1 Docker Compose Stack

```yaml
# Production: docker-compose.yml
services:
  redis:         # Event bus + cache
  clickhouse:    # Time-series storage
  neo4j:         # Graph database
  ollama:        # LLM inference
  api:           # API Gateway (port 8000)
  collectors:    # Vendor API polling
  ingestion:     # Event normalization
  correlation:   # Incident detection
  topology:      # Graph sync
  rca:           # AI-assisted RCA
  web:           # Frontend (port 3000)

# Development: docker-compose.dev.yml (override)
services:
  api:
    volumes:
      - ./backend/api:/app  # Hot-reload
  web:
    volumes:
      - ./frontend:/app     # Hot-reload
```

### 7.2 Resource Requirements

**Minimum (Development):**
- **CPU**: 4 cores
- **RAM**: 16 GB
- **Disk**: 50 GB SSD
- **OS**: Ubuntu 20.04+

**Recommended (Production):**
- **CPU**: 8 cores
- **RAM**: 32 GB
- **Disk**: 200 GB NVMe SSD
- **OS**: Ubuntu 22.04 LTS

### 7.3 Data Volumes

```
naxis_clickhouse_data:  # Event/incident storage (~1GB/day)
naxis_neo4j_data:       # Topology graph (~100MB)
naxis_redis_data:       # Stream buffers (~500MB)
naxis_ollama_models:    # LLM models (~8GB for Llama 3.1 8B)
```

**Backup Strategy:**
- ClickHouse: Daily snapshots to external storage
- Neo4j: Weekly graph dumps
- Redis: No backup needed (transient streams)
- Ollama: Models re-downloaded if lost

---

## 8. Development Workflow

### 8.1 Quick Start

```bash
# Clone repository
git clone <repo-url> naxis && cd naxis

# Setup environment
make setup  # Creates .env from .env.example

# Start services
make up     # docker compose up -d

# View logs
make logs   # docker compose logs -f

# Pull LLM model
make ollama # docker compose exec ollama ollama pull llama3.1:8b

# Access applications
# API:      http://localhost:8000
# Frontend: http://localhost:3000
# Neo4j:    http://localhost:7474
```

### 8.2 Development Commands

```bash
# Rebuild after code changes
make rebuild

# Clean all data and rebuild
make clean && make up

# Run Python tests
docker compose exec api pytest

# Run frontend tests
docker compose exec web npm test

# Access service shell
docker compose exec api bash
docker compose exec web sh
```

### 8.3 Hot-Reload Configuration

- **Backend**: Uvicorn with `--reload` flag watches `*.py` files
- **Frontend**: Next.js Fast Refresh watches `src/**/*` files
- **Shared modules**: Mounted as volumes in all backend services

---

## 9. Security Considerations

### 9.1 Authentication (Future)

**Phase 1 (Current)**: No authentication - trusted internal network
**Phase 2 (Planned)**: 
- JWT-based API authentication
- OAuth2/OIDC integration for SSO
- Role-based access control (RBAC)

### 9.2 Data Protection

- **Vendor Credentials**: Stored in `.env` file (not committed)
- **Database Passwords**: Rotated quarterly
- **API Keys**: Scoped to minimum required permissions
- **Network Isolation**: Docker bridge network `naxis-net`

### 9.3 Compliance

- **Data Retention**: TTL-based cleanup (90 days events, 30 days incidents)
- **PII Handling**: No customer data collection (network telemetry only)
- **Audit Logging**: All API requests logged with request ID

---

## 10. Observability

### 10.1 Structured Logging

```python
# JSON format with context
{
  "timestamp": "2026-05-28T10:30:00.000Z",
  "service": "correlation-service",
  "level": "INFO",
  "message": "Incident created",
  "context": {
    "incident_id": "inc-123",
    "event_count": 5,
    "severity": "critical",
    "site_id": "site-abc"
  }
}
```

**Log Aggregation (Future):**
- Vector or Fluent Bit for log collection
- Loki for log storage and querying
- Grafana for visualization

### 10.2 Metrics (Future)

**Key Metrics:**
- Event ingestion rate (events/sec)
- Event processing latency (p50, p95, p99)
- Correlation accuracy (true positive rate)
- Database query performance
- LLM inference time
- API response times

**Metrics Stack:**
- Prometheus for metrics collection
- Grafana for dashboards
- AlertManager for alerting

### 10.3 Tracing (Future)

- OpenTelemetry instrumentation
- Jaeger for distributed tracing
- Trace correlation with event IDs

---

## 11. Testing Strategy

### 11.1 Unit Tests

```
backend/api/tests/
├── test_routers.py       # API endpoint tests
├── test_dependencies.py  # Dependency injection tests
└── test_utils.py         # Utility function tests

backend/collectors/tests/
├── test_dnac_collector.py
├── test_mist_collector.py
└── test_normalization.py
```

**Coverage Target**: 80% code coverage

### 11.2 Integration Tests

```python
# Example: Redis Streams integration
async def test_event_flow():
    # Publish event
    event_id = await redis.xadd("raw-events", {"data": "..."})
    
    # Wait for processing
    await asyncio.sleep(1)
    
    # Verify stored in ClickHouse
    events = clickhouse.execute("SELECT * FROM events WHERE event_id = %(id)s", {"id": event_id})
    assert len(events) == 1
```

### 11.3 E2E Tests (Future)

- Playwright for frontend testing
- Mock vendor API responses
- Verify end-to-end event flow
- Test RCA workflow generation

---

## 12. Performance Characteristics

### 12.1 Expected Throughput

**Phase 1 Target:**
- **Event Ingestion**: 100 events/sec
- **Correlation Latency**: < 5 seconds
- **API Response Time**: < 200ms (p95)
- **Topology Sync**: < 1 minute for full refresh

**Scale Limitations (Docker Compose):**
- Single-node deployment
- No horizontal scaling
- Suitable for 1,000-10,000 devices

### 12.2 Bottlenecks

1. **ClickHouse Inserts**: Batch inserts every 1 second
2. **Neo4j Queries**: Complex graph traversals (>3 hops)
3. **LLM Inference**: 2-5 seconds per RCA analysis
4. **Redis Streams**: Consumer lag during burst traffic

### 12.3 Optimization Opportunities

- Connection pooling for databases
- Message batching in stream consumers
- Caching frequent topology queries
- Async I/O throughout stack

---

## 13. Migration to Production (Future)

### 13.1 Kubernetes Migration Path

When scaling beyond Docker Compose:

1. **Containerization**: Already complete (Docker images)
2. **Helm Charts**: Package services as Helm releases
3. **StatefulSets**: For stateful services (databases)
4. **Horizontal Pod Autoscaling**: Scale processing services
5. **Ingress**: Replace port mappings with ingress rules
6. **Persistent Volumes**: Migrate Docker volumes to PVCs

### 13.2 Database Scaling

**ClickHouse:**
- Shard data by site_id or timestamp
- Replicate for query load distribution
- Use ClickHouse Keeper for coordination

**Neo4j:**
- Migrate to Neo4j Enterprise for clustering
- Or switch to JanusGraph + ScyllaDB for sharding

**Redis:**
- Redis Cluster for horizontal scaling
- Redis Sentinel for high availability

### 13.3 Service Mesh (Optional)

- Istio or Linkerd for service-to-service communication
- mTLS between services
- Traffic management and canary deployments

---

## 14. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2) ✅
- [x] Monorepo structure
- [x] Docker Compose setup
- [x] Shared libraries and models
- [x] Health check infrastructure
- [x] Development workflow

### Phase 2: Telemetry Collection (Weeks 3-4)
- [ ] Cisco DNAC collector
- [ ] Juniper Mist collector
- [ ] Arista SD-WAN collector
- [ ] Arista WLC collector
- [ ] Vendor API authentication
- [ ] Polling scheduler

### Phase 3: Event Normalization (Weeks 5-6)
- [ ] Ingestion service implementation
- [ ] Vendor-to-UnifiedEvent transformers
- [ ] ClickHouse event persistence
- [ ] Redis Streams publishing
- [ ] Event deduplication

### Phase 4: Topology Sync (Weeks 7-8)
- [ ] Topology service implementation
- [ ] Neo4j graph model creation
- [ ] Topology change detection
- [ ] Graph query API endpoints

### Phase 5: Correlation Engine (Weeks 9-10)
- [ ] Correlation service implementation
- [ ] Time-window correlation logic
- [ ] Proximity-based correlation
- [ ] Incident creation and aggregation
- [ ] Pattern learning

### Phase 6: AI Foundation (Weeks 11-12)
- [ ] RCA service implementation
- [ ] Ollama integration
- [ ] LangGraph workflow skeleton
- [ ] Event summarization
- [ ] Basic RCA suggestions

### Phase 7: Frontend (Weeks 13-14)
- [ ] Event list and filtering
- [ ] Incident timeline view
- [ ] Topology graph visualization
- [ ] RCA results display

### Phase 8: Polish (Weeks 15-16)
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] Documentation completion
- [ ] Demo environment

---

## 15. Open Questions and Future Work

### 15.1 Open Questions

1. **Event Retention**: Is 90 days sufficient, or should we archive to S3-compatible storage?
2. **LLM Model Selection**: Should we support multiple models for different tasks?
3. **Authentication**: OAuth2 vs. SAML for enterprise SSO?
4. **Multi-Tenancy**: Support multiple teams/organizations in single deployment?
5. **Alerting**: Integrate with PagerDuty/Slack or build custom alerting?

### 15.2 Future Features

**Short-term (3-6 months):**
- Webhook support for real-time event ingestion
- Custom correlation rule engine
- Incident notes and collaboration features
- Export/import for incident playbooks

**Medium-term (6-12 months):**
- Change correlation (correlate incidents with change events)
- Capacity forecasting using time-series analysis
- Integration with CMDB/ServiceNow
- Mobile app for incident response

**Long-term (12+ months):**
- Predictive failure detection using ML
- Automated remediation workflows
- Multi-site federated deployment
- Vendor-neutral network automation

---

## 16. Conclusion

Naxis represents a modern approach to network operational intelligence, combining:
- **Event-driven architecture** for real-time processing
- **Graph-based reasoning** for topology-aware correlation
- **Local AI inference** for intelligent analysis
- **Open-source components** for cost-effectiveness and transparency

The platform is designed to grow from a 2-developer laptop deployment to enterprise-scale Kubernetes clusters, while maintaining clean architecture and developer ergonomics.

**Current Status**: Foundation phase complete, ready for Phase 2 implementation.

**Next Steps**: Begin implementing vendor collectors (Cisco DNAC, Juniper Mist) and establish end-to-end event flow through ingestion service.

---

## Appendix A: Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Backend Framework | FastAPI | 0.115+ | API Gateway and services |
| Frontend Framework | Next.js | 14+ | Web UI with App Router |
| Time-series DB | ClickHouse | 23.8+ | Event/metric storage |
| Graph DB | Neo4j Community | 5.15+ | Topology graph |
| Event Bus | Redis | 7+ | Streams and caching |
| LLM Runtime | Ollama | Latest | Local inference |
| AI Framework | LangGraph | Latest | Multi-step workflows |
| Orchestration | Docker Compose | 2.20+ | Local deployment |
| Language (Backend) | Python | 3.11+ | Async/await support |
| Language (Frontend) | TypeScript | 5+ | Type safety |
| UI Library | shadcn/ui | Latest | Component library |
| Visualization | React Flow | Latest | Topology graphs |
| State Management | TanStack Query | 5+ | Server state |
| Testing | pytest, Playwright | Latest | Unit and E2E tests |

## Appendix B: Environment Variables

See [.env.example](config/.env.example) for complete list of configuration variables.

## Appendix C: API Documentation

Once services are running, access:
- **API Docs**: http://localhost:8000/docs (Swagger UI)
- **API Redoc**: http://localhost:8000/redoc (ReDoc)
- **Neo4j Browser**: http://localhost:7474

## Appendix D: Glossary

- **UnifiedEvent**: Vendor-agnostic event schema
- **Incident**: Group of correlated events
- **Topology**: Network graph of devices and connections
- **RCA**: Root Cause Analysis
- **Stream**: Redis Streams message queue
- **Consumer Group**: Redis Streams consumer coordination
- **Polyglot Persistence**: Multiple database types for different use cases
- **Lifespan**: FastAPI startup/shutdown lifecycle management

---

**Document Version**: 1.0  
**Last Updated**: 2026-05-28  
**Authors**: Naxis Development Team  
**License**: MIT (pending)
