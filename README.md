# Naxis - Unified Enterprise Network Intelligence Platform

Open-source operational intelligence platform for network telemetry correlation, topology-aware reasoning, and AI-assisted root cause analysis.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![Next.js](https://img.shields.io/badge/next.js-15-black.svg)

## Overview

Naxis is an open-source operational intelligence platform for network telemetry correlation, topology-aware reasoning, and incident management. It normalizes events from multi-vendor networks (Mist, DNAC, VeloCloud), correlates them into structured incidents, and syncs topology into a queryable graph — all on PostgreSQL.

**Not a monitoring tool.** A reasoning layer that tells you *why* something is wrong. Includes collector health monitoring with Slack + email notifications.

## Quick Start

```powershell
# Windows
.\dev.ps1
```

```bash
# Linux/Mac
make up
```

- API: `http://localhost:8000`
- Frontend: `http://localhost:3000`
- Full test suite: `pytest backend\tests -v` (432+ backend tests, 0 failures) + `cd frontend && npx vitest run` (114+ frontend tests)

## Architecture

```
                    ┌──────────────────────┐
                    │   Next.js 15 (UI)    │  port 3000
                    └──────────┬───────────┘
                               │ HTTP
                               ▼
                    ┌──────────────────────┐
                    │  FastAPI (api)       │  port 8000
                    └──────┬───────┬───────┘
                           │       │
                           ▼       ▼
                    ┌──────────┐ ┌──────────┐
                    │PostgreSQL│ │  Redis   │
                    │(primary) │ │(pub/sub) │
                    └────▲─────┘ └────▲─────┘
                         │            │
                         └──────┬─────┘
                                │
                     ┌──────────▼──────────────┐
                     │  Worker daemon           │
                     │  • Collect from vendors  │
                     │  • Normalize to Unified  │
                     │  • Sync topology graph   │
                     │  • Correlate → incidents │
                     │  • Record telemetry      │
                     └─────────────────────────┘
```

**One database (PostgreSQL).** No ClickHouse, Neo4j, or Ollama. One Docker image, two entrypoints (api + worker).

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend | FastAPI + async daemon | API + worker in one Python monolith |
| Frontend | Next.js 15 + TanStack Query + shadcn | Web UI |
| Database | PostgreSQL 16 (self-hosted, Docker) | Events, incidents, topology, telemetry |
| Cache/Notify | Redis (optional, non-blocking) | Real-time incident pub/sub |
| Deploy | Docker Compose | Local development + production |

## Integrations

- ✅ **Juniper Mist** — Events + AP inventory (live)
- ✅ **Cisco DNAC** — Devices, alarms, topology, clients, interfaces (registered)
- ✅ **Arista SD-WAN (VeloCloud)** — Edge inventory, WAN links, tunnels, events, topology (live)
- ⬜ **Arista WLC** — Clients, APs, radios, events (code exists, host/password not configured)
- ⬜ **Aruba Central** — Cloud-managed Wi-Fi (code exists, not configured)

## Project Structure

```
naxis/
├── backend/
│   ├── main.py            # FastAPI entrypoint
│   ├── worker/            # Worker daemon, collectors, topology, pipeline
│   ├── api/               # REST API routes + services
│   ├── shared/            # Models, correlation engine, DB clients
│   ├── scripts/           # One-off utilities (backfill, export, etc.)
│   └── tests/             # 432+ tests
├── frontend/              # Next.js 15 UI
│   └── src/
│       ├── app/           # Routes
│       ├── components/    # Domain + UI components
│       ├── lib/           # API client, utils
│       └── types/         # TypeScript types
├── schemas/               # PostgreSQL SQL files
│   └── postgres/          # Migration scripts (NNN_*.sql)
├── config/                # .env
└── docs/                  # strategy/ (architecture, roadmap, data policy) + handoff logs
```

## Development

### Prerequisites
- Docker 20.10+ with Compose 2.20+
- 8GB RAM minimum

### Commands

```bash
make up        # Start all services
.\dev.ps1      # Windows dev startup
make down      # Stop all services
make logs      # View logs
make rebuild   # Rebuild from scratch
make test      # Run tests
make clean     # Remove all data
```

### Configuration

```env
# Database (defaults work for local Postgres)
DATABASE_URL=postgresql+asyncpg://naxis:naxis@localhost:5432/naxis

# Vendor credentials (configure as needed)
MIST_API_KEY=...
DNAC_ENABLED=false          # DNAC not configured in dev
VELOCLOUD_API_KEY=...

# Worker
COLLECTOR_INTERVAL=60
CORRELATION_TOPOLOGY_CASCADE=true

# Redis (optional)
REDIS_ENABLED=false
```

## Documentation

- **[docs/strategy/](docs/strategy/)** — Current strategic direction: `ARCHITECTURE.md` (target state), `ROADMAP.md` (phases), `DATA_POLICY.md` (what we store), `TECHNICAL_QA.md` (measured reality), `PLAN_GAP.md` (what exists vs what's missing + execution plan).
- **[docs/handoff docs/](docs/handoff%20docs/)** — Per-session change logs (49 sessions).

## License

MIT
