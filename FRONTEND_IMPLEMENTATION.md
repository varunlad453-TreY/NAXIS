# Frontend Implementation Checklist & Integration Guide

## What's New (Milestone B Frontend)

### ✅ Completed

#### Type System
- [x] Event types (`src/types/event.ts`)
- [x] Device types (`src/types/device.ts`)
- [x] Filter parameter types

#### API Client
- [x] `api.listEvents()` method with filtering
- [x] `api.listDevices()` method with filtering
- [x] Proper URL parameter encoding
- [x] Error handling

#### Event Components
- [x] EventSeverityBadge component
- [x] EventRow component (table display)
- [x] EventListSkeleton loading state
- [x] EventEmptyState empty state

#### Device Components
- [x] DeviceReachabilityBadge component
- [x] DeviceRow component (table display)
- [x] DeviceListSkeleton loading state
- [x] DeviceEmptyState empty state

#### Pages
- [x] `/events` page with full filtering and pagination
- [x] `/devices` page with full filtering and pagination
- [x] Enhanced `/incidents/[id]` detail page with event list
- [x] Updated header navigation

#### Tests
- [x] API client tests
- [x] Badge component tests
- [x] Row component tests
- [x] Coverage for filtering, pagination, error handling

#### Documentation
- [x] Complete architecture documentation
- [x] Component API documentation
- [x] Integration guide (this file)
- [x] Test coverage documentation

---

## Running the Application

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Then navigate to:
- http://localhost:3000 - Home (Incidents)
- http://localhost:3000/events - Events page
- http://localhost:3000/devices - Devices page

### Production Build

```bash
npm run build
npm start
```

---

## Feature Walkthroughs

### Events Page (`/events`)

**What it shows:** Raw telemetry events from your network infrastructure

**Key Features:**
1. **Search:** Find events by title, description, device, or site
2. **Severity Filter:** Select one or more severity levels
3. **Vendor Filter:** Filter by source vendor (DNAC, Mist, Arista, etc.)
4. **Site/Device Filters:** Narrow to specific locations or devices
5. **Pagination:** 50 events per page with Previous/Next buttons
6. **Auto-refresh:** Updates every 10 seconds automatically
7. **Manual Refresh:** Button to pull latest data immediately

**Common Workflows:**

*Finding critical events:*
1. Click "Critical" in Severity filter
2. View all critical severity events
3. Click an event to see related incident

*Searching for device issues:*
1. Type device name in "Device ID" field
2. See all events from that device
3. Identify patterns in event types

*Filtering by site:*
1. Enter site ID in "Site ID" field
2. View all events from that location
3. Understand site-wide health

### Devices Page (`/devices`)

**What it shows:** Network device inventory discovered from events

**Key Features:**
1. **Search:** Find devices by hostname, IP, device ID, or type
2. **Platform Filter:** Filter by vendor platform
3. **Site Filter:** Filter by location
4. **Reachability Filter:** Show only reachable/unreachable devices
5. **Pagination:** 50 devices per page
6. **Last Seen:** Timestamp of last event from device

**Common Workflows:**

*Finding unreachable devices:*
1. Click "Unreachable" in Reachability filter
2. See all devices currently down
3. Plan remediation

*Device inventory by vendor:*
1. Select platform from dropdown
2. View all devices from that vendor
3. Check management state

*Site device inventory:*
1. Enter site ID
2. See all devices at that location
3. Plan capacity or maintenance

### Enhanced Incident Detail Page

**What Changed:**
- Real event display instead of event IDs
- Actual event details (time, severity, device, description)
- Link to related events
- "View all events" link to Events page

**Integration:**
- Click on any event to navigate to related incident
- See incident timeline with actual events
- Understand incident's root cause through events

---

## API Integration

### Backend Requirements

Your backend must provide:

1. **`GET /events`** endpoint
   - Query parameters: source, severity, site_id, device_id, incident_id, start_time, end_time, limit, offset
   - Returns: EventListResponse with events array
   - Must support filtering and pagination

