.PHONY: help setup build up dev down logs clean rebuild prune test typecheck migrate init-db

# Every compose invocation needs --env-file: docker-compose.yml interpolates
# POSTGRES_PASSWORD/REDIS_PASSWORD with the `:?` operator, so without it even
# `docker compose down` aborts with an interpolation error.
COMPOSE := docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml

# Backend tests are NOT in the runtime image — the Dockerfile copies only
# shared/, api/, worker/, config/ and main.py. They run against a bind-mounted
# checkout instead. Host python is 3.8 and cannot parse this code.
PYTEST := docker run --rm -v "$(CURDIR)":/repo -w /repo \
	-e PYTHONPATH=/repo:/repo/backend naxis-api python -m pytest

help:
	@echo "Naxis Development Commands:"
	@echo "  make setup     - Create config/.env from config/.env.example"
	@echo "  make build     - Build the backend and frontend images"
	@echo "  make up        - Start all services (detached)"
	@echo "  make dev       - Build then start the full dev stack in the foreground"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - View logs (all services)"
	@echo "  make clean     - Remove all containers AND volumes (destroys the database)"
	@echo "  make rebuild   - Rebuild from scratch and restart services"
	@echo "  make prune     - Delete dangling images + build cache (safe, keeps volumes)"
	@echo "  make test      - Run backend + frontend tests"
	@echo "  make typecheck - Run the frontend TypeScript check"
	@echo "  make migrate   - Apply pending SQL migrations (idempotent)"

setup:
	@if [ ! -f config/.env ]; then \
		cp config/.env.example config/.env; \
		echo "Created config/.env — set POSTGRES_PASSWORD, REDIS_PASSWORD and vendor credentials."; \
	else \
		echo "config/.env already exists."; \
	fi

build:
	$(COMPOSE) build
	@$(MAKE) --no-print-directory prune

up:
	$(COMPOSE) up -d
	@echo "Services starting... Check logs with: make logs"
	@echo "API:      http://localhost:8000"
	@echo "Frontend: http://localhost:3000"
	@echo "Adminer:  http://localhost:8080"

# Build + prune before `up` because `up` runs in the foreground — pruning after it
# would only fire on Ctrl-C.
dev:
	$(COMPOSE) build
	@$(MAKE) --no-print-directory prune
	$(COMPOSE) up

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

clean:
	$(COMPOSE) down -v
	@echo "All containers and volumes removed."

rebuild:
	$(COMPOSE) down
	$(COMPOSE) build --no-cache
	@$(MAKE) --no-print-directory prune
	$(COMPOSE) up -d

# Only untagged (superseded) images and unused build cache. Never -a or --volumes:
# those would take the Postgres data volume and images for stopped services.
prune:
	@echo "Removing superseded images and build cache..."
	-docker image prune -f
	-docker builder prune -f
	@docker system df

test:
	@echo "Running backend tests..."
	$(PYTEST) backend/tests/ -q
	@echo "Running frontend tests..."
	cd frontend && npm test

typecheck:
	cd frontend && npx tsc --noEmit

# docker-entrypoint-initdb.d only runs on an empty data directory, and does not
# exist at all on a managed Postgres, so schema changes go through the runner.
migrate:
	@echo "Applying pending migrations..."
	$(COMPOSE) exec -T api python /app/scripts/migrate.py

init-db: migrate

.DEFAULT_GOAL := help
