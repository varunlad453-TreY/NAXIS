# Session 30 Handoff — WP-1 canonical identity layer

> **Handoff Date:** Aug 5, 2026
> **Session Goal:** Implement the WP-1 canonical identity layer so vendor-native device identifiers resolve to a single `device_key` per physical device / site, enabling WP-2 correlation to match events across vendors and topologies.
> **Status:** Done. Full suite: **429 backend passed / 0 failed**.

---

## 1. Executive Summary

Session 29 closed WP-0. This session built the canonical identity tables, backfilled all live inventory, wired every collector to emit canonical device/site keys, and updated the topology resolver to use identity before falling back to legacy prefix heuristics.

| Area | Before | After |
|---|---|---|
| Identity schema | none | `sites`, `devices`, `device_identities` + `topology_nodes.canonical_key` |
| Live backfill | 0 identities | 153 sites, 4,102 device identities, 2,051 topology nodes linked |
| Mist events | raw UUID/MAC `device_id` | canonical `device_key` |
| VeloCloud events | raw edge id `device_id` | canonical `device_key` |
| DNAC/Arista/SNMP events | raw vendor ids | canonical `device_key` (collectors updated; sources disabled by default) |
| Topology resolution | prefix heuristic only | canonical key → identity → legacy heuristic |
| Tests | 418 passed | **429 passed** (new identity-resolver unit tests + updated mocks) |

---

## 2. Schema & resolver

### 2.1 New identity schema (`schemas/postgres/008_identity.sql`)

- `sites(site_key, name, parent_key, vendor_ids JSONB)` — one row per facility.
- `devices(device_key, display_name, device_type, role, model, vendor, site_key, serial, mac, ip_address)` — one row per physical device.
- `device_identities(device_key, vendor, vendor_device_id, vendor_display_name)` — many-to-one mapping from vendor-native IDs to `device_key`.
- `topology_nodes.canonical_key` — links every managed node to its canonical device/site.

### 2.2 Identity resolver (`backend/shared/database/identity.py`)

- `IdentityResolver` with per-instance in-memory cache.
- `resolve_device` / `find_device` / `resolve_devices` for device keys.
- `resolve_site` / `resolve_sites` for site keys.
- Bulk APIs use single DB round-trips for `resolve_devices` / `resolve_sites`.
- Idempotent upserts via `ON CONFLICT`.

### 2.3 Backfill script (`backend/scripts/backfill_identity.py`)

- Seeded identities from existing `inventory` rows for `mist` and `velocloud`.
- Live result: 153 sites, 4,102 devices, 2,051 topology nodes linked to canonical keys.

---

## 3. Collector wiring

### 3.1 Mist

- `backend/worker/collectors/mist_inventory.py` — seeds site + device identities after every inventory upsert (both `device_id` and `mac`).
- `backend/worker/collectors/mist.py` — event/alarm normalization resolves AP/device ID to canonical key.
- `backend/worker/collectors/mist_topology.py` — all sub-collectors (`MistApHistoryCollector`, `MistApRfCollector`, `MistClientTopologyCollector`, `MistWiredUplinkCollector`, `MistRadioNeighborsCollector`) receive a shared `IdentityResolver`; AP MACs/UUIDs resolve to canonical keys in emitted events.
- `backend/worker/collectors/topology_sync.py` — Mist topology nodes are written with `canonical_key` and site/device identities are resolved in bulk.

### 3.2 VeloCloud

- `backend/worker/collectors/velocloud_inventory.py` — seeds edge + site identities after inventory upsert.
- `backend/worker/collectors/velocloud.py` — all sub-collectors (`Edges`, `Links`, `Tunnels`, `Events`, `Apps`) share an `IdentityResolver`; edge IDs resolve to canonical keys.
- `backend/worker/collectors/topology_sync.py` — VeloCloud topology nodes are written with `canonical_key`.

### 3.3 DNAC

- `backend/worker/collectors/dnac.py` — `DnacDevicesCollector`, `DnacAlarmsCollector`, and `DnacInterfaceCollector` share an `IdentityResolver`; DNAC device IDs resolve to canonical keys. Topology/client-health snapshots do not carry per-device IDs and were left unchanged.

### 3.4 Arista WLC

