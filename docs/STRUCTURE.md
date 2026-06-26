# Naxis Monorepo Structure

Complete directory and file structure for the Naxis platform.

## Visual Tree

```
naxis/
│
├── .env                          # Environment variables (git-ignored)
├── .gitignore                    # Git ignore rules
├── README.md                     # Project overview
├── ARCHITECTURE.md               # Architecture white paper
├── STRUCTURE.md                  # This file
├── Makefile                      # Development commands
├── docker-compose.yml            # Production compose file
├── docker-compose.dev.yml        # Development overrides
├── LICENSE                       # License file
│
├── backend/                      # Python backend services
│   │
│   ├── shared/                   # Shared libraries (installed as package)
│   │   ├── __init__.py
│   │   ├── pyproject.toml        # Package definition
│   │   ├── README.md
│   │   ├── models/               # Pydantic models
│   │   │   ├── __init__.py
│   │   │   ├── event.py          # UnifiedEvent, enums
│   │   │   ├── incident.py       # Incident model
│   │   │   └── topology.py       # Graph models
│   │   ├── database/             # Database clients
│   │   │   ├── __init__.py
│   │   │   ├── redis.py          # RedisClient (streams)
│   │   │   ├── clickhouse.py     # ClickHouseClient
│   │   │   └── neo4j.py          # Neo4jClient
│   │   ├── config/               # Configuration
│   │   │   ├── __init__.py
│   │   │   └── settings.py       # Pydantic Settings
│   │   └── utils/                # Utilities
│   │       ├── __init__.py
│   │       ├── logging.py        # JSON logger
│   │       └── retry.py          # Retry decorators
│   │
│   ├── api/                      # API Gateway Service
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   ├── main.py               # FastAPI app entry
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── dependencies.py   # DI singletons
│   │   │   └── routers/          # API routes
│   │   │       ├── __init__.py
│   │   │       ├── health.py     # Health checks
│   │   │       ├── events.py     # Events API
│   │   │       ├── incidents.py  # Incidents API
│   │   │       ├── topology.py   # Topology API
│   │   │       └── rca.py        # RCA API
│   │   └── tests/
│   │       ├── __init__.py
│   │       ├── test_health.py
│   │       └── test_events.py
│   │
│   ├── collectors/               # Vendor API Collectors
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   ├── main.py
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── scheduler.py      # Polling scheduler
│   │   │   └── collectors/
│   │   │       ├── __init__.py
│   │   │       ├── base.py       # Base interface
│   │   │       ├── dnac.py       # Cisco DNAC
│   │   │       ├── mist.py       # Juniper Mist
│   │   │       ├── arista_sdwan.py
│   │   │       └── arista_wlc.py
│   │   └── tests/
│   │       ├── __init__.py
│   │       ├── test_dnac.py
│   │       └── test_mist.py
│   │
│   ├── ingestion/                # Event Normalization
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   ├── main.py
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── consumer.py       # Stream consumer
│   │   │   └── processors/
│   │   │       ├── __init__.py
│   │   │       ├── dnac_processor.py
│   │   │       ├── mist_processor.py
│   │   │       ├── arista_processor.py
│   │   │       └── enrichment.py # Topology enrichment
│   │   └── tests/
│   │       └── __init__.py
│   │
│   ├── correlation/              # Event Correlation
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   ├── main.py
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── consumer.py
│   │   │   ├── incident_manager.py
│   │   │   └── correlators/
│   │   │       ├── __init__.py
│   │   │       ├── time_window.py   # Time-based
│   │   │       ├── proximity.py     # Graph proximity
│   │   │       └── pattern.py       # ML patterns
│   │   └── tests/
│   │       └── __init__.py
│   │
│   ├── topology/                 # Topology Sync
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── README.md
│   │   ├── main.py
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── scheduler.py
│   │   │   ├── graph_queries.py  # Neo4j queries
│   │   │   └── sync/
│   │   │       ├── __init__.py
│   │   │       ├── device_sync.py
│   │   │       ├── link_sync.py
│   │   │       └── client_sync.py
│   │   └── tests/
│   │       └── __init__.py
│   │
│   └── rca/                      # RCA Service
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── README.md
│       ├── main.py
│       ├── app/
│       │   ├── __init__.py
│       │   ├── consumer.py
│       │   ├── ollama_client.py
│       │   └── workflows/
│       │       ├── __init__.py
│       │       └── rca_workflow.py  # LangGraph
│       └── tests/
│           └── __init__.py
│
├── frontend/                     # Next.js Frontend
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── components.json           # shadcn config
│   ├── README.md
│   ├── public/
│   │   ├── favicon.ico
│   │   └── logo.svg
│   └── src/
│       ├── app/                  # App Router
│       │   ├── layout.tsx        # Root layout
│       │   ├── page.tsx          # Home page
│       │   ├── events/
│       │   │   └── page.tsx
│       │   ├── incidents/
│       │   │   └── page.tsx
│       │   ├── topology/
│       │   │   └── page.tsx
│       │   └── rca/
│       │       └── page.tsx
│       ├── components/           # React components
│       │   ├── ui/               # shadcn components
│       │   ├── Navigation.tsx
│       │   ├── EventList.tsx
│       │   ├── IncidentCard.tsx
│       │   └── TopologyGraph.tsx
│       ├── lib/                  # Utilities
│       │   ├── api.ts            # API client
│       │   ├── utils.ts
│       │   └── cn.ts
│       ├── hooks/                # React hooks
│       │   ├── useEvents.ts
│       │   ├── useIncidents.ts
│       │   └── useTopology.ts
│       ├── types/                # TypeScript types
│       │   ├── event.ts
│       │   ├── incident.ts
│       │   └── topology.ts
│       └── styles/
│           └── globals.css
│
├── schemas/                      # Database schemas
│   ├── clickhouse/
│   │   ├── 001_events.sql
│   │   ├── 002_incidents.sql
│   │   └── 003_metrics.sql
│   └── neo4j/
│       ├── 001_constraints.cypher
│       └── 002_indexes.cypher
│
├── config/                       # Configuration
│   ├── .env.example              # Environment template
│   ├── redis.conf                # Redis config (optional)
│   └── clickhouse-config.xml     # ClickHouse config (optional)
│
├── docs/                         # Documentation
│   ├── API.md                    # API documentation
│   ├── DEPLOYMENT.md             # Deployment guide
│   ├── DEVELOPMENT.md            # Dev setup guide
│   └── CONTRIBUTING.md           # Contribution guidelines
│
├── scripts/                      # Utility scripts
│   ├── init-db.sh                # Initialize databases
│   ├── seed-data.sh              # Seed test data
│   ├── backup.sh                 # Backup databases
│   └── healthcheck.sh            # Health check script
│
└── .github/                      # GitHub configuration
    └── workflows/
        ├── ci.yml                # CI pipeline
        └── docker-build.yml      # Docker build workflow
```