2. **`GET /devices`** endpoint
   - Query parameters: platform, site_id, reachability, limit, offset
   - Returns: DeviceListResponse with devices array
   - Must support filtering and pagination

### Data Flow

```
Frontend (React)
    ↓
API Client (api.ts)
    ↓
HTTP Request (GET /events, /devices)
    ↓
Backend API (FastAPI)
    ↓
Storage (ClickHouse, Neo4j, Memory)
```

### Example API Responses

**Events:**
```json
{
  "events": [
    {
      "event_id": "evt-123",
      "timestamp": "2026-06-26T10:30:00Z",
      "source": "dnac",
      "severity": "critical",
      "category": "network",
      "event_type": "device_down",
      "title": "Device Down",
      "description": "Device 192.168.1.1 is unreachable",
      "device_id": "dev-1",
      "device_name": "Router-01",
      "site_id": "site-1",
      "site_name": "New York",
      "incident_id": "inc-1"
    }
  ],
  "total": 150,
  "page": 1,
  "page_size": 50
}
```

**Devices:**
```json
{
  "devices": [
    {
      "device_id": "dev-1",
      "platform": "dnac",
      "hostname": "router-01",
      "ip_address": "192.168.1.1",
      "device_type": "Router",
      "site_id": "site-1",
      "site_name": "New York",
      "reachability": "reachable",
      "management_state": "managed",
      "last_seen": "2026-06-26T10:30:00Z"
    }
  ],
  "total": 245,
  "page": 1,
  "page_size": 50
}
```

---

## Testing Guide

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- api.test.ts

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

### What's Tested

1. **API Client (`api.test.ts`)**
   - Event fetching with/without filters
   - Device fetching with/without filters
   - Pagination parameters
   - Error handling

2. **Components**
   - EventSeverityBadge rendering
   - DeviceReachabilityBadge rendering
   - EventRow display and interaction
   - DeviceRow display and interaction

3. **Coverage**
   - All filter combinations
   - Edge cases (empty results, errors)
   - Component prop variations

### Writing New Tests

For a new component or feature:

```typescript
import { render, screen } from "@testing-library/react";
import { YourComponent } from "@/components/your-component";

describe("YourComponent", () => {
  it("should render correctly", () => {
    render(<YourComponent prop="value" />);
    expect(screen.getByText("expected text")).toBeInTheDocument();
  });
});
```

---

## Styling & Customization

### Color Scheme

The frontend uses Naxis design tokens defined in `tailwind.config.ts`:

**Event Severity Colors:**
- Critical: Red (#ef4444)
- Major: Orange (#f97316)
- Minor: Yellow (#eab308)
- Info: Blue (#3b82f6)

**Device Reachability Colors:**
- Reachable: Green (#22c55e)
- Unreachable: Red (#ef4444)
- Unknown: Gray (#6b7280)

### Customizing Appearance

All components use Tailwind CSS. To customize:

1. Edit `tailwind.config.ts` for token changes
2. Modify component JSX for layout changes
3. Update `src/styles/globals.css` for global styles

### Responsive Behavior

Components are mobile-responsive:
- Desktop: Full table layout
- Tablet: Condensed columns
- Mobile: Stack horizontally

---

## Performance Optimization

### Current Optimizations

1. **Pagination:** 50 items per page limits payload size
2. **Auto-refresh:** 
   - Events: 10s (fast updates)
   - Devices: 30s (slow changes)
3. **React Query:** Built-in caching and deduplication
4. **Component Memoization:** Prevents unnecessary re-renders

### Future Improvements

1. **Virtual Scrolling:** For >1000 items
2. **WebSocket Updates:** Real-time instead of polling
3. **Lazy Loading:** Load items as needed
4. **Service Worker:** Offline support and background sync

---

## Common Issues & Solutions

### Issue: Events page shows "No events found"

**Causes:**
1. Backend `/events` endpoint not running
2. STORAGE_MODE=memory (no persistent data)
3. Worker not pushing events
4. Filters too restrictive

**Solution:**
1. Check backend logs: `docker logs naxis-api`
2. Verify STORAGE_MODE=clickhouse
3. Check worker logs: `docker logs naxis-worker`
4. Click "Reset all" to clear filters

### Issue: Devices page is slow

**Causes:**
1. Large number of devices (1000+)
2. Slow backend query
3. Network latency

**Solution:**
1. Use filters to narrow results
2. Check database query performance
3. Implement virtual scrolling (future)
4. Use pagination more aggressively

### Issue: Timestamps are wrong

**Causes:**
1. Backend returning timestamps in different timezone
2. Browser timezone mismatch
3. DST transition issues

**Solution:**
1. Verify backend timestamps are UTC
2. Check browser timezone settings
3. Use `formatAbsoluteTimestamp()` utility for consistent display

### Issue: Filters not working

**Causes:**
1. Backend doesn't support that filter parameter
2. URL encoding issue
3. Cache not updated

**Solution:**
1. Check API implementation
2. Open DevTools → Network tab → check query parameters
3. Click "Refresh" button to force API call
4. Check browser console for errors

---

## Deployment

### Prerequisites

1. Backend API running (port 8000)
2. All endpoints implemented:
   - GET /health
   - GET /incidents
   - GET /incidents/active
   - GET /incidents/{id}
   - GET /events
   - GET /devices

### Environment Variables

```bash
# .env.local (development)
NEXT_PUBLIC_API_URL=http://localhost:8000

# Production
NEXT_PUBLIC_API_URL=https://api.naxis.yourdomain.com
```

### Docker Deployment

```bash
# Build
docker build -f frontend/Dockerfile -t naxis-frontend:latest .

# Run
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://backend:8000 \
  naxis-frontend:latest
```

### Kubernetes Deployment

See `frontend/k8s-deployment.yaml` for Helm chart configuration.

---

## Contributing

### Adding a New Filter

1. Add parameter to `EventFilterParams` or `DeviceFilterParams`
2. Add UI input in page component
3. Update API call to include parameter
4. Add tests for new filter
5. Document in this guide

### Adding a New Component

1. Create component in `src/components/`
2. Add TypeScript interfaces
3. Add tests in `.test.tsx` file
4. Export from component index
5. Update this guide

### Code Style

- Use TypeScript strict mode
- Add JSDoc comments for exports
- Write tests for all new features
- Follow existing code formatting

---

## Support & Debugging

### Enable Debug Logging

```typescript
// In page.tsx
if (process.env.NODE_ENV === 'development') {
  console.log("Events fetched:", data);
}
```

### Browser DevTools

1. **Network Tab:** Check API requests/responses
2. **React DevTools:** Inspect component state
3. **Console:** Check for errors and warnings

### Backend Debugging

```bash
# Check what data exists
docker exec naxis-clickhouse clickhouse-client

SELECT COUNT(*) FROM events;
SELECT COUNT(*) FROM devices;
MATCH events WHERE event_id = 'evt-123';
```

---

## Next Steps

### Immediate
1. ✅ Deploy frontend pages
2. ✅ Verify API integration
3. ✅ Run tests
4. ✅ Collect user feedback

### Short Term (Week 2-3)
1. Export events/devices to CSV
2. Advanced date range picker
3. Event correlation visualization
4. Performance optimizations

### Medium Term (Month 2)
1. Device detail page
2. Event timeline view
3. Real collectors integration
4. Advanced analytics

### Long Term (Month 3+)
1. Machine learning features
2. Predictive incidents
3. Multi-tenant support
4. Advanced topology integration

---

## Version History

**v1.0.0** (2026-06-26)
- Initial implementation
- Events and Devices pages
- Enhanced incident detail
- Complete test coverage
- Full documentation

---

For questions or issues, refer to the backend documentation or contact the team.
