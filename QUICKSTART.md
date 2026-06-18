# Naxis Quick Start Guide

Get the complete operational intelligence platform running in 5 minutes.

## Prerequisites

- Python 3.8+
- Node.js 16+ and npm
- 4GB RAM minimum
- Linux/macOS (Windows via WSL)

---

## Step 1: Start Backend API

### Install Backend Dependencies

```bash
cd backend
pip3 install pydantic fastapi uvicorn httpx python-dateutil
```

### Start API Server

```bash
python3 -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

**Verify:** Open http://localhost:8000/docs - You should see the Swagger UI

---

## Step 2: Generate Mock Incidents

In a **new terminal**:

```bash
# From project root
python3 demo_end_to_end.py
```

This will:
- Generate mock vendor telemetry (DNAC, Mist, SD-WAN)
- Normalize events to UnifiedEvent schema
- Run correlation engine
- Store incidents in API
- Show statistics

**Expected output:**
```
================================================================================
END-TO-END DEMO COMPLETE
================================================================================
Flow Summary:
  • 6 vendor events generated
  • 2 incidents correlated
  • 2 incidents stored
  • 2 active incidents
```

---

## Step 3: Start Frontend

### Install Frontend Dependencies

In a **new terminal**:

```bash
cd frontend
npm install
```

### Configure Environment

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
```

### Start Dev Server

```bash
npm run dev
```

**Verify:** Open http://localhost:3000

---

## Step 4: View Operational Dashboard

Open your browser to: **http://localhost:3000**

You should see:

✅ **Incident Overview Dashboard**
- Real-time incident feed
- Active/All toggle filter
- Severity badges (Critical, Major, Minor, Info)
- Confidence scores
- Operational stats sidebar

✅ **Click any incident** to view:
- Full incident details
- Timeline visualization
- Related events
- Affected infrastructure
- Impact summary

---

## What You're Running

```
Frontend (Next.js)          Backend API (FastAPI)
http://localhost:3000   →   http://localhost:8000
         │                           │
         │                           ↓
         │                  ┌────────────────┐
         │                  │ In-Memory Store│
         │                  │   (Incidents)  │
         │                  └────────────────┘
         │                           ↑
         │                           │
         └──────────────────┬────────┘
                            │
                   ┌────────▼───────────┐
                   │ Correlation Engine │
                   │  (Site + Time)     │
                   └────────▲───────────┘
                            │
                   ┌────────┴───────────┐
                   │ Mock Generators    │
                   │ DNAC, Mist, SD-WAN │
                   └────────────────────┘
```

---

## Test the Platform

### Generate More Incidents

Run the demo script again:

```bash
python3 demo_end_to_end.py
```

Refresh the frontend - new incidents appear automatically (10s refresh).

### Query the API Directly

```bash
# Health check
curl http://localhost:8000/health

# List all incidents
curl http://localhost:8000/incidents | jq

# List active incidents only
curl http://localhost:8000/incidents/active | jq

# Get specific incident (use ID from response)
curl http://localhost:8000/incidents/inc-abc-123 | jq
```

### Explore API Documentation

Open: http://localhost:8000/docs

Try the interactive Swagger UI:
1. Click "GET /incidents/active"
2. Click "Try it out"
3. Click "Execute"
4. View the response

---

## Verify Components

### ✅ Backend API

```bash
curl http://localhost:8000/health
```

Expected:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-05-28T..."
}
```

### ✅ Frontend

Open: http://localhost:3000

You should see:
- Dark theme with deep navy background
- Naxis logo in header
- "Incidents" heading
- Active/All tabs
- Incident cards or "No active incidents" message

### ✅ Correlation Engine

```bash
python3 -c "
from backend.shared.correlation import CorrelationEngine
print('✅ Correlation engine imported successfully')
"
```

---

## Common Issues

### Port Already in Use

**Problem:** `Address already in use`

**Solution:**
```bash
# Find and kill process using port 8000
lsof -ti:8000 | xargs kill -9

