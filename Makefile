.PHONY: help setup build up down logs clean rebuild ollama test init-db

help:
	@echo "Naxis Development Commands:"
	@echo "  make setup     - Create .env file from .env.example"
	@echo "  make build     - Build the backend Docker image"
	@echo "  make up        - Start all services"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - View logs (all services)"
	@echo "  make clean     - Remove all containers and volumes"
	@echo "  make rebuild   - Rebuild and restart services"
	@echo "  make ollama    - Pull Llama 3.1 8B model"
	@echo "  make test      - Run all tests"
	@echo "  make init-db   - Manually re-run database schema (auto on first start)"

setup:
	@if [ ! -f .env ]; then \
		cp config/.env.example .env; \
		echo "Created .env file. Update with your configuration."; \
	else \
		echo ".env file already exists."; \
	fi

build:
	docker compose build

up:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
	@echo "Services starting... Check logs with: make logs"
	@echo "API:      http://localhost:8000"
	@echo "Frontend: http://localhost:3000"
	@echo "Adminer:  http://localhost:8080"

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
	@echo "Applying Postgres schema..."
	docker compose exec postgres psql -U naxis -d naxis -f /docker-entrypoint-initdb.d/001_init.sql
	@echo "Schema applied."

.DEFAULT_GOAL := help
