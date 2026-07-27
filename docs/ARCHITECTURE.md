# Naxis Platform Architecture

> **Status:** Historical reference only. This document was written during the Foundation phase (May 2026) and described an aspirational multi-database architecture (Neo4j, ClickHouse, separate microservices) that was never built. The current implementation is a **PostgreSQL monolith** — one database, one Docker image, two entrypoints.

For current architecture documentation, see:

- **[docs/DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** — Onboarding, quick start, codebase walkthrough
- **[docs/TELEMETRY_ARCHITECTURE.md](TELEMETRY_ARCHITECTURE.md)** — Collector → ledger → UI health architecture
- **[docs/CORRELATION_ARCHITECTURE.md](CORRELATION_ARCHITECTURE.md)** — Correlation engine (Stage 1 + Stage 2)
- **[docs/FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md)** — Frontend structure
- **[docs/TOPOLOGY_VISUALIZATION.md](TOPOLOGY_VISUALIZATION.md)** — Topology graph rendering

## Actual Stack (vs. what this doc describes)

| Component | This doc says | What we actually use |
|-----------|--------------|---------------------|
| Database | ClickHouse + Neo4j + Redis | **PostgreSQL only** |
| Backend | 5 microservices (collectors, ingestion, correlation, topology, RCA) | **1 Docker image, 2 entrypoints** (api + worker) |
| Event bus | Redis Streams | PostgreSQL (Redis optional for pub/sub) |
| AI/RCA | Ollama + LangGraph | **Not deployed** (future) |
| Topology | Neo4j graph DB | **PostgreSQL** (`topology_nodes` + `topology_edges` tables) |

## What This Doc Got Right

- Multi-vendor normalization (Mist, DNAC, VeloCloud, Arista WLC)
- Topology-aware correlation
- Deterministic rule engine
- Incident lifecycle with blast radius
- Small-team-optimized deployment

Those principles survived. The implementation choices evolved.
