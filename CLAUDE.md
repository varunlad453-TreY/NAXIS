
# Naxis — Claude working agreement

Repo-level instructions for any Claude/LLM assistant working here. Read before responding.

## Response style

- **No explanations unless asked.** Code, diffs, and file paths only. No preamble, no postamble, no "here's what I did" summary at the end.
- **No narration of thought process.** State the result, not the reasoning that produced it.
- **Ask before assuming scope.** For anything beyond a single-file edit, confirm what to touch first.
- **Comments in code:** none by default. Add a one-line comment only when the *why* is non-obvious (hidden constraint, workaround, subtle invariant). Never restate what the code does.
- **Match verbosity to the task.** One-liner questions get one-liner answers.

## Stack (do not re-derive)

- **Database:** PostgreSQL only (self-hosted, Docker). No ClickHouse, Neo4j, or managed cloud services.
- **Backend:** Python monolith — one Docker image (`backend/Dockerfile`), two entrypoints:
  - `api`: FastAPI on port 8000
  - `worker`: async daemon (polling, receivers, correlation)
- **Frontend:** Next.js 15 on port 3000
- **Cache/notify:** Redis (real-time notifications only; not an event bus)
- **AI:** none deployed. No Ollama, no cloud LLM APIs wired in. Future RCA uses LangGraph.
- **Deploy:** docker-compose. `make up` / `make down` / `make rebuild`.
- **Team:** 2 people. Ops simplicity beats architectural purity.

## Conventions

- **History/audit tables** are append-only, one row per meaningful state change (diff-on-write, not snapshot-every-poll). Derive event types on read by diffing consecutive rows.
- **CSV endpoints** follow the `.csv` twin pattern: every list-style JSON endpoint gets a same-URL sibling with `.csv` suffix that streams `text/csv`. Same query params, same auth, streamed via `StreamingResponse`, ISO 8601 UTC timestamps.
- **Schema files** live in `schemas/postgres/NNN_*.sql` and are auto-applied on first Postgres start via `docker-entrypoint-initdb.d`.
- **Env config** goes in `config/.env` (loaded by docker-compose `env_file`) and is typed in `backend/config/settings.py` (pydantic-settings).
- **Frontend paths** use `@/` alias → `frontend/src/`.
- **Feature flags** on external integrations use `<vendor>_enabled` bool in settings — never hard-fail if a feature is off.

## Anti-patterns (do not do)

- Do not suggest managed cloud services (Snowflake, Confluent, MSK, Datadog, etc.). Self-hosted or nothing.
- Do not add microservices. One Docker image, two processes.
- Do not add mocks/stubs in place of missing features. Say it's not built; leave the code honest.
- Do not run destructive git ops (`reset --hard`, force push, branch delete) without explicit ask.
- Do not skip pre-commit hooks (`--no-verify`).
- Do not re-generate `package-lock.json` unless the mismatch is the actual bug being fixed.
- Do not write markdown documentation files unless explicitly asked.

## When user asks about capabilities

For product/feature brainstorms (e.g. "what should the Mist card do"): return a bulleted list of specific, buildable capabilities. No headers explaining what the request is, no "here are some ideas" preamble, no "let me know if…" postamble.

## Design docs

Design docs live in `docs/` and are only written when the user asks for one. Format: goal, data model, API, UI, open questions. No implementation timelines, no ceremony sections.

## Working with the current state

- The active branch is `main`. `master` exists locally but is stale.
- `origin/main` may lag local `main` — check `git status` before assuming what's pushed.
- Frontend TypeScript must pass `npx tsc --noEmit` before a Docker build attempt.
- `useSearchParams()` in Next.js 15 requires a `<Suspense>` boundary — wrap the inner component.
- **Tab/view state must survive refresh.** Every page tab or view toggle uses `useQueryState` (from `@/hooks/use-query-state`) — never plain `useState` for navigation state. URL param is the source of truth. Pattern: split the page into `PageInner` (uses `useQueryState`) + default export wrapping it in `<Suspense>`. See `frontend/src/app/topology/page.tsx` and `frontend/src/app/topology/sites/[site_id]/page.tsx` for reference.
