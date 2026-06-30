# Events & Devices Pages - Quick Start Guide

##  Getting Started in 5 Minutes

### 1. Start the Platform

```bash
# Development mode
npm run dev

# Then open browser to http://localhost:3000
```

### 2. Navigate to Events or Devices

- Click "Events" in the top navigation
- Or click "Devices" in the top navigation

### 3. See Real Data

Events and Devices are automatically populated by the worker pushing data to ClickHouse. If you see data, congratulations! The persistence layer is working.

---

## 📖 Page Features

### Events Page (`/events`)

**What to do:**
1. **View all events** - Page loads with all recent events
2. **Filter by severity** - Click "Critical", "Major", "Minor", or "Info"
3. **Search** - Type in search box to find by device name or title
4. **Check specific vendor** - Select vendor from "Source" dropdown
5. **Find by site/device** - Enter site ID or device ID
6. **Click event** - Navigate to related incident

**Key stats:**
- Shows total event count
- Shows filtered result count
- Refreshes automatically every 10 seconds

### Devices Page (`/devices`)

**What to do:**
1. **View all devices** - Page loads with all discovered devices
2. **Filter by platform** - Select DNAC, Mist, etc.
3. **Check reachability** - Toggle "Reachable"/"Unreachable"
4. **Filter by site** - Enter site ID
5. **Search** - Find by hostname, IP, or device type

**Key info:**
- Device IP address
- Last seen timestamp
- Management platform
- Reachability status

---

## 🔧 Common Tasks

### "How do I find events from a specific incident?"

1. Go to an incident detail page
2. Scroll to "Related Events" section
3. See actual events displayed (not just IDs)
4. Click "View all" to see full list on Events page

### "I want to investigate why a device is down"

1. Go to Devices page
2. Filter by "Unreachable"
3. Click a device
4. Find related events on Events page
5. Check incident timeline

### "Show me all critical events in the last hour"

1. Go to Events page
2. Click "Critical" severity filter
3. Use date range if available (future feature)
4. View filtered results

### "How many devices are managed by each platform?"

1. Go to Devices page
2. Select each platform from dropdown
3. Note the total count
4. Compare across vendors

---

## 🧪 Testing the Pages

### With Mock Data

```bash
# Make sure STORAGE_MODE=memory in .env
npm run dev
python demo_end_to_end.py  # In another terminal
# Events and Devices pages will show mock data
```

### With Real Data

```bash
# Make sure STORAGE_MODE=clickhouse in .env
docker-compose up
npm run dev
# Worker will push real data
# Pages will auto-refresh and show new data
```

---

## 📊 What the Data Means

### Events

Each event represents a single telemetry observation:
- **Event ID**: Unique identifier for this event
- **Timestamp**: When the event occurred
- **Source**: Which vendor provided this event
- **Severity**: How important is this event
- **Device**: Which device does this affect
- **Site**: Which site/location
- **Incident**: What incident correlates to this event (if any)

### Devices

Each device represents infrastructure discovered from events:
- **Hostname**: Device name
- **IP Address**: Management IP
- **Platform**: Vendor (DNAC, Mist, etc.)
- **Device Type**: Router, Switch, AP, etc.
- **Site**: Physical location
- **Reachability**: Can we reach this device
- **Last Seen**: When we last saw activity from this device

---

## 🐛 Troubleshooting

### No data showing?

**Check 1: Is backend running?**
```bash
curl http://localhost:8000/health
# Should return {"status": "healthy"}
```

**Check 2: Is ClickHouse running?**
```bash
docker ps | grep clickhouse
# Should show running container
```

**Check 3: Is worker running?**
```bash
docker logs naxis-worker | tail -20
# Should show "Pipeline executed" messages
```

**Check 4: Try demo mode**
```bash
# Use in-memory storage for quick test
STORAGE_MODE=memory npm run dev
python demo_end_to_end.py
```

### Data not refreshing?

- **Events page**: Refreshes every 10 seconds
- **Devices page**: Refreshes every 30 seconds
- Click "Refresh" button to force immediate update
- Check browser console (F12) for errors

### Filters not working?

1. Click "Reset all" to clear filters
2. Try filtering one thing at a time
3. Check browser Network tab (DevTools F12)
4. Look for errors in red in browser console

---

## 🎯 Next Steps

### For Users
1. Explore the Events page
2. Find a critical event
3. Click it to see related incident
4. Understand the relationship

### For Developers
1. Review component code in `frontend/src/components/events` and `frontend/src/components/devices`
2. Read full documentation in `docs/FRONTEND_EVENTS_DEVICES.md`
3. Run tests: `npm test`
4. Modify styles: Edit `tailwind.config.ts`

### For Integration
1. Verify Events and Devices endpoints in API
2. Check data is flowing from worker
3. Validate filters work correctly
4. Performance test with large datasets

---

## 📚 Full Documentation

For complete documentation, see:
- [FRONTEND_EVENTS_DEVICES.md](docs/FRONTEND_EVENTS_DEVICES.md) - Architecture and API reference
- [FRONTEND_IMPLEMENTATION.md](FRONTEND_IMPLEMENTATION.md) - Integration guide
- [API Reference](docs/INCIDENT_API_COMPLETE.md) - Backend endpoints

---

## 💬 Quick Reference

**URLs:**
- Home: http://localhost:3000
- Events: http://localhost:3000/events
- Devices: http://localhost:3000/devices
- Incidents: http://localhost:3000/incidents

**Keyboard Shortcuts:**
- F12: Open Developer Tools
- Ctrl/Cmd+K: Search (future feature)

**Common Filters:**
- Severity: Critical, Major, Minor, Info
- Platform: DNAC, Mist, Arista SD-WAN, Arista WLC
- Reachability: Reachable, Unreachable, Unknown

---

**That's it! You're ready to explore Events and Devices. Enjoy! 🎉**

Repository: Network Resilient Platform
Status:     All files current with remote
Updates:    None available
