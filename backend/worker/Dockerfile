# Development stage
FROM python:3.11-slim AS development

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy entire backend monolith
COPY backend /app/backend

CMD ["python", "-u", "backend/worker.py"]

# Production stage
FROM python:3.11-slim AS production

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy entire backend monolith
COPY backend /app/backend

# Run as non-root user
RUN useradd -m -u 1000 naxis && chown -R naxis:naxis /app
USER naxis

CMD ["python", "-u", "backend/worker.py"]
