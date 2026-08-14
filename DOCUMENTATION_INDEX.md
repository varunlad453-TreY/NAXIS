# Naxis Documentation Index

> **Last updated:** 2026-08-14

This index maps the Naxis codebase documentation. All docs are markdown files in the repo; there are no external wikis.

---

## 🚀 Start Here

| If you want to... | Read this | Time |
|---|---|---|
| Understand the platform | [README.md](../README.md) | 5 min |
| Onboard as a developer | [docs/DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | 15 min |
| Understand the frontend | [docs/FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | 10 min |
| Understand topology | [docs/TOPOLOGY_VISUALIZATION.md](TOPOLOGY_VISUALIZATION.md) | 15 min |
| Understand correlation | [docs/CORRELATION_ARCHITECTURE.md](CORRELATION_ARCHITECTURE.md) | 20 min |
| See what changed when | [CHANGELOG.md](../CHANGELOG.md) | varies |
| See per-session change logs | [docs/handoff docs/](handoff%20docs/) (49 sessions) | varies |

---

## 📂 Documentation Map

### Root-Level Docs

| File | Purpose |
|---|---|
| [README.md](../README.md) | Platform overview, quick start, architecture summary |
| [CHANGELOG.md](../CHANGELOG.md) | Chronological change log (entries [1]–[32] + WP-0–WP-7) |
| [AGENTS.md](../AGENTS.md) | Instructions for AI coding assistants |
| [CLAUDE.md](../CLAUDE.md) | Working agreement for Claude/LLM assistants |
| [QUICKSTART_EVENTS_DEVICES.md](../QUICKSTART_EVENTS_DEVICES.md) | Getting started guide |

### Architecture & Design

| File | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | **Historical only** — aspirational multi-DB design that was never built. See DEVELOPER_GUIDE.md for actual architecture. |
| [docs/FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | Frontend structure, conventions, navigation, page composition |
| [docs/DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | Onboarding, backend architecture, collector system, testing |
| [docs/TOPOLOGY_VISUALIZATION.md](TOPOLOGY_VISUALIZATION.md) | Topology graph rendering, drill-down, three-mode system, readable layered layout |
| [docs/CORRELATION_ARCHITECTURE.md](CORRELATION_ARCHITECTURE.md) | Correlation engine (Stage 1 + Stage 2), incident lifecycle |
| [docs/TELEMETRY_ARCHITECTURE.md](TELEMETRY_ARCHITECTURE.md) | Collector → ledger → UI health architecture |

### Strategy & Planning

| File | Purpose |
|---|---|
| [docs/strategy/ARCHITECTURE.md](strategy/ARCHITECTURE.md) | Target state architecture |
| [docs/strategy/ROADMAP.md](strategy/ROADMAP.md) | Phased delivery plan |
| [docs/strategy/PLAN_GAP.md](strategy/PLAN_GAP.md) | What exists vs what's missing + execution plan |
| [docs/strategy/DATA_POLICY.md](strategy/DATA_POLICY.md) | What we store and why |
| [docs/strategy/TECHNICAL_QA.md](strategy/TECHNICAL_QA.md) | Measured reality, test counts, storage numbers |

### Explained & Rationale

| File | Purpose |
|---|---|
| [docs/explained/CORRELATION_ENGINE_EXPLAINED.md](explained/CORRELATION_ENGINE_EXPLAINED.md) | How the correlation engine works in plain language |
| [docs/why/why-correlation-engine.md](why/why-correlation-engine.md) | Why we built our own correlation engine |
| [docs/why/why Infrastructure aware grouping for Naxis Correlation Stage 2.md](why/why%20Infrastructure%20aware%20grouping%20for%20Naxis%20Correlation%20Stage%202.md) | Rationale for topology-aware grouping |

### Other Docs

| File | Purpose |
|---|---|
| [docs/NAXIS_WHITEPAPER.md](NAXIS_WHITEPAPER.md) | Product whitepaper |
| [docs/mist-card-design.md](mist-card-design.md) | Mist integration UI design notes |
| [docs/Plans/CORRELATION_PIPELINE_PLAN.md](Plans/CORRELATION_PIPELINE_PLAN.md) | Correlation pipeline design |
| [docs/Plans/16_VELOCLOUD_VERIFICATION.md](Plans/16_VELOCLOUD_VERIFICATION.md) | VeloCloud verification plan |

---

## 🗂️ Handoff Docs (Per-Session Changelogs)

The `docs/handoff docs/` directory contains 49 session-by-session engineering handoffs:

- **Handoffs 1–32** — Foundation through Phase 10 (July–August 2026)
- **Handoffs 33–49** — Enterprise topology redesign, NOC redesign, readable layered layout (August 2026)

Each handoff doc records: what was changed, why, file inventory, API contracts, verification steps, and next steps.

---

## 📊 Stats

| Metric | Count |
|---|---|
| Total markdown docs | 73 |
| Handoff sessions | 49 |
| Git commits | 137 |
| Backend tests | 432+ |
| Frontend tests | 114+ |
