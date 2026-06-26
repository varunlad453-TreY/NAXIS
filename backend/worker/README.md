# Naxis Worker Service

Background daemon that handles all data collection, normalization, and correlation.

## Responsibilities

### 1. Vendor Collection
- Poll vendor APIs (DNAC, Mist, Arista SD-WAN, Arista WLC)
- Handle authentication and session management
- Configurable polling intervals

### 2. Event Normalization
- Transform vendor events to UnifiedEvent schema
- Stitch device/client identities
- Enrich with topology context

### 3. Topology Synchronization
- Sync devices, links, clients from vendor APIs
- Maintain Neo4j graph model
- Detect topology changes

### 4. Event Correlation
- Time-window based correlation (5 minutes)
- Proximity-based correlation using graph queries
- Create and update incidents

### 5. Real-Time Publishing
- Publish events to Redis Pub/Sub
- Publish incident updates
- Enable real-time frontend updates

## Architecture

```
Worker Main Loop (every 60s)
├── Parallel Tasks:
│   ├── collect_and_process_dnac()
│   ├── collect_and_process_mist()
│   ├── collect_and_process_arista_sdwan()
│   ├── collect_and_process_arista_wlc()
│   ├── sync_topology()
│   └── run_correlation_check()
```

## Directory Structure

```
worker/
├── main.py                    # Entry point with asyncio loop
├── collectors/
│   ├── dnac.py               # Cisco DNAC collector
│   ├── mist.py               # Juniper Mist collector
│   ├── arista_sdwan.py       # Arista SD-WAN collector
│   └── arista_wlc.py         # Arista WLC collector
├── processors/
│   ├── normalizer.py         # Event normalization
│   └── enrichment.py         # Topology enrichment
├── topology/
│   ├── device_sync.py        # Device synchronization
│   ├── link_sync.py          # Link synchronization
│   └── client_sync.py        # Client synchronization
├── correlation/
│   ├── time_window.py        # Time-based correlation
│   ├── proximity.py          # Graph proximity correlation
│   └── incident_manager.py   # Incident CRUD
└── scheduler.py              # Task scheduling logic
```

## Development

```bash
# Run locally with development dependencies
cd backend/worker
pip install -r requirements.txt
python main.py

# Run in Docker
docker compose up worker

# View logs
docker compose logs -f worker
```

## Configuration

See `.env` for configuration options:

```env
# Collection
COLLECTOR_INTERVAL=60          # Polling interval in seconds

# Correlation
CORRELATION_TIME_WINDOW=300    # 5 minutes
CORRELATION_PROXIMITY_HOPS=2   # Max hops for proximity

# Vendor Credentials
DNAC_HOST=dnac.example.com
DNAC_USERNAME=admin
DNAC_PASSWORD=password
...
```

## Debugging

```bash
# Enable debug logging
export LOG_LEVEL=DEBUG

# Run single collection cycle
python -c "from worker.collectors.dnac import collect_dnac_events; import asyncio; asyncio.run(collect_dnac_events())"

# Test normalization
python -c "from worker.processors.normalizer import normalize_event; print(normalize_event(raw_event))"
```

## Error Handling

Worker uses exponential backoff for retries:
- API failures: retry 3 times with 5s delay
- Connection errors: retry indefinitely with 60s backoff
- Validation errors: log and skip event

## Performance

Expected throughput:
- 100-500 events per collection cycle
- 4 vendor collections per minute
- ~400-2000 events/minute total

Memory usage:
- Base: ~200MB
- Per collector: ~50MB
- Peak during correlation: ~500MB