## File Count Summary

- **Backend Services**: 7 (shared, api, collectors, ingestion, correlation, topology, rca)
- **Python Packages**: ~30 modules
- **Frontend Pages**: 4 main routes (events, incidents, topology, rca)
- **Dockerfiles**: 7 (1 per service + frontend)
- **Configuration Files**: 10+
- **Documentation Files**: 15+

## Key Files by Category

### Core Configuration
- `.env` - Environment variables (local, git-ignored)
- `config/.env.example` - Environment template (committed)
- `docker-compose.yml` - Production orchestration
- `docker-compose.dev.yml` - Development overrides
- `Makefile` - Development commands

### Backend Core
- `backend/shared/models/event.py` - UnifiedEvent model
- `backend/shared/database/redis.py` - Redis Streams client
- `backend/shared/config/settings.py` - Pydantic Settings
- `backend/api/main.py` - FastAPI application

### Frontend Core
- `frontend/src/app/layout.tsx` - Root layout
- `frontend/src/lib/api.ts` - API client
- `frontend/package.json` - Dependencies
- `frontend/tailwind.config.ts` - Tailwind config

### Database Schemas
- `schemas/clickhouse/001_events.sql` - Events table
- `schemas/neo4j/001_constraints.cypher` - Graph constraints

### Documentation
- `README.md` - Project overview
- `ARCHITECTURE.md` - Technical architecture
- `STRUCTURE.md` - This file

## Next Steps

1. **Create .env file**: `make setup`
2. **Start services**: `make up`
3. **Pull LLM model**: `make ollama`
4. **Initialize schemas**: `make init-db`
5. **Access services**:
   - API: http://localhost:8000/docs
   - Frontend: http://localhost:3000
   - Neo4j Browser: http://localhost:7474

## Development Workflow

```bash
# Initial setup
make setup && make up && make ollama

# Daily development
make logs              # Monitor all services
docker compose exec api bash    # Access service shell

# Making changes
# Backend: Edit files, service auto-reloads
# Frontend: Edit files, Next.js Fast Refresh

# Testing
make test              # Run all tests

# Reset environment
make clean && make up  # Fresh start
```

## Notes

- All Python services share the `backend/shared` package
- Each service has its own `Dockerfile` and `requirements.txt`
- Frontend uses Next.js 14 App Router (not Pages Router)
- All services communicate via REST API or Redis Streams
- Database schemas are versioned with numbered SQL/Cypher files
