# Frontend Implementation - Verification Guide

##  Complete Verification Checklist

Use this guide to verify that the Events and Devices frontend implementation is working correctly.

---

## Phase 1: Development Environment Setup

###  1.1 Dependencies Installed
```bash
cd frontend
npm install
# Should complete without errors
```

### ✅ 1.2 Build Succeeds
```bash
npm run build
# Should complete with "Build successful"
```

### ✅ 1.3 No TypeScript Errors
```bash
npm run type-check
# Should output "✓ No TypeScript errors"
```

### ✅ 1.4 All Tests Pass
```bash
npm test
# Should show all tests passing
# Expected output: "Test Suites: X passed, X total"
```

---

## Phase 2: Runtime Verification

### ✅ 2.1 Development Server Starts
```bash
npm run dev
# Should output: "▲ Next.js X.X.X - Local: http://localhost:3000"
```

### ✅ 2.2 Backend API Running
```bash
curl http://localhost:8000/health
# Should return: {"status": "healthy", "version": "...", "timestamp": "..."}
```

### ✅ 2.3 Home Page Loads
Navigate to http://localhost:3000
- ✅ See Naxis logo
- ✅ See navigation with: Incidents, Events, Devices, Topology
- ✅ See incident list (or mock data)

### ✅ 2.4 Events Page Loads
Navigate to http://localhost:3000/events
- ✅ Page title shows "Events"
- ✅ Subtitle shows "Raw telemetry events..."
- ✅ See filter panel with search box
- ✅ See severity filter buttons (Critical, Major, Minor, Info)
- ✅ See source dropdown
- ✅ See site ID and device ID inputs

### ✅ 2.5 Devices Page Loads
Navigate to http://localhost:3000/devices
- ✅ Page title shows "Device Inventory"
- ✅ Subtitle shows "Network devices discovered..."
- ✅ See filter panel
- ✅ See platform dropdown
- ✅ See reachability buttons (Reachable, Unreachable, Unknown)
- ✅ See site ID input

---

## Phase 3: Feature Verification

### ✅ 3.1 Events Page Features

#### Events Display
- ✅ Page shows event list or "No events found"
- ✅ Each event shows: time, severity badge, source, device name, title
- ✅ Time displayed relative to now (e.g., "5 minutes ago")
- ✅ Timestamp has tooltip with absolute time
- ✅ Incident link shows when event is correlated

#### Search Functionality
1. Go to Events page
2. Type "router" in search box
3. ✅ List filters to show only events matching "router"
4. Clear search box
5. ✅ List returns to unfiltered state

#### Severity Filtering
1. Click "Critical" button
2. ✅ Events list shows only critical events
3. Click "Major" button
4. ✅ Events list shows critical AND major events
5. Click "Critical" again to deselect
6. ✅ Only major events shown
7. Click "Reset all"
8. ✅ All severity levels shown again

#### Source Filtering
1. Select "dnac" from Source dropdown
2. ✅ Events list shows only DNAC events
3. Select "All sources"
4. ✅ Events from all vendors shown

#### Site/Device Filtering
1. Enter a site ID in "Site ID" field
2. ✅ Events list shows only events from that site
3. Clear site ID field
4. ✅ Events from all sites shown

#### Pagination
1. Look at bottom of page
2. ✅ See "Showing X of Y events"
3. If total > 50:
   - ✅ See "Page 1 of X" indicator
   - ✅ See "Previous" and "Next" buttons
   - Click "Next"
   - ✅ Page 2 events displayed
   - Click "Previous"
   - ✅ Back to page 1

#### Auto-Refresh
1. Note timestamp of an event (e.g., "5 minutes ago")
2. Wait 10 seconds
3. ✅ Events list updates automatically
4. Timestamps may have changed

#### Manual Refresh
1. Click "Refresh" button
2. ✅ Events list updates immediately
3. Should be faster than auto-refresh

#### Click Event
1. Click any event row
2. ✅ Navigate to related incident detail page (if incident_id present)
3. ✅ Related events section shows the event you clicked

### ✅ 3.2 Devices Page Features

#### Devices Display
- ✅ Page shows device list or "No devices found"
- ✅ Each device shows: hostname, IP, platform, device type, site, reachability
- ✅ Reachability shows green (reachable), red (unreachable), or gray (unknown)

#### Search Functionality
1. Go to Devices page
2. Type "router" in search box
3. ✅ Devices list filters to matching devices
4. Clear search
5. ✅ All devices shown

#### Platform Filtering
1. Select "mist" from Platform dropdown
2. ✅ Devices list shows only Mist devices
3. Select "All platforms"
4. ✅ Devices from all platforms shown

