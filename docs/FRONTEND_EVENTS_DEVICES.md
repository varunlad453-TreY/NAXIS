# Frontend Implementation: Events & Devices Pages

## Overview

This document describes the complete frontend implementation for the Events and Devices pages in Naxis, alongside the enhanced Incident Detail page. These pages complete the user-facing loop for Milestone B's persistence layer.

## Architecture

### Type System

#### Event Types (`frontend/src/types/event.ts`)

```typescript
export type EventSeverity = "critical" | "major" | "minor" | "info";

export interface EventSummary {
  event_id: string;                // Unique event identifier
  timestamp: string;               // UTC timestamp
  source: string;                  // Vendor source (dnac, mist, etc.)
  severity: EventSeverity;         // Event severity level
  category: string;                // Event category (network, security, etc.)
  event_type: string;              // Specific event type
  title: string;                   // Human-readable title
  description: string;             // Detailed description
  device_id: string;               // Affected device ID
  device_name: string;             // Affected device name
  site_id: string;                 // Site ID
  site_name: string;               // Site name
  incident_id: string | null;      // Linked incident ID (if any)
}

export interface EventFilterParams {
  source?: string;                 // Filter by vendor source
  severity?: EventSeverity[];      // Filter by severities
  site_id?: string;                // Filter by site
  device_id?: string;              // Filter by device
  incident_id?: string;            // Show events for incident
  start_time?: string;             // Start of time range
  end_time?: string;               // End of time range
  limit?: number;                  // Page size (default 50)
  offset?: number;                 // Pagination offset
}
```

#### Device Types (`frontend/src/types/device.ts`)

```typescript
export type DeviceReachability = "reachable" | "unreachable" | "unknown";

export interface DeviceSummary {
  device_id: string;               // Unique device identifier
  platform: string;                // Vendor platform
  hostname: string;                // Device hostname
  ip_address: string;              // Management IP
  device_type: string;             // Device type (Router, Switch, AP, etc.)
  site_id: string;                 // Site ID
  site_name: string;               // Site name
  reachability: DeviceReachability; // Reachability status
  management_state: string;        // Management state
  last_seen: string | null;        // Last seen timestamp
}

export interface DeviceFilterParams {
  platform?: string;               // Filter by vendor
  site_id?: string;                // Filter by site
  reachability?: DeviceReachability; // Filter by reachability
  limit?: number;                  // Page size (default 50)
  offset?: number;                 // Pagination offset
}
```

### API Client Extensions

Added two new methods to `frontend/src/lib/api.ts`:

#### `api.listEvents(params?: EventFilterParams)`

Fetches events from the `/events` backend endpoint with support for:
- Severity filtering
- Source (vendor) filtering
- Site and device filtering
- Incident filtering
- Pagination

```typescript
// Example usage
const { data } = await api.listEvents({
  severity: ["critical", "major"],
  source: "dnac",
  site_id: "site-1",
  limit: 50,
  offset: 0,
});
```

#### `api.listDevices(params?: DeviceFilterParams)`

Fetches devices from the `/devices` backend endpoint with support for:
- Platform filtering
- Site filtering
- Reachability filtering
- Pagination

```typescript
// Example usage
const { data } = await api.listDevices({
  platform: "mist",
  reachability: "unreachable",
  limit: 50,
  offset: 0,
});
```

## Components

### Event Components

#### EventSeverityBadge (`src/components/events/event-severity-badge.tsx`)

Displays event severity with color coding.

