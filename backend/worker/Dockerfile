# Development stage
FROM python:3.11-slim AS development

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install shared package first
COPY backend/shared /tmp/shared
RUN pip install --no-cache-dir -e /tmp/shared

# Install worker dependencies
COPY backend/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/shared /app/shared
COPY backend/worker /app/worker

CMD ["python", "-u", "worker/main.py"]

# Production stage
FROM python:3.11-slim AS production

WORKDIR /app

# Install shared package
COPY backend/shared /tmp/shared
RUN pip install --no-cache-dir /tmp/shared && rm -rf /tmp/shared

# Install worker dependencies
COPY backend/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/worker /app/worker

# Run as non-root user
RUN useradd -m -u 1000 naxis && chown -R naxis:naxis /app
USER naxis

CMD ["python", "-u", "worker/main.py"]
