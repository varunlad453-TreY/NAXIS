# ✅ Naxis Platform - Quick Start

## Current Status

✅ **All installations complete**
✅ **Backend API running** - http://localhost:8000
✅ **Frontend running** - http://localhost:3000

---

## 🎯 Access The Platform Now

### Open in Browser:

**Frontend Dashboard:** http://localhost:3000
- Real-time incident feed
- Dark operational theme
- Click incidents for details

**API Documentation:** http://localhost:8000/docs
- Interactive Swagger UI
- Test all endpoints
- View schemas

**Health Check:** http://localhost:8000/health

---

## Current Issue: Incidents Not Showing

The demo script stores incidents in a separate memory instance from the running API server.

### Generate Incidents That Persist:

**Option 1: Restart Backend with Demo Data**
```bash
# Stop current backend (Ctrl+C in that terminal)
# Then run:
cd "/home/naksatra/Desktop/Network REsilient PLatform"
python3 demo_end_to_end.py
# This generates incidents

# In another terminal, start backend:
python3 -m uvicorn backend.api.main:app --reload --port 8000
# But incidents won't persist (in-memory storage)
```

**Option 2: Add POST Endpoint (Recommended)**

I can create a POST endpoint so you can add incidents via API.

---

## What's Running

```
Terminal 1: Backend API (port 8000)
Terminal 2: Frontend UI (port 3000)
```

---

## Manual Test Without Incidents

You can still test the UI:

1. Open http://localhost:3000
2. You'll see "No active incidents" (green checkmark)
3. UI is fully functional, just needs data

---

## Next Steps

**To see incidents in the UI, we need to:**
1. Add a POST /incidents endpoint to the API
2. Or integrate the correlation engine into the API startup
3. Or use a persistent database (ClickHouse)

Would you like me to:
- [ ] Add POST endpoint for testing?
- [ ] Integrate correlation engine into API?
- [ ] Set up ClickHouse for persistence?

