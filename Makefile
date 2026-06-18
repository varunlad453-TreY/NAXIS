.PHONY: help setup up down logs clean rebuild ollama test

help:
	@echo "Naxis Development Commands:"
	@echo "  make setup     - Create .env file from .env.example"
	@echo "  make up        - Start all services"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - View logs (all services)"
	@echo "  make clean     - Remove all containers and volumes"
	@echo "  make rebuild   - Rebuild and restart services"
	@echo "  make ollama    - Pull Llama 3.1 8B model"
	@echo "  make test      - Run all tests"
	@echo "  make init-db   - Initialize database schemas"

setup:
	@if [ ! -f .env ]; then \
		cp config/.env.example .env; \
		echo "Created .env file. Please update with your configuration."; \
	else \
		echo ".env file already exists."; \
	fi

up:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
	@echo "Services starting... Check logs with: make logs"
	@echo "API:      http://localhost:8000"
	@echo "Frontend: http://localhost:3000"
	@echo "Neo4j:    http://localhost:7474"

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	docker compose down -v
	@echo "All containers and volumes removed."

rebuild:
	docker compose down
	docker compose build --no-cache
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

ollama:
	@echo "Pulling Llama 3.1 8B model..."
	docker compose exec ollama ollama pull llama3.1:8b
	@echo "Model ready!"

test:
	@echo "Running backend tests..."
	docker compose exec api pytest tests/
	@echo "Running frontend tests..."
	docker compose exec web npm test

init-db:
	@echo "Initializing ClickHouse schemas..."
	docker compose exec clickhouse clickhouse-client --queries-file /schemas/clickhouse/001_events.sql
	docker compose exec clickhouse clickhouse-client --queries-file /schemas/clickhouse/002_incidents.sql
	@echo "Initializing Neo4j schemas..."
	docker compose exec neo4j cypher-shell -f /schemas/neo4j/001_constraints.cypher
	docker compose exec neo4j cypher-shell -f /schemas/neo4j/002_indexes.cypher
	@echo "Database schemas initialized!"

.DEFAULT_GOAL := help
