# Development stage
FROM python:3.11-slim AS development

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install shared package first
COPY backend/shared /tmp/shared
RUN pip install --no-cache-dir -e /tmp/shared

# Install API dependencies
COPY backend/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/shared /app/shared
COPY backend/api /app/api

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Production stage
FROM python:3.11-slim AS production

WORKDIR /app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install shared package
COPY backend/shared /tmp/shared
RUN pip install --no-cache-dir /tmp/shared && rm -rf /tmp/shared

# Install API dependencies
COPY backend/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/api /app/api

# Run as non-root user
RUN useradd -m -u 1000 naxis && chown -R naxis:naxis /app
USER naxis

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health/live || exit 1

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