#### Reachability Filtering
1. Click "Unreachable" button
2. ✅ Devices list shows only unreachable devices
3. Click "Reachable" button
4. ✅ Devices list shows only reachable devices
5. Click both buttons
6. ✅ Shows unreachable AND reachable devices
7. Click "Reachable" again to deselect
8. ✅ Only unreachable shown

#### Site Filtering
1. Enter a site ID in "Site ID" field
2. ✅ Devices list shows only devices from that site
3. Clear field
4. ✅ All devices shown

#### Pagination
1. If total devices > 50:
   - ✅ See pagination controls at bottom
   - Click "Next"
   - ✅ Next page of devices shown

#### Auto-Refresh
1. Note device count
2. Wait 30 seconds
3. ✅ List may update if worker pushed new devices

#### Manual Refresh
1. Click "Refresh" button
2. ✅ Devices list updates immediately

### ✅ 3.3 Enhanced Incident Detail Page

1. Navigate to an incident detail page (/incidents/[id])
2. Scroll to "Related Events" section
3. ✅ See actual event rows displayed (not event IDs)
4. ✅ Each event shows: time, severity, source, device, title
5. If >10 events:
   - ✅ See only 10 events displayed
   - ✅ See "+X more events" message
   - ✅ See "View all" link to Events page
6. Click on an event row
7. ✅ Still on incident page (events are non-clickable or link to events page)

### ✅ 3.4 Navigation

1. Start at home page (/)
2. Click "Events" in header
3. ✅ Navigate to /events
4. Click "Devices" in header
5. ✅ Navigate to /devices
6. Click "Incidents" in header
7. ✅ Navigate to home page (/)

---

## Phase 4: Data Verification

### ✅ 4.1 Mock Data Mode

```bash
# Set STORAGE_MODE=memory in .env
STORAGE_MODE=memory npm run dev

# In another terminal
python demo_end_to_end.py
```

1. ✅ Events page shows mock events
2. ✅ Devices page shows mock devices
3. ✅ Filters work on mock data
4. ✅ Pagination works with mock data

### ✅ 4.2 Real Data Mode

```bash
# Set STORAGE_MODE=clickhouse in .env
docker-compose up
npm run dev
```

1. ✅ Events page shows real events from ClickHouse
2. ✅ Devices page shows real devices from Neo4j
3. ✅ Worker continuously adds new events/devices
4. ✅ Auto-refresh shows new data

### ✅ 4.3 Empty State Handling

1. Apply impossible filter combination:
   - Events: severity=critical AND source=nonexistent
2. ✅ See "No events found" message
3. ✅ Can click "Reset all" to clear filters
4. Same for Devices page

---

## Phase 5: Error Handling

### ✅ 5.1 Backend Unavailable

1. Stop backend API: `docker stop naxis-api`
2. Go to Events page
3. ✅ See error message (red banner)
4. ✅ Text explains "Failed to load events"
5. Restart backend: `docker start naxis-api`
6. Click "Refresh"
7. ✅ Events load successfully again

### ✅ 5.2 Invalid Filter

1. Go to Events page
2. Try to enter invalid characters in filter
3. ✅ Backend handles gracefully
4. ✅ No JavaScript errors in console

### ✅ 5.3 Slow Network

1. Open DevTools (F12)
2. Go to Network tab
3. Set throttling to "Slow 3G"
4. Go to Events page
5. ✅ See loading skeleton
6. ✅ Events eventually load
7. ✅ Pagination works despite slowness

---

## Phase 6: Performance Verification

### ✅ 6.1 Page Load Time

1. Open DevTools (F12)
2. Go to Network tab
3. Go to Events page
4. ✅ Total load time < 1 second
5. ✅ First paint < 500ms
6. Same for Devices page

### ✅ 6.2 Interaction Responsiveness

1. Go to Events page with data loaded
2. Click severity filter
3. ✅ Response within 200ms
4. Click pagination
5. ✅ New page loads within 500ms

### ✅ 6.3 Memory Usage

1. Open DevTools (F12)
2. Go to Memory tab
3. Go to Events page
4. ✅ Memory usage < 50MB
5. Navigate between pages
6. ✅ Memory stable or decreasing (garbage collection)

---

## Phase 7: Browser Compatibility

### ✅ 7.1 Chrome/Edge
- ✅ All features work
- ✅ No console errors
- ✅ Responsive design works

### ✅ 7.2 Firefox
- ✅ All features work
- ✅ No console errors
- ✅ Responsive design works

### ✅ 7.3 Safari
- ✅ All features work
- ✅ No console errors
- ✅ Responsive design works

### ✅ 7.4 Mobile (Chrome DevTools)
1. Open DevTools (F12)
2. Toggle device toolbar (mobile view)
3. ✅ Events page readable on mobile
4. ✅ Filters accessible
5. ✅ Table scrollable horizontally
6. ✅ No layout broken

