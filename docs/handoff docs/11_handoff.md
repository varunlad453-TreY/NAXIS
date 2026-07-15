# Handoff Document — Session 11

**Date:** 2026-07-14
**Project:** Network Resilient Platform (Naxis)
**AI Agent:** opencode (deepseek-v4-flash-free)

---

## 1. Session Objective

Fix the topology page browser unresponsiveness caused by `dagre.layout()` blocking the main thread. The user reported that visiting `/topology` made the browser show "page unresponsive" — the root cause was the `O(N²)` dagre graph layout running synchronously on every data fetch and every interaction (filter toggle, expand/collapse).

---

## 2. What Was Done

### 2.1 Web Worker for Dagre Layout

**Problem:** `buildGroupedLayout()` in `layout.ts` calls `dagre.layout(g)` which blocks the main thread for 200ms–2s+ with hundreds of nodes. This ran inside a `useMemo` in `topology-graph.tsx`, executing on every render where inputs changed (poll, filter, expand/collapse).

**Solution:** Created a Web Worker that runs `buildGroupedLayout()` off the main thread.

**New files:**

| File | Purpose |
|---|---|
| `frontend/src/components/topology/layout.worker.ts` | Web Worker — imports `buildGroupedLayout`, listens for `COMPUTE` messages, posts `RESULT` back with the layout |
| `frontend/src/components/topology/use-topology-layout.ts` | React hook — manages Worker lifecycle, requestId-based stale message filtering, synchronous fallback, and `isComputing` state |
| `frontend/src/components/topology/use-topology-layout.test.ts` | 8 tests covering creation, termination, messaging, stale results, error fallback, and computing state |

**Modified files:**

| File | What Changed |
|---|---|
| `frontend/src/components/topology/topology-graph.tsx` | Replaced `useMemo → buildGroupedLayout()` with `useTopologyLayout()` hook. Added `isComputing && initialNodes.length === 0` → loading spinner. Removed `<MiniMap>` (was causing additional re-render overhead). Import `Loader2` icon |
| `frontend/src/components/topology/index.ts` | Added `useTopologyLayout` export + types |

### 2.2 Architecture

```
┌──────────────────────────────────────────────────────────┐
│  TopologyGraph (topology-graph.tsx)                       │
│    │                                                      │
│    ├── useTopologyLayout({ nodes, edges, filters, ... })  │
│    │    │                                                  │
│    │    ├── [Mount] creates Worker (useEffect, once)      │
│    │    │    └── new Worker('./layout.worker.ts', ...)     │
│    │    │                                                  │
│    │    ├── [Input change] posts COMPUTE message           │
│    │    │    └── worker.postMessage({ type, payload,       │
│    │    │         _requestId })                            │
│    │    │                                                  │
│    │    ├── [Worker responds] onmessage filters by         │
│    │    │    _requestId to discard stale results           │
│    │    │    └── setResult(payload)                        │
│    │    │                                                  │
│    │    ├── [Worker error] onerror → terminates worker,    │
│    │    │    sets fallbackRef, runs sync buildGroupedLayout│
│    │    │                                                  │
│    │    └── [Unmount] terminate() worker                   │
│    │                                                       │
│    └── ReactFlow canvas                                    │
│         ├── Shows spinner when isComputing && no nodes     │
│         └── Renders graph when layout is ready             │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  layout.worker.ts (separate thread)       │
│                                           │
│  onmessage(COMPUTE) →                     │
│    reconstruct Sets from arrays           │
│    → buildGroupedLayout()                 │
│    → postMessage(RESULT)                  │
└──────────────────────────────────────────┘
```

### 2.3 Stale Message Handling

Each `COMPUTE` message includes an incrementing `_requestId`. The worker echoes it back in the `RESPONSE`. The hook's `onmessage` handler only applies results where `_requestId === requestIdRef.current`. This prevents:

- Rapid filter toggles from showing intermediate stale layouts
- Poll-triggered results overwriting user's latest expand/filter action

### 2.4 Fallback Chain

