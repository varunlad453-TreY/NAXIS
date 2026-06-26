# Naxis - Unified Enterprise Network Intelligence Platform

Open-source operational intelligence platform for network telemetry correlation, topology-aware reasoning, and AI-assisted root cause analysis.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![Next.js](https://img.shields.io/badge/next.js-14+-black.svg)
![Architecture](https://img.shields.io/badge/architecture-MVP%20v2.0-green.svg)

## Overview

Naxis is **not a monitoring tool** — it's an operational intelligence platform that understands the "why" behind network events through:

- **Multi-Vendor Telemetry Normalization**: Unified event schema across Cisco, Juniper, Arista
- **Topology-Aware Correlation**: Graph-based event correlation using network topology
- **Incident Intelligence**: Time-series analysis and pattern detection
- **AI-Assisted RCA**: Local LLM inference for root cause analysis

## ⚡ MVP Architecture (v2.0)

**Simplified for 2-person team execution:**
- **2 backend services** (down from 7) - 71% reduction
- **7 Docker containers** (down from 11) - 36% reduction
- **50-70% lower operational complexity**
- **Same powerful data architecture** (ClickHouse + Neo4j + Redis + Ollama)

See [docs/MVP_ARCHITECTURE.md](docs/MVP_ARCHITECTURE.md) for complete design.

## Quick Start

```bash
# Clone repository
git clone <repo-url> naxis && cd naxis

# Setup environment
make setup

# Start services
make up

# Pull LLM model
make ollama

# Access applications
# API:      http://localhost:8000
# Frontend: http://localhost:3000
# Neo4j:    http://localhost:7474
```

## Architecture

**MVP v2.0** - Simplified for execution practicality:

```
┌─────────────────┐
│  Next.js Web UI │  Port 3000
└────────┬────────┘
         │ HTTP + SSE
         ▼
┌─────────────────┐
│   FastAPI API   │  Port 8000
│  (Query + RCA)  │
└────┬────────┬───┘
     │        │
     ▼        ▼
┌─────────┐ ┌────────┐
│ ClickH. │ │ Neo4j  │
│ Events  │ │ Graph  │
└────▲────┘ └───▲────┘
     │          │
     └──────┬───┘
            │
     ┌──────▼─────────────┐
     │  Worker (Daemon)   │
     │  • Collect from    │
     │    DNAC/Mist/Arista│
     │  • Normalize events│
     │  • Sync topology   │
     │  • Correlate events│
     │  • Create incidents│
     └────────────────────┘
```

**See documentation:**
- [docs/MVP_ARCHITECTURE.md](docs/MVP_ARCHITECTURE.md) - Complete MVP design (42KB)
- [MVP_STRUCTURE.md](MVP_STRUCTURE.md) - Directory structure
- [MVP_SUMMARY.md](MVP_SUMMARY.md) - Quick reference
- [ARCHITECTURE.md](ARCHITECTURE.md) - Original design (reference)

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend | FastAPI | API Gateway & Services |
| Frontend | Next.js 14 | Web UI |
| Event Store | ClickHouse | Time-series events |
| Graph DB | Neo4j Community | Network topology |
| Event Bus | Redis Streams | Event processing |
| AI Runtime | Ollama | Local LLM inference |
| Orchestration | Docker Compose | Local deployment |

## Project Structure (MVP v2.0)

```
naxis/
├── backend/
│   ├── shared/           # Common libraries
│   ├── worker/           # ✨ Background daemon (collects, normalizes, correlates)
│   └── api/              # ✨ REST API (queries, RCA)
├── frontend/             # Next.js UI
├── schemas/              # Database schemas (ClickHouse SQL, Neo4j Cypher)
├── config/               # .env.example
├── docs/                 # MVP_ARCHITECTURE.md, etc.
├── docker-compose.yml    # Production stack (7 services)
└── docker-compose.dev.yml # Development overrides
```

**Key change:** Consolidated 5 backend services into 1 worker service for MVP simplicity.

## Development

### Prerequisites

- Docker 20.10+
- Docker Compose 2.20+
- 16GB RAM (minimum)
- 50GB disk space

### Commands

```bash
make up        # Start all services
make down      # Stop all services
make logs      # View logs
make rebuild   # Rebuild from scratch
make test      # Run tests
make clean     # Remove all data
```

### Configuration

Edit `.env` file for service configuration:

```env
# Vendor Credentials
DNAC_HOST=dnac.example.com
DNAC_USERNAME=admin
DNAC_PASSWORD=password

MIST_API_KEY=your-api-key
MIST_ORG_ID=your-org-id

# Service Settings
COLLECTOR_INTERVAL=60
CORRELATION_TIME_WINDOW=300
```

## Phase 1 Integrations

- ✅ Cisco DNAC
- ✅ Juniper Mist
- ✅ Arista SD-WAN (VeloCloud)
- ✅ Arista Wireless Controllers

## Roadmap (MVP v2.0)

### Phase 1: Foundation (Weeks 1-2) ✅ COMPLETE
- [x] Monorepo structure
- [x] Simplified architecture (7→2 backend services)
- [x] Docker Compose setup
- [x] Documentation (42KB architecture guide)

### 🎯 Phase 2: Data Layer (Week 3) - START HERE
- [ ] Shared models (event, incident, identity)
- [ ] Database clients (Redis, ClickHouse, Neo4j)
- [ ] Database schemas (SQL, Cypher)

### Phase 3: Worker Service (Weeks 4-5)
- [ ] Single collector (DNAC)
- [ ] Event normalization
- [ ] Basic topology sync
- [ ] Main worker loop

### Phase 4: API Service (Week 6)
- [ ] Health checks
- [ ] Events endpoints
- [ ] EventService queries

### Phase 5: Frontend (Week 7)
- [ ] Layout + navigation
- [ ] Events list page
- [ ] API client

### Phase 6: Correlation (Weeks 8-9)
- [ ] Time-window correlation
- [ ] Incident creation
- [ ] Incidents API & UI

### Phase 7: Topology (Week 10)
- [ ] Full topology sync
- [ ] Topology API
- [ ] Graph visualization

### Phase 8: RCA (Weeks 11-12)
- [ ] Ollama integration
- [ ] RCA service
- [ ] RCA UI

### Phase 9-10: Additional Collectors & Polish (Weeks 13-16)
- [ ] Mist, Arista SD-WAN, Arista WLC collectors
- [ ] Real-time updates (SSE)
- [ ] Performance optimization

## Documentation

### Essential Reading
- **[docs/MVP_ARCHITECTURE.md](docs/MVP_ARCHITECTURE.md)** - Complete MVP design (42KB)
- **[MVP_SUMMARY.md](MVP_SUMMARY.md)** - Quick reference guide
- **[MVP_STRUCTURE.md](MVP_STRUCTURE.md)** - Directory structure

### Reference
- [ARCHITECTURE.md](ARCHITECTURE.md) - Original architecture (for reference)
- [backend/worker/README.md](backend/worker/README.md) - Worker service details
- [backend/api/README.md](backend/api/README.md) - API service details

### Coming Soon
- API Documentation
- Deployment Guide  
- Development Guide

## Contributing

Contributions welcome! See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Issues: https://github.com/your-org/naxis/issues
- Discussions: https://github.com/your-org/naxis/discussions

---

**Built with ❤️ for network operations teams**
