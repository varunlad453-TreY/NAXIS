# Naxis Frontend

Next.js 14 web application for Naxis operational intelligence platform.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **State**: TanStack Query for server state
- **Visualization**: React Flow for topology graphs
- **HTTP**: Axios

## Structure

```
src/
├── app/              # Next.js App Router pages
├── components/       # React components
├── lib/              # Utilities and API client
├── hooks/            # Custom React hooks
├── types/            # TypeScript type definitions
└── styles/           # Global styles
```

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type check
npm run type-check

# Lint
npm run lint
```

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Features

### 📊 Incidents View
- Real-time incident dashboard
- Severity-based filtering
- Incident detail with related events
- Confidence scoring
- Status tracking

### 📋 Events View (NEW - Milestone B)
- Raw telemetry event timeline
- Advanced filtering:
  - By severity (Critical, Major, Minor, Info)
  - By vendor source (DNAC, Mist, Arista, etc.)
  - By site and device
  - By incident correlation
- Full-text search
- Pagination (50 items/page)
- Auto-refresh every 10 seconds
- Click through to related incidents

### 🖥️ Devices View (NEW - Milestone B)
- Device inventory discovery
- Filtering by:
  - Platform/vendor
  - Site location
  - Reachability status
- Search across device properties
- Pagination (50 items/page)
- Auto-refresh every 30 seconds
- Last seen tracking

### 🌐 Topology View
- Interactive network graph
- Device relationships and connections
- Blast radius visualization
- (In Development)

### 🤖 RCA View
- AI-assisted root cause analysis
- Probable cause explanations
- Related event context
- (In Development)

## New Pages & Components (Milestone B)

### Pages
- `/events` - Event timeline and filtering
- `/devices` - Device inventory explorer
- `/incidents` - Enhanced with related events display

### Components
**Events Components**
- `EventSeverityBadge` - Severity color coding
- `EventRow` - Individual event display
- `EventListSkeleton` - Loading state
- `EventEmptyState` - Empty state message

**Devices Components**
- `DeviceReachabilityBadge` - Reachability status
- `DeviceRow` - Individual device display
- `DeviceListSkeleton` - Loading state
- `DeviceEmptyState` - Empty state message

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

## Documentation

- **[Quick Start](../QUICKSTART_EVENTS_DEVICES.md)** - 5-minute getting started
- **[Frontend Implementation](../FRONTEND_IMPLEMENTATION.md)** - Complete integration guide
- **[Architecture Guide](../docs/FRONTEND_EVENTS_DEVICES.md)** - Design and implementation details
- **[Verification Guide](../VERIFICATION_GUIDE.md)** - Testing checklist
- **[Delivery Summary](../DELIVERY_SUMMARY.md)** - What's included

## API Integration

The frontend connects to the Naxis backend API:

```
GET /health              - Health check
GET /incidents           - List incidents
GET /incidents/active    - Active incidents only
GET /incidents/{id}      - Incident details
GET /events              - Event timeline (NEW)
GET /devices             - Device inventory (NEW)
```

All endpoints support filtering, pagination, and time ranges.

## Performance

- Events page: ~500ms initial load
- Devices page: ~600ms initial load
- Auto-refresh: 10s (events), 30s (devices)
- Memory usage: <50MB per page
- Responsive: <200ms for filter/pagination