---

## Phase 8: Code Quality

### ✅ 8.1 TypeScript
```bash
npm run type-check
# Should show: ✓ No TypeScript errors
```

### ✅ 8.2 Linting
```bash
npm run lint
# Should show: ✓ No linting errors
```

### ✅ 8.3 Tests
```bash
npm test
# All tests should pass
# Coverage should be > 80%
```

### ✅ 8.4 Build
```bash
npm run build
# Should complete successfully
# No build warnings about unused dependencies
```

---

## Phase 9: Documentation Verification

### ✅ 9.1 Architecture Documentation
- ✅ `docs/FRONTEND_EVENTS_DEVICES.md` exists
- ✅ Covers type system
- ✅ Covers API client
- ✅ Covers components
- ✅ Covers pages
- ✅ Includes code examples
- ✅ Includes troubleshooting

### ✅ 9.2 Implementation Guide
- ✅ `FRONTEND_IMPLEMENTATION.md` exists
- ✅ Includes setup instructions
- ✅ Includes feature walkthroughs
- ✅ Includes API integration details
- ✅ Includes testing guide
- ✅ Includes common issues

### ✅ 9.3 Quick Start Guide
- ✅ `QUICKSTART_EVENTS_DEVICES.md` exists
- ✅ 5-minute quick start
- ✅ Feature overview
- ✅ Common tasks
- ✅ Troubleshooting tips

### ✅ 9.4 Code Comments
- ✅ Components have JSDoc comments
- ✅ Functions have parameter descriptions
- ✅ Complex logic has explanatory comments

---

## Phase 10: Integration Testing

### ✅ 10.1 Events ↔ Incidents

1. Find an event with incident_id
2. Click the event
3. ✅ Navigate to incident detail page
4. Scroll to "Related Events"
5. ✅ See the event you clicked in the list

### ✅ 10.2 Devices ↔ Events

1. Go to Devices page
2. Find a device
3. Note the device_id
4. Go to Events page
5. Enter device_id in "Device ID" filter
6. ✅ See only events from that device

### ✅ 10.3 Incidents ↔ Events ↔ Devices

1. Go to home page (Incidents)
2. Click an incident
3. See "Related Events" section
4. Click an event
5. ✅ See event details
6. Find device_id in event
7. Go to Devices page, search for device
8. ✅ See device details
9. All data is consistent

---

## Phase 11: Regression Testing

### ✅ 11.1 Existing Incident Page Still Works

1. Go to home page (/)
2. ✅ Incidents load
3. Click an incident
4. ✅ Incident detail page shows correctly
5. ✅ No broken links

### ✅ 11.2 Header Navigation Works

1. On any page, click "Incidents"
2. ✅ Navigate to home
3. Click "Events"
4. ✅ Navigate to /events
5. Click "Devices"
6. ✅ Navigate to /devices

### ✅ 11.3 No Breaking Changes

1. All existing API calls still work
2. ✅ Health check works
3. ✅ Incident list works
4. ✅ Incident detail works

---

## Phase 12: Final Sign-Off

### ✅ Overall Assessment

- [ ] All phases passed
- [ ] No critical issues found
- [ ] Performance acceptable
- [ ] Tests passing
- [ ] Documentation complete
- [ ] Code quality good
- [ ] Ready for production

### ✅ Sign-Off

**Developer:** _________________________ **Date:** _________

**Reviewer:** _________________________ **Date:** _________

**QA:** _________________________ **Date:** _________

---

## Quick Verification Summary

```bash
# 1. Run all checks (5 minutes)
npm run type-check && npm test && npm run build

# 2. Start dev environment
npm run dev

# 3. Visual verification
# - Open http://localhost:3000/events (should load)
# - Open http://localhost:3000/devices (should load)
# - Try a filter on each page
# - Verify no console errors (F12)

# 4. If all pass, deployment ready! ✅
```

---

## Troubleshooting Failed Verification

### If tests fail:
```bash
npm test -- --verbose
# Check error messages
# Fix code accordingly
npm test
```

### If build fails:
```bash
npm run build -- --debug
# Check error messages
# Common issue: missing type definitions
# Solution: npm install --save-dev @types/...
```

### If page won't load:
1. Check backend is running: `curl http://localhost:8000/health`
2. Check browser console (F12) for errors
3. Check network tab for failed requests
4. Check NEXT_PUBLIC_API_URL env variable

### If data doesn't appear:
1. Ensure STORAGE_MODE is set correctly
2. If using ClickHouse, verify it's running: `docker ps`
3. If using memory mode, run demo: `python demo_end_to_end.py`
4. Check backend logs for errors

---

**This verification guide ensures complete and proper deployment of the Events and Devices frontend pages.**