```
Worker available? ──NO──→ Synchronous buildGroupedLayout() (same as before)
     │
    YES
     │
Worker create succeeds? ──NO──→ fallbackRef=true → sync fallback
     │
    YES
     │
Worker runs → success → render result
     │
     └── error → terminate worker → fallbackRef=true → sync fallback
```

### 2.5 MiniMap Removed

`<MiniMap>` was removed from `topology-graph.tsx` because it triggers a full re-render of all miniature node shapes on every graph update. Combined with the dagre layout and 30-second polling, it contributed significantly to frame drops.

**Loss:** Bird's-eye overview of the full topology.
**Gain:** Smoother interactions, less paint work per frame.

### 2.6 Loading State

When `isComputing` is `true` and `layoutNodes.length === 0` (initial computation), a centered spinner with "Computing network topology layout..." is shown inside the graph area. Once the worker returns, the ReactFlow canvas renders with the computed nodes/edges.

For subsequent computations (filter change, expand/collapse), the previous layout remains visible while the worker computes — no visual flash.

---

## 3. Trade-offs

| Before | After |
|---|---|
| Page freezes for 200ms–2s+ on every action | Page stays responsive, spinner shown during initial compute |
| MiniMap visible | MiniMap removed (paint overhead) |
| Immediate layout on data arrival | Slight delay for Worker startup + compute on first load |
| Simple useMemo call | Worker lifecycle + message passing code |

---

## 4. Files Created/Modified

### Created
- `frontend/src/components/topology/layout.worker.ts` (36 lines)
- `frontend/src/components/topology/use-topology-layout.ts` (129 lines)
- `frontend/src/components/topology/use-topology-layout.test.ts` (210 lines)

### Modified
- `frontend/src/components/topology/topology-graph.tsx` — replaced useMemo with hook, added spinner, removed MiniMap
- `frontend/src/components/topology/index.ts` — added useTopologyLayout export

---

## 5. How to Verify

```bash
cd frontend
npx tsc --noEmit        # TypeScript check — should pass
npx vitest run          # 60 tests across 6 files — all pass

# Manual:
# Open http://localhost:3000/topology
# 1. Page should load without freezing the browser tab
# 2. Brief "Computing network topology layout..." spinner on first load
# 3. Click type filter toggles → layout updates without jank
# 4. Expand/collapse sites → smooth, no freezing
# 5. Search and select a node → smooth zoom animation
# 6. Try the old behavior (for comparison):
#    Comment out the worker hook, restore useMemo → browser freezes
```

---

## 6. Known Caveats

- **MiniMap removed.** If users request it back, add it back but debounce re-renders or only render when graph is idle.
- **Worker startup latency.** First layout computation includes Worker module loading + dagre import. On slow connections or large bundles, the spinner may show for 1-2s.
- **5-second timeout.** A `console.warn` fires if layout takes >5s. Currently just a warning — no user-visible error. If the timeout fires, investigate whether dagre's `O(N²)` is the bottleneck or if the worker itself is lagging.
- **Worker unavailable.** Falls back to synchronous computation (same behavior as before). This happens in environments that don't support `Worker` (very old browsers) or if the worker URL fails to resolve. The `fallbackRef` is set permanently once triggered — a page refresh is needed to retry the worker.

---

## 7. Test Results

```
Test Files  6 passed (6)
     Tests  60 passed (60)
```

| Test File | Tests |
|---|---|
| `layout.test.ts` | 20 |
| `use-topology-layout.test.ts` | 8 |
| `blast-radius-panel.test.tsx` | 10 |
| `node-detail-panel.test.tsx` | 10 |
| `topology-side-panel.test.tsx` | 6 |
| `health-history-chart.test.tsx` | 6 |

---

## 8. Future Improvements (if needed)

- **Degraded-mode notification:** If the worker falls back to sync, show a subtle toast so the user knows the page might be slower.
- **Virtual list for large topologies:** For 5000+ nodes, consider paginating or clustering the graph.
- **Worker pool:** If multiple heavy computations are needed (blast radius + full topology), consider a pool of workers.
