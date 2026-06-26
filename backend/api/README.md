# Naxis API Gateway

FastAPI-based API Gateway for Naxis platform.

## Endpoints

- **GET /health/live**: Liveness probe
- **GET /health/ready**: Readiness probe with dependency checks
- **GET /api/v1/events**: List events with filtering
- **GET /api/v1/incidents**: List incidents
- **GET /api/v1/topology**: Get topology graph
- **GET /api/v1/rca/{incident_id}**: Get RCA analysis

## Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run locally
uvicorn main:app --reload --port 8000

# Run tests
pytest tests/
```

## Environment Variables

See `config/.env.example` for required configuration.

## Docker

```bash
# Build
docker build -t naxis-api -f backend/api/Dockerfile .

# Run
docker run -p 8000:8000 --env-file .env naxis-api
```