# Or use different port
python3 -m uvicorn api.main:app --port 8001
```

### Module Not Found

**Problem:** `ModuleNotFoundError: No module named 'fastapi'`

**Solution:**
```bash
pip3 install fastapi uvicorn httpx pydantic python-dateutil
```

### npm Not Found

**Problem:** `npm: command not found`

**Solution:**
- Install Node.js from https://nodejs.org/
- Or use nvm: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash`

### Frontend Connection Error

**Problem:** API errors in frontend

**Solution:**
1. Verify backend is running: `curl http://localhost:8000/health`
2. Check `.env.local` has correct API URL
3. Clear browser cache and refresh

---

## What's Next

### Generate More Demo Data

Run different demo scenarios:

```bash
# Modify demo_end_to_end.py to generate different scenarios
python3 demo_end_to_end.py
```

### Explore the Code

**Backend:**
- `backend/shared/models/` - Data schemas
- `backend/shared/correlation/` - Correlation engine
- `backend/api/` - FastAPI application
- `backend/worker/mock_ingest/` - Mock data generators

**Frontend:**
- `frontend/src/app/` - Next.js pages
- `frontend/src/components/` - React components
- `frontend/src/lib/` - API client and utilities

### Read Documentation

- [docs/FRONTEND_COMPLETE.md](docs/FRONTEND_COMPLETE.md) - UI architecture
- [docs/INCIDENT_API_COMPLETE.md](docs/INCIDENT_API_COMPLETE.md) - API details
- [docs/CORRELATION_ENGINE_COMPLETE.md](docs/CORRELATION_ENGINE_COMPLETE.md) - Correlation logic
- [docs/MVP_ARCHITECTURE.md](docs/MVP_ARCHITECTURE.md) - System architecture

---

## Production Deployment

### Backend

```bash
# Install production dependencies
pip3 install -r backend/requirements.txt

# Run with production settings
python3 -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Frontend

```bash
cd frontend
npm run build
npm start
```

### With Docker

```bash
# Build and run (when Dockerfiles are available)
docker-compose up -d
```

---

## Architecture Overview

### Complete Stack

```
┌──────────────────────────────────────────────────────────┐
│                 NAXIS PLATFORM v1.0                      │
└──────────────────────────────────────────────────────────┘

User
 ↓
┌────────────────────┐
│  Next.js Frontend  │  Port 3000
│  - Dark theme UI   │
│  - Real-time feed  │
│  - Incident drill  │
└────────┬───────────┘
         │ HTTP (fetch)
         ↓
┌────────────────────┐
│   FastAPI API      │  Port 8000
│  - REST endpoints  │
│  - In-memory store │
│  - Health checks   │
└────────┬───────────┘
         │
         ↓
┌────────────────────┐
│ IncidentService    │
│  - CRUD operations │
│  - Filtering       │
│  - Stats           │
└────────┬───────────┘
         │
         ↓
┌────────────────────┐
│ Correlation Engine │
│  - Site grouping   │
│  - Time windows    │
│  - Confidence score│
└────────┬───────────┘
         │
         ↓
┌────────────────────┐
│ Mock Generators    │
│  - DNAC telemetry  │
│  - Mist telemetry  │
│  - SD-WAN telemetry│
└────────────────────┘
```

### Data Flow

1. **Mock Generators** create realistic vendor payloads
2. **Normalization** converts to UnifiedEvent schema
3. **Correlation Engine** groups events into incidents
4. **API Storage** stores incidents in-memory
5. **Frontend** queries API and displays

---

## Success Criteria

You've successfully set up Naxis when:

✅ Backend API returns 200 on `/health`  
✅ Frontend loads at http://localhost:3000  
✅ Demo script generates incidents  
✅ Incidents appear in UI  
✅ Can click incident for details  
✅ Stats panel shows metrics  
✅ Real-time updates work (10s refresh)  

---

## Get Help

- **Issues:** Check existing incidents in API response
- **Logs:** Check terminal output for errors
- **Documentation:** See `docs/` folder for detailed guides
- **API Docs:** http://localhost:8000/docs for interactive testing

---

**You now have a fully operational intelligence platform running!**

Next steps:
- Generate more demo data
- Explore the UI features
- Read the architecture docs
- Plan production deployment