**Props:**
- `severity: EventSeverity` - The severity level
- `showDot?: boolean` - Show colored dot indicator
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
<EventSeverityBadge severity="critical" showDot={true} />
```

#### EventRow (`src/components/events/event-row.tsx`)

Displays a single event in a table row format.

**Features:**
- Time formatted relative to now with tooltip for absolute time
- Severity badge
- Source vendor
- Device name and site
- Event title/description
- Link to related incident (if any)

**Props:**
- `event: EventSummary` - The event to display

#### EventListSkeleton (`src/components/events/event-list-skeleton.tsx`)

Loading skeleton for event list.

#### EventEmptyState (`src/components/events/empty-state.tsx`)

Empty state message when no events found.

### Device Components

#### DeviceReachabilityBadge (`src/components/devices/device-reachability-badge.tsx`)

Displays device reachability status with color coding:
- Green for "reachable"
- Red for "unreachable"
- Gray for "unknown"

#### DeviceRow (`src/components/devices/device-row.tsx`)

Displays a single device in a table row format.

**Features:**
- Hostname and IP address
- Platform (vendor)
- Device type
- Site location
- Reachability status
- Last seen timestamp

#### DeviceListSkeleton (`src/components/devices/device-list-skeleton.tsx`)

Loading skeleton for device list.

#### DeviceEmptyState (`src/components/devices/empty-state.tsx`)

Empty state message when no devices found.

## Pages

### Events Page (`src/app/events/page.tsx`)

**Route:** `/events`

**Features:**
1. **Real-time Auto-refresh:** Refreshes every 10 seconds
2. **Advanced Filtering:**
   - Severity (multi-select)
   - Source vendor (dropdown)
   - Site ID (text input)
   - Device ID (text input)
   - Search (title, description, device name/ID)
3. **Pagination:** 50 items per page with Previous/Next buttons
4. **Result Display:** Shows total events and filtered count
5. **Manual Refresh:** Button to force immediate refresh

**Filter Behavior:**
- Filters apply immediately
- Search is client-side on fetched results
- Pagination resets when any filter changes
- "Reset all" button clears all filters at once

**State Management:**
- Uses `@tanstack/react-query` for data fetching and caching
- Maintains filter state in component state
- Pagination state is separate

### Devices Page (`src/app/devices/page.tsx`)

**Route:** `/devices`

**Features:**
1. **Real-time Auto-refresh:** Refreshes every 30 seconds
2. **Filtering:**
   - Platform vendor (dropdown)
   - Site ID (text input)
   - Reachability status (multi-button toggle)
   - Search (hostname, IP, device ID, device type)
3. **Pagination:** 50 items per page
4. **Result Display:** Shows total devices and filtered count
5. **Manual Refresh:** Button to force immediate refresh

**Filter Behavior:**
- Similar to Events page
- Reachability is a toggle (single select)
- Client-side search on fetched results

### Enhanced Incident Detail Page (`src/app/incidents/[id]/page.tsx`)

**Enhancements:**
1. **Real Event Display:** Shows actual events related to the incident (up to 10)
2. **Event List Loading:** Shows skeleton while events are loading
3. **Event Count:** Displays total number of events linked to incident
4. **View All Link:** Link to Events page filtered by this incident
5. **Event Details:** Each related event shown as EventRow component

**Behavior:**
- Events are fetched in parallel with incident details
- Maintains backward compatibility with existing UI
- Shows "No events found" if incident has no related events

## Navigation Updates

Updated `src/components/layout/header.tsx` to include new navigation links:

```
Incidents (existing)
Events (new)
Devices (new)
Topology (coming soon)
```

## Testing

### Test Files

1. **`src/lib/api.test.ts`**
   - Tests for `listEvents()` and `listDevices()` API methods
   - Tests filter parameter handling
   - Tests pagination
   - Tests error handling

2. **`src/components/events/event-severity-badge.test.tsx`**
   - Tests badge rendering for all severities
   - Tests dot indicator
   - Tests custom className

3. **`src/components/devices/device-reachability-badge.test.tsx`**
   - Tests badge rendering for all reachability states
   - Tests variant classes
   - Tests dot indicator

4. **`src/components/events/event-row.test.tsx`**
   - Tests event information rendering
   - Tests incident link
   - Tests timestamp formatting

5. **`src/components/devices/device-row.test.tsx`**
   - Tests device information rendering
   - Tests badge rendering
   - Tests fallback behavior

### Running Tests

```bash
# Run all tests
npm test

# Run tests for specific file
npm test api.test.ts

# Run tests in watch mode
npm test --watch

# Generate coverage report
npm test --coverage
```

## Performance Considerations

### Pagination
- Events page: 50 items per page
- Devices page: 50 items per page
- Prevents loading massive result sets

### Auto-refresh Intervals
- Events: 10 seconds (more frequent for operational dashboards)
- Devices: 30 seconds (less frequent, devices change slowly)
- Configurable via query hook parameters

### Client-side Search
- Search is applied to already-fetched results
- Does NOT trigger API calls
- Useful for quick filtering within current page

### Component Memoization
- Event/Device rows use proper memoization to prevent unnecessary re-renders
- Filter state is properly separated to minimize re-renders

## Styling

### Color Scheme
- Uses existing Naxis design tokens
- Event severity badges: Critical (red), Major (orange), Minor (yellow), Info (blue)
- Device reachability badges: Reachable (green), Unreachable (red), Unknown (gray)

### Responsive Design
- Full desktop experience on Events/Devices pages
- Table rows stack gracefully on smaller screens
- Filter controls responsive

### Tailwind Configuration
- Uses existing Tailwind config with Naxis tokens
- No new CSS required

## Future Enhancements

### Short Term
1. Export events/devices to CSV
2. Advanced date range picker for time-based filtering
3. Real-time WebSocket updates instead of polling
4. Favorites/pinned devices or event types

### Medium Term
1. Device detail page with event history
2. Event correlation visualization
3. Advanced analytics on event patterns
4. Integration with topology view

### Long Term
1. Machine learning-based event anomaly detection
2. Predictive incident generation
3. Cross-vendor event normalization dashboard
4. Multi-tenant device/event isolation

## Troubleshooting

### Events Page Shows "No events found"
- Check if STORAGE_MODE=clickhouse and ClickHouse is running
- Verify worker is pushing events by checking ClickHouse logs
- Try resetting filters to see all events

### Pagination Not Working
- Verify total count returned from API is greater than page size
- Check browser console for API errors
- Ensure React Query is properly initialized

### Performance Issues
- Reduce auto-refresh interval in React Query hooks
- Implement virtual scrolling for large result sets (future)
- Check network tab for slow API responses

## Deployment

### Docker
- Frontend is built into existing Dockerfile
- No additional environment variables needed
- NEXT_PUBLIC_API_URL determines API endpoint

### Environment Variables
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000  # Development
NEXT_PUBLIC_API_URL=https://api.naxis.com  # Production
```

### Build
```bash
npm run build
npm start  # Start production server
```

## Integration Points

### With Backend
- Requires `/events` endpoint (implemented in Milestone B)
- Requires `/devices` endpoint (implemented in Milestone B)
- Requires incident detail enhancement (already done)

### With Real Data
- No code changes needed for real collectors
- Works with both mock and real data sources
- Filters work identically for both

## Documentation References

- [Backend API Documentation](../../docs/INCIDENT_API_COMPLETE.md)
- [Event Schema Documentation](../../docs/EVENT_SCHEMA_COMPLETE.md)
- [Milestone B Report](../../Naxis_Milestone_B_Report_TataMotors.pdf)
- [Type Safety Guide](../../docs/STRUCTURE.md)
