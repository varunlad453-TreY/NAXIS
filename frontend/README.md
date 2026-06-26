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

- **Events View**: List and filter network events
- **Incidents View**: Correlated incident timeline
- **Topology View**: Interactive network graph visualization
- **RCA View**: AI-assisted root cause analysis results