- `backend/worker/collectors/arista_wlc.py` — `AristaWlcApsCollector` and `AristaWlcRadiosCollector` share an `IdentityResolver`; AP MACs resolve to canonical keys.

### 3.5 SNMP

- `backend/worker/collectors/snmp_poller.py` — each SNMP target resolves to a canonical device key; topology nodes store `canonical_key`; interface state-change events use the canonical key as `device_id`.

---

## 4. Topology resolution

`backend/shared/database/topology.py` now resolves in order:

1. Direct `canonical_key` match on `topology_nodes`.
2. Identity lookup: `vendor_device_id` → `device_key` → `node_id`.
3. Legacy prefix heuristic fallback (`mist-ap-`, `velo-edge-`, `switch-`, etc.).

`batch_resolve_node_ids` and `resolve_node_id` both follow this ladder, so events with canonical keys, legacy-format events, and mixed vendor environments all resolve correctly.

---

## 5. Tests

- `backend/tests/test_identity_resolver.py` — new unit tests for resolve/find/bulk device and site APIs.
- `backend/tests/test_mist_topology.py` — updated for async `_event_from_transition`.
- `backend/tests/test_topology_provider.py` — updated mocks for canonical-key resolution path.
- `backend/tests/test_topology_sync.py` — added deterministic `FakeIdentityResolver` for VeloCloud topology tests.
- `backend/tests/test_velocloud_collector.py` — verified VeloCloud sub-collectors still pass after async normalization.

Full run: **429 passed / 0 failed**.

---

## 6. Live verification

- Backfill script executed against the dockerised Postgres live DB:
  - 153 sites, 4,102 devices, 2,051 topology nodes linked.
- `topology_nodes.canonical_key` populated for Mist APs and sites; VeloCloud not enabled in live env so not live-verified.
- All backend tests green.

---

## 7. Watch items / deferred

- VeloCloud/DNAC/Arista/SNMP collectors are wired but disabled by default; live validation required when each source is enabled.
- SNMP remote neighbor nodes still use raw chassis IDs; local nodes are canonical. Cross-vendor SNMP↔Mist correlation would need neighbor identity resolution in a future pass.
- `graphify update .` skipped: `graphify` CLI is not available in this environment (matches Session 29 note).
- **[Fixed post-handoff]** `health_snapshot` used `extract_event_device_id` (prefix-strip heuristic) to map `node_id → device_id` for event/inventory queries. For SNMP nodes the strip yields a raw IP string while events carry the canonical UUID as `device_id`, so event health lookups returned nothing. Fixed by fetching `canonical_key` directly from `topology_nodes` and using it for all lookups; SNMP events correctly fall through to props-based health when no match found.

---

## 8. Files changed

| File | Change |
|---|---|
| `schemas/postgres/008_identity.sql` | canonical identity schema |
| `backend/shared/database/identity.py` | resolver implementation |
| `backend/shared/database/topology.py` | identity-aware resolution + legacy fallback |
| `backend/scripts/backfill_identity.py` | one-time inventory → identity seed |
| `backend/worker/collectors/topology_sync.py` | canonical-keyed topology nodes |
| `backend/worker/collectors/mist_inventory.py` | identity seeding after inventory upsert |
| `backend/worker/collectors/mist.py` | canonical device IDs in events |
| `backend/worker/collectors/mist_topology.py` | shared resolver across all sub-collectors |
| `backend/worker/collectors/velocloud_inventory.py` | identity seeding after inventory upsert |
| `backend/worker/collectors/velocloud.py` | shared resolver across all sub-collectors |
| `backend/worker/collectors/dnac.py` | shared resolver for device/interface/alarm events |
| `backend/worker/collectors/arista_wlc.py` | shared resolver for AP/radio events |
| `backend/worker/collectors/snmp_poller.py` | canonical device key for local nodes/events |
| `backend/tests/test_identity_resolver.py` | new |
| `backend/tests/test_mist_topology.py` | async transition tests |
| `backend/tests/test_topology_provider.py` | canonical-key mock updates |
| `backend/tests/test_topology_sync.py` | `FakeIdentityResolver` |

## 9. Commands

```bash
python -m pytest backend/tests        # 429 passed / 0 failed
```

---

*Graphify update skipped: `graphify` CLI is not available in this environment.*
