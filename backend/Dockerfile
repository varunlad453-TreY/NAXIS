# Development stage
FROM python:3.11-slim AS development

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/shared /tmp/shared
RUN pip install --no-cache-dir -e /tmp/shared

COPY backend/api/requirements.txt /tmp/api-requirements.txt
COPY backend/worker/requirements.txt /tmp/worker-requirements.txt
RUN grep -v '^\-e' /tmp/api-requirements.txt > /tmp/api-req-clean.txt && \
    grep -v '^\-e' /tmp/worker-requirements.txt > /tmp/worker-req-clean.txt && \
    pip install --no-cache-dir -r /tmp/api-req-clean.txt -r /tmp/worker-req-clean.txt && \
    rm /tmp/api-requirements.txt /tmp/worker-requirements.txt /tmp/api-req-clean.txt /tmp/worker-req-clean.txt

COPY backend/shared /app/shared
COPY backend/api /app/api
COPY backend/worker /app/worker
COPY backend/config /app/config
COPY backend/main.py /app/main.py

EXPOSE 8000

# Default entrypoint — overridden per service in docker-compose
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Production stage
FROM python:3.11-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/shared /tmp/shared
RUN pip install --no-cache-dir /tmp/shared && rm -rf /tmp/shared

COPY backend/api/requirements.txt /tmp/api-requirements.txt
COPY backend/worker/requirements.txt /tmp/worker-requirements.txt
RUN grep -v '^\-e' /tmp/api-requirements.txt > /tmp/api-req-clean.txt && \
    grep -v '^\-e' /tmp/worker-requirements.txt > /tmp/worker-req-clean.txt && \
    pip install --no-cache-dir -r /tmp/api-req-clean.txt -r /tmp/worker-req-clean.txt && \
    rm /tmp/api-requirements.txt /tmp/worker-requirements.txt /tmp/api-req-clean.txt /tmp/worker-req-clean.txt

COPY backend/shared /app/shared
COPY backend/api /app/api
COPY backend/worker /app/worker
COPY backend/config /app/config
COPY backend/main.py /app/main.py

RUN useradd -m -u 1000 naxis && chown -R naxis:naxis /app
USER naxis

ENV PYTHONPATH=/app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health/live || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
