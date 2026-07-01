# Naxis Frontend

Next.js 14 web application for the Naxis operational intelligence platform.

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
├── components/       # React components (domain + shared)
│   ├── dashboard/
│   ├── devices/
│   ├── layout/
│   └── ui/
├── config/           # Global config (navigation, etc.)
├── hooks/            # Custom React hooks
├── lib/              # Utilities and API client
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

# Run tests
npm test
```

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Navigation

Primary navigation lives in `src/config/navigation.ts` and is rendered by the collapsible left sidebar.

| Section      | Route            | Status        |
|--------------|------------------|---------------|
| Operational  | `/`              | Dashboard     |
| Operational  | `/integrations`  | Implemented   |
| Operational  | `/topology`      | Placeholder   |
| Insights     | `/performance`   | Placeholder   |
| Insights     | `/connectivity`  | Placeholder   |
| Insights     | `/clients`       | Placeholder   |
| Platform     | `/settings`      | Placeholder   |
| Platform     | `/help`          | Placeholder   |

Add a new sidebar item by editing `src/config/navigation.ts` and creating the matching route under `src/app/`.

## Features

### 📊 Dashboard (`/`)
- Platform health HUD with live counters
- Platform observer cards (Juniper Mist, Cisco DNA Center, Arista SD-WAN, Arista WLC)
- Collapsible full-inventory panel

### 🔌 Integrations (`/integrations`)
- Data-source control plane
- Collector status and re-sync actions

### 🖥️ Devices (`/devices`)
- Device inventory explorer
- Search across hostname, MAC, model, site, IP, serial
- Filter by platform and reachability
- Group by site or flat list view

### 🌐 Topology View
- Interactive network graph (in development)

## Page Composition Conventions

Keep `page.tsx` files thin (~150 lines). Delegate sections to `components/[domain]/`:

- Dashboard → `components/dashboard/`
- Devices → `components/devices/`

See `docs/FRONTEND_ARCHITECTURE.md` for the full conventions guide.

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

## API Integration

The frontend connects to the Naxis backend API:

```
GET /health              - Health check
GET /events              - Event timeline
GET /devices             - Device inventory
GET /incidents           - Incident list
GET /incidents/active    - Active incidents
GET /incidents/{id}      - Incident details
```

All endpoints support filtering, pagination, and time ranges.

## Documentation

- **[Frontend Architecture](../docs/FRONTEND_ARCHITECTURE.md)** - Structure, conventions, and how to extend
- **[Quick Start](../QUICKSTART_EVENTS_DEVICES.md)** - 5-minute getting started
- **[Frontend Implementation](../FRONTEND_IMPLEMENTATION.md)** - Complete integration guide
- **[Verification Guide](../VERIFICATION_GUIDE.md)** - Testing checklist
- **[Delivery Summary](../DELIVERY_SUMMARY.md)** - What's included
