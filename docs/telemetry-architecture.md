# Naxis Telemetry Architecture

**Document owner:** Naxis Platform Team  
**Last updated:** 2026-07-01  
**Audience:** Engineers on the platform, infrastructure, and NOC teams

---

## Table of Contents

1. [What is Telemetry?](#1-what-is-telemetry)
2. [Why Multiple Collection Methods?](#2-why-multiple-collection-methods)
3. [What We Currently Collect](#3-what-we-currently-collect)
4. [Telemetry Methods: Deep Dive](#4-telemetry-methods-deep-dive)
   - [REST API Polling](#41-rest-api-polling)
   - [SNMP Polling](#42-snmp-polling)
   - [SNMP Traps](#43-snmp-traps)
   - [Syslog](#44-syslog)
   - [Streaming Telemetry (gNMI/gRPC)](#45-streaming-telemetry-gnmigrpc)
   - [NetFlow / IPFIX](#46-netflow--ipfix)
5. [Data Flow: End to End](#5-data-flow-end-to-end)
6. [Topology: Why It Matters and How We Build It](#6-topology-why-it-matters-and-how-we-build-it)
7. [Configuration Reference](#7-configuration-reference)
8. [How to Add a New Device / Vendor](#8-how-to-add-a-new-device--vendor)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What is Telemetry?

Telemetry is the continuous, automated collection of operational data from your network devices. It is the raw material for everything the Naxis platform does — displaying device health, raising alerts, correlating incidents, and building topology maps.

Without telemetry:
- You do not know if a device is reachable
- You do not know when a link failed or recovered
- You do not know which users are affected by an outage
- You cannot correlate a flood of individual alarms into one meaningful incident

There are six distinct methods for collecting telemetry from network devices. Each has different characteristics:

| Method |                   Direction                | Latency| Coverage            | Complexity |
|--------|                 -----------|---------      |--------|------------         |
| REST API polling           | Pull (we ask)          | 60s+   |  Vendor-specific    | Low        |
| SNMP polling               | Pull (we ask)          | 60s+   |  Universal          | Medium     |
| SNMP Traps                 | Push (device tells us) | <1s    |  Universal          | Medium     |
| Syslog                     | Push (device tells us) | <1s    |  Universal          | Low        |
| Streaming Telemetry (gNMI) | Push                   | 10s    |  Modern devices only| High       | 
| NetFlow / IPFIX            | Push                   | 30–60s |  Router/switch      | High       |

---

## 2. Why Multiple Collection Methods?

**No single method covers everything.** This is the core insight.

**REST APIs** are precise and structured but vendor-locked. Juniper Mist has a REST API that gives you AP health. VeloCloud has a REST API that gives you WAN link quality. But a commodity Cisco switch in your data centre has no REST API — it only speaks SNMP and syslog.

**SNMP polling** works universally on any network device regardless of brand. It gives you interface counters, CPU/memory, and — critically — **the neighbour tables (LLDP/CDP) that reveal the physical topology**. No vendor API exposes "which port of which switch is my AP plugged into." SNMP LLDP/CDP does.

**SNMP Traps and Syslog** are push-based. The device sends us a message the instant something happens. REST polling runs on a 60-second cycle — a brief link flap that resolves in 10 seconds is invisible to polling but generates a trap and a syslog message in real time. Push-based sources give us sub-second fault detection.

**The combination** is what makes the platform operational-grade:

```
REST polling  → current state ("what is true right now")
SNMP polling  → counters + physical topology (ground truth that APIs don't surface)
Traps/Syslog  → state change events ("what happened and exactly when")
```

---

## 3. What We Currently Collect

### Active Collectors (run every 60 seconds)

#### Juniper Mist — REST API

| Collector | File | What it fetches | Why |
|-----------|------|-----------------|-----|
| `MistCollector` | `collectors/mist.py` | `/orgs/{id}/alarms/search` — fault alarms with pagination | Real-time wireless health events: AP offline, client auth failures, rogue APs, radio interference |
| `MistCollector` | `collectors/mist.py` | `/orgs/{id}/logs` — admin audit log | Config change tracking: who changed what and when |
| `MistInventoryCollector` | `collectors/mist_inventory.py` | `/orgs/{id}/inventory` — full AP list (model, serial, connected status) | Populates the device inventory: 1,944 APs across all sites |
| `MistInventoryCollector` | `collectors/mist_inventory.py` | `/orgs/{id}/sites` — site name lookup | Maps site IDs to human-readable names |
| `MistInventoryCollector` | `collectors/mist_inventory.py` | `/sites/{id}/stats/devices` — live AP stats per site | Client counts, uptime, IP address, firmware version |

#### VMware VeloCloud SD-WAN — REST API

| Collector | File | What it fetches | Why |
|-----------|------|-----------------|-----|
| `VelocloudInventoryCollector` | `collectors/velocloud_inventory.py` | `/enterprise/getEnterpriseEdges` with site + recentLinks | All SD-WAN edge devices: model, location, WAN IPs, connection state |
| `VelocloudMetricsCollector` | `collectors/velocloud_metrics.py` | `/monitoring/getAggregateEdgeLinkMetrics` | Per-link quality: latency, jitter, packet loss, VeloBrain score (0–5) |
| `VelocloudMetricsCollector` | `collectors/velocloud_metrics.py` | `/edge/getEdgeConfigurationStack` | Provisioned WAN capacity: upload/download Mbps per link, ISP name |
| `VelocloudEventsCollector` | `collectors/velocloud_events.py` | `/event/getEnterpriseEvents` | Edge state changes: CONNECTED/OFFLINE/DEGRADED, HA failovers, BGP transitions, config changes |

### Push Receivers (always-on, started at worker boot)

#### SNMP Trap Receiver
- **File:** `receivers/snmp_trap_receiver.py`
- **Port:** UDP 162 (configurable via `SNMP_TRAP_PORT`)
- **Enabled by:** `SNMP_TRAP_ENABLED=true`
- What it receives: linkDown, linkUp, coldStart, warmStart, authFailure, and any vendor enterprise trap

#### Syslog Receiver
- **File:** `receivers/syslog_receiver.py`
- **Ports:** UDP 514, TCP 1514 (configurable)
- **Enabled by:** `SYSLOG_ENABLED=true`
- What it receives: Any RFC 3164 / RFC 5424 syslog message from any device on the network

### Topology Sync (runs every 60 seconds after inventory)

| Sync | File | What it builds |
|------|------|----------------|
| `TopologySync._sync_mist_topology` | `collectors/topology_sync.py` | Site nodes + AP nodes + AP→Site membership edges |
| `TopologySync._sync_velocloud_topology` | `collectors/topology_sync.py` | Site nodes + Edge nodes + WAN link edges with quality metrics |
| `SnmpPoller` (inline) | `collectors/snmp_poller.py` | Switch/router nodes + physical LLDP/CDP link edges |

### SNMP Poller (runs every 60 seconds)
- **File:** `collectors/snmp_poller.py`
- **Enabled by:** `SNMP_ENABLED=true` + at least one `SNMP_TARGETS`
- What it collects: Interface states (up/down), interface names/speeds, LLDP neighbours, CDP neighbours

---

## 4. Telemetry Methods: Deep Dive

### 4.1 REST API Polling

**How it works:**  
The worker makes HTTP requests to each vendor's management platform API every 60 seconds. Responses are JSON. We normalize the vendor-specific fields into our `UnifiedEvent` model.

**Authentication:**
- Mist: `Authorization: Token <MIST_API_KEY>`
- VeloCloud: `Authorization: Token <VELOCLOUD_API_KEY>` (JWT)

**What it is good for:**
- Rich structured data: Mist gives AP client counts, RSSI, firmware, exact alarm text
- VeloCloud gives WAN link scores, latency/jitter/loss per direction (Tx/Rx), ISP names
- Historical data: you can query past events with a time range

**What it cannot do:**
- It is pull-only: you only know about events at the moment you poll. A 5-second link flap between two poll cycles is missed entirely.
- It is vendor-locked: you need a separate API client per vendor. A Cisco switch, a Fortinet firewall, a Palo Alto NGFW — each would need its own collector.
- Mist APs do not expose SNMP or direct management. The cloud API is the only way.

**Code pattern:**
```
VendorCollector.collect(since=last_poll_time)
  → HTTP GET/POST to vendor API
  → Paginate through results
  → Normalize each raw event to UnifiedEvent
  → Return list[UnifiedEvent]
```

**Files:**
- `backend/worker/collectors/mist.py`
- `backend/worker/collectors/mist_inventory.py`
- `backend/worker/collectors/velocloud_inventory.py`
- `backend/worker/collectors/velocloud_metrics.py`
- `backend/worker/collectors/velocloud_events.py`

---

### 4.2 SNMP Polling

**What SNMP is:**  
Simple Network Management Protocol (SNMP) is a 30-year-old standard that every network device speaks. It organizes device information in a tree called the Management Information Base (MIB). You request values by their Object Identifier (OID).

**Why we added it:**

The single most important reason: **SNMP is the only way to discover physical topology without vendor APIs.**

LLDP (Link Layer Discovery Protocol) and CDP (Cisco Discovery Protocol) are protocols where network devices announce themselves to their neighbours. Every managed switch and router builds a table of: "on my port GigabitEthernet0/1, I see device X with IP Y." This table is exposed via SNMP MIBs.

This is ground truth. No Mist API, no VeloCloud API tells you that an AP is plugged into port 5 of switch 10.20.1.15. SNMP LLDP does.

**What we collect via SNMP:**

| MIB / OID | What it gives us | Used for |
|-----------|-----------------|----------|
| `ifTable` (RFC 2863) | Interface names, admin/oper status | Interface up/down events |
| `ifXTable` (RFC 2863) | 64-bit byte counters, high-speed interface names | Bandwidth utilisation |
| `LLDP-MIB` (IEEE 802.1AB) | Neighbour chassis ID, port ID, system name | Physical topology (vendor-neutral) |
| `CISCO-CDP-MIB` | Neighbour device ID, port, IP address | Physical topology on Cisco devices |
| `sysDescr`, `sysName` | Device description and hostname | Node labelling in topology |

**How to enable:**

Add target device IPs to your `.env`:
```
SNMP_ENABLED=true
SNMP_COMMUNITY=your_community_string
SNMP_TARGETS=10.20.1.1,10.20.1.2,10.20.1.3
```

**File:** `backend/worker/collectors/snmp_poller.py`

**Library:** `pysnmp>=6.1.0` (pure Python asyncio, no native binary dependencies)

**State tracking:**  
The SNMP poller remembers the previous interface state for each device in memory. It only emits an event when a state *changes* — not every poll. This means on the first poll you get a baseline but no events. On subsequent polls, an interface going from `up` to `down` generates a `INTERFACE_DOWN` MAJOR event immediately.

---

### 4.3 SNMP Traps

**What traps are:**  
Instead of us asking the device for its state, the device pushes a UDP datagram to us the moment something happens. This is "traps" — the device *traps* us with a notification.

**Why this matters for fault detection:**  
The REST API poll cycle is 60 seconds. An interface that goes down at T=0 and comes back up at T=45 will never be seen by polling — it looks up at T=60. But the device sent a `linkDown` trap at T=0 and a `linkUp` trap at T=45. We capture both.

This gives us:
1. **Accurate fault start time** — we know exactly when the failure began, not just the next poll window
2. **Brief flaps that matter** — a link that flaps 20 times in 5 minutes is serious even if it's up at the next poll
3. **Zero polling overhead** — the device tells us, we don't have to keep asking

**Supported trap types:**

| OID | Name | Severity | Meaning |
|-----|------|----------|---------|
| `1.3.6.1.6.3.1.1.5.1` | coldStart | INFO | Device rebooted (cold) |
| `1.3.6.1.6.3.1.1.5.2` | warmStart | WARNING | Device restarted (warm) — possibly unstable |
| `1.3.6.1.6.3.1.1.5.3` | linkDown | MAJOR | An interface went down |
| `1.3.6.1.6.3.1.1.5.4` | linkUp | INFO | An interface recovered |
| `1.3.6.1.6.3.1.1.5.5` | authenticationFailure | WARNING | SNMP authentication failed (brute force?) |
| Any enterprise OID | Vendor-specific | INFO | Stored raw for future parsing |

**How to configure on a Cisco/Juniper device:**
```
# Cisco IOS
snmp-server host <NAXIS_WORKER_IP> version 2c <community_string>
snmp-server enable traps snmp linkdown linkup coldstart

# Juniper Junos
set snmp trap-group naxis targets <NAXIS_WORKER_IP>
set snmp trap-group naxis categories link
```

**How to enable in Naxis:**
```
SNMP_TRAP_ENABLED=true
SNMP_TRAP_PORT=162
```

> **Note on port 162:** UDP 162 is a privileged port (below 1024). The worker container needs either root access or `CAP_NET_BIND_SERVICE`. Alternatively set `SNMP_TRAP_PORT=1162` and add an iptables rule on the host: `iptables -t nat -A PREROUTING -p udp --dport 162 -j REDIRECT --to-port 1162`

**File:** `backend/worker/receivers/snmp_trap_receiver.py`

---

### 4.4 Syslog

**What syslog is:**  
Syslog is the original Unix logging protocol, adopted by virtually every network device ever made. A device sends a UDP (or TCP) datagram to a configured syslog server every time something noteworthy happens. Messages are plain text structured as:

```
<priority>timestamp hostname process: message text
```

The `priority` encodes both the **facility** (which subsystem generated the message: kernel, authentication, local application) and the **severity** (emergency through debug).

**Why syslog is so valuable:**

- **Universal:** Every managed switch, router, firewall, VPN gateway, load balancer, and controller speaks syslog. One receiver catches everything.
- **Sub-second latency:** The device logs the message and sends it immediately. No polling cycle.
- **Richer than trap-defined fault types:** Syslog carries free-text operational messages that traps cannot express: "OSPF neighbor X.X.X.X dead, state changed to Down", "STP topology change received on port Gi0/5", "BGP session to X.X.X.X reset due to hold-time expiry"
- **Config audit trail:** Every config commit on a Juniper or Cisco device generates a syslog message with the username, timestamp, and change summary
- **Security events:** ACL denies, authentication failures, SSH login attempts all appear in syslog

**VeloCloud syslog:**  
VeloCloud edges write operational events to syslog including WAN link state changes, BGP transitions, HA failovers, and policy changes. Many of these are more detailed in syslog than in the REST API event feed.

**Message classification:**  
The syslog receiver applies keyword-based regex patterns to classify incoming messages into our `EventType` taxonomy:

| Pattern (example) | EventType | Category |
|-------------------|-----------|----------|
| `link down`, `line protocol down` | INTERFACE_DOWN | CONNECTIVITY |
| `BGP.*state.*idle` | BGP_DOWN | CONNECTIVITY |
| `OSPF.*neighbor dead` | OSPF_NEIGHBOR_DOWN | CONNECTIVITY |
| `authentication fail`, `login fail` | AUTH_FAILURE | SECURITY |
| `cpu.*high`, `CPU utilization.*9x%` | HIGH_CPU | PERFORMANCE |
| `memory low`, `memory exhausted` | HIGH_MEMORY | PERFORMANCE |
| `configuration changed`, `config commit` | CONFIG_CHANGE | CONFIGURATION |
| `reboot`, `system restart` | DEVICE_REBOOT | SYSTEM |
| `fan fail`, `fan fault` | FAN_FAILURE | HARDWARE |
| `temperature high`, `thermal alert` | TEMPERATURE_HIGH | HARDWARE |

Unmatched messages are stored as `EventType.OTHER / EventCategory.SYSTEM` — no message is dropped.

**How to configure a device to send syslog:**
```
# Cisco IOS
logging host <NAXIS_WORKER_IP>
logging trap informational

# Juniper Junos
set system syslog host <NAXIS_WORKER_IP> any info

# VeloCloud Edge (via VCO portal)
Configuration → Edge → System Settings → Syslog → Add Server → <NAXIS_WORKER_IP>:514
```

**How to enable in Naxis:**
```
SYSLOG_ENABLED=true
SYSLOG_UDP_PORT=514
SYSLOG_TCP_PORT=1514
```

> **Note on port 514:** Like SNMP port 162, UDP 514 is privileged. Either run the container as root, use `CAP_NET_BIND_SERVICE`, or redirect with iptables from 514 → 5514 and set `SYSLOG_UDP_PORT=5514`.

**File:** `backend/worker/receivers/syslog_receiver.py`

---

### 4.5 Streaming Telemetry (gNMI/gRPC)

**What it is:**  
gNMI (gRPC Network Management Interface) is the modern replacement for SNMP polling. Instead of us asking the device for data every 60 seconds, the device streams it to us continuously at a configured interval (e.g., every 10 seconds). gRPC is the transport, protobuf is the encoding.

**Why we have not implemented it yet:**

- **Juniper Mist APs do not support gNMI.** They are cloud-managed devices. Juniper EX/QFX switches do, but we do not have those in inventory yet.
- **VeloCloud does not support gNMI.** It uses a proprietary REST API exclusively.
- **When it becomes relevant:** The moment we add traditional campus switches (Juniper EX, Arista EOS, Cisco IOS-XR, Nokia SR-OS), gNMI becomes the highest-quality telemetry source available — streaming counters every 10 seconds with full YANG path data.

**When to add it:** Once a switch/router vendor is onboarded that supports gNMI. The implementation would be a new `GnmiCollector` that subscribes to the device using the `grpcio` library and the `gnmi-proto` definitions.

---

### 4.6 NetFlow / IPFIX

**What it is:**  
NetFlow and IPFIX are protocols where routers and switches export flow records: "between T1 and T2, host A sent N bytes to host B on port P." It is traffic accounting at the IP flow level.

**Why it is not implemented yet:**  
NetFlow is a separate data pipeline with different storage requirements (you need a flow collector and aggregation layer — the event table is not designed for billions of flow records). It is valuable but a significant scope on its own.

**What it would add:**
- Topology inference: "which hosts talk to which switches" without LLDP
- Anomaly detection: unusual traffic patterns, DDoS, lateral movement
- Bandwidth utilisation per application and per site

**When to add it:** After topology is solid and the team wants to add network traffic analytics. VeloCloud edges support NetFlow export natively.

---

## 5. Data Flow: End to End

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NETWORK DEVICES                             │
│                                                                     │
│  ┌──────────┐   ┌─────────────────┐   ┌───────────┐   ┌─────────┐ │
│  │Juniper   │   │VeloCloud SD-WAN │   │Switches / │   │Any      │ │
│  │Mist APs  │   │Edges            │   │Routers    │   │device   │ │
│  └────┬─────┘   └────────┬────────┘   └─────┬─────┘   └────┬────┘ │
└───────┼──────────────────┼─────────────────┼───────────────┼──────┘
        │                  │                 │               │
        │ HTTPS REST API   │ HTTPS REST API  │ SNMP v2c      │ UDP Syslog
        │ (pull, 60s)      │ (pull, 60s)     │ (pull, 60s)   │ (push, <1s)
        │                  │                 │               │
        │                  │                 │ SNMP Traps    │
        │                  │                 │ (push, <1s)   │
        ▼                  ▼                 ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NAXIS WORKER (naxis-worker)                      │
│                                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────────┐ │
│  │ REST Collectors│  │  SNMP Poller   │  │   Push Receivers      │ │
│  │                │  │                │  │                       │ │
│  │ mist.py        │  │ snmp_poller.py │  │ snmp_trap_receiver.py │ │
│  │ mist_inv...py  │  │ (interfaces +  │  │ (UDP 162)             │ │
│  │ velocloud_*.py │  │  LLDP/CDP)     │  │                       │ │
│  └───────┬────────┘  └───────┬────────┘  │ syslog_receiver.py   │ │
│          │                   │           │ (UDP 514 / TCP 1514)  │ │
│          │                   │           └──────────┬────────────┘ │
│          └──────────┬─────────┘                     │              │
│                     │  list[UnifiedEvent]            │              │
│                     ▼                                ▼              │
│            ┌────────────────────────────────────────────┐          │
│            │         insert_events() / upsert           │          │
│            └──────────────────┬─────────────────────────┘          │
│                               │                                     │
│            ┌──────────────────▼─────────────────────────┐          │
│            │           TopologySync                      │          │
│            │  (topology_sync.py — every 60s)             │          │
│            └──────────────────┬─────────────────────────┘          │
└───────────────────────────────┼─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PostgreSQL (naxis-postgres)                   │
│                                                                     │
│  events              → all normalized telemetry events              │
│  inventory           → current device state (AP + edge inventory)   │
│  incidents           → correlated multi-event incidents             │
│  topology_nodes      → devices, sites, WAN gateways                 │
│  topology_edges      → WAN links, physical links, site membership   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NAXIS API (naxis-api)                            │
│                    FastAPI on port 8000                             │
│                                                                     │
│  GET /devices        → inventory (Mist APs + VeloCloud edges)       │
│  GET /events         → normalized events from all sources           │
│  GET /incidents      → correlated incidents                         │
│  (future) GET /topology → topology graph                            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NAXIS FRONTEND (port 3000 / 3001)                │
│                    Next.js                                          │
│                                                                     │
│  /          → Platform overview + animated inventory summary        │
│  /devices   → All devices (Mist + VeloCloud, filterable)            │
│  /mist      → Juniper Mist AP inventory + wireless health           │
│  /sdwan     → VeloCloud SD-WAN edges + WAN link quality             │
│  /events    → Event feed from all sources                           │
│  /correlation → AI-correlated incidents                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Topology: Why It Matters and How We Build It

### What topology is

Topology is the map of how devices connect. It has two parts:
- **Nodes:** devices, sites, WAN gateways
- **Edges:** links between nodes (physical cable, WAN circuit, logical tunnel, site membership)

### Why it matters

Without topology, alerts are just a list of unrelated device names. With topology:

1. **Blast radius analysis** — If edge `SFO-EDGE-01` goes offline, which APs lose connectivity? Which sites lose their WAN link? You can traverse the graph: edge → site → all APs in that site.

2. **Root cause analysis** — If 40 APs go offline simultaneously, is it 40 individual AP failures (unlikely) or is it their upstream switch that failed? Topology tells you if they all share a common parent node.

3. **Impact scope** — The incident engine can automatically populate "affected sites" and "affected devices" by walking the topology graph from the failed device.

### How we build topology (per source)

#### Juniper Mist

Source: `inventory` table, `platform = 'mist'`

```
topology_nodes:
  mist-site-{site_id}        node_type=site
  mist-ap-{device_id}        node_type=ap

topology_edges:
  mist-ap-{id} → mist-site-{site_id}    edge_type=site_membership
```

Mist does not expose the wired uplink topology (which switch port an AP is plugged into) via the standard API. That requires either Mist Premium Analytics or SNMP LLDP polling of the upstream switches.

#### VeloCloud SD-WAN

Source: `inventory` table, `platform = 'velocloud'`

```
topology_nodes:
  velo-site-{site_id}        node_type=site
  velo-edge-{logical_id}     node_type=edge
  wan-gw-{isp_name}          node_type=wan_gateway  (one per ISP)

topology_edges:
  velo-edge-{id} → velo-site-{id}      edge_type=site_membership
  velo-edge-{id} → wan-gw-{isp}        edge_type=wan_link
    props: latency, jitter, loss, score, upstream_mbps, downstream_mbps
```

The WAN link edges carry live quality metrics from VeloBrain — these are updated every 60 seconds and will power the topology visualisation with real-time link health overlays.

#### SNMP (switches and routers)

Written by `SnmpPoller` during its collection cycle (not via TopologySync):

```
topology_nodes:
  snmp-{ip_with_dashes}      node_type=switch
    props: sys_descr, interfaces dict

topology_edges:
  snmp-{local_ip} → snmp-{remote_chassis}   edge_type=physical_link
    props: protocol=lldp/cdp, local_port, remote_port, discovered_by
```

LLDP/CDP edges are the ground truth for physical wiring. Once you add switch IPs to `SNMP_TARGETS`, you will see the physical links that connect APs to switches and switches to each other.

### Database schema

```sql
topology_nodes (
    node_id       TEXT PRIMARY KEY,   -- e.g. "mist-ap-{uuid}", "velo-edge-{logicalId}"
    node_type     TEXT,               -- ap | edge | switch | site | wan_gateway
    name          TEXT,               -- human-readable display label
    ip_address    TEXT,
    vendor        TEXT,               -- mist | velocloud | snmp | internet
    model         TEXT,
    site_id       TEXT,
    props         JSONB,              -- vendor-specific extras
    updated_at    TIMESTAMPTZ
)

topology_edges (
    edge_id       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    src_id        TEXT REFERENCES topology_nodes(node_id),
    dst_id        TEXT REFERENCES topology_nodes(node_id),
    edge_type     TEXT,               -- site_membership | wan_link | physical_link
    state         TEXT DEFAULT 'unknown',
    discovered_by TEXT,               -- rest_api | snmp_lldp | snmp_cdp
    props         JSONB,              -- link metrics, interface names, ISP, etc.
    updated_at    TIMESTAMPTZ
)
```

The `UNIQUE INDEX` on `(LEAST(src_id,dst_id), GREATEST(src_id,dst_id), edge_type)` ensures that A→B and B→A are stored as one edge, not two.

---

## 7. Configuration Reference

All settings are in `.env` (root directory, loaded by Docker Compose) and `config/.env` (loaded for local development).

```bash
# ── Juniper Mist ──────────────────────────────────────────────────────
MIST_API_KEY=<token>               # From Mist → My Profile → API Token
MIST_ORG_ID=<uuid>                 # From Mist → Organization → Settings
MIST_BASE_URL=https://api.mist.com
MIST_ENABLED=true

# ── VeloCloud SD-WAN ──────────────────────────────────────────────────
VELOCLOUD_URL=https://<vco-hostname>
VELOCLOUD_API_KEY=<jwt_token>      # From VCO → My Profile → API Tokens
VELOCLOUD_ENABLED=true

# ── SNMP Polling ─────────────────────────────────────────────────────
SNMP_ENABLED=false                 # Set true when you have switch targets
SNMP_COMMUNITY=public              # v2c community string — change from default!
SNMP_PORT=161
SNMP_TIMEOUT=5.0
SNMP_RETRIES=2
SNMP_TARGETS=10.20.1.1,10.20.1.2  # Comma-separated IPs of switches to poll

# ── SNMP Trap Receiver ────────────────────────────────────────────────
SNMP_TRAP_ENABLED=false            # Set true when devices are configured to trap
SNMP_TRAP_HOST=0.0.0.0
SNMP_TRAP_PORT=162                 # Requires root / CAP_NET_BIND_SERVICE

# ── Syslog Receiver ───────────────────────────────────────────────────
SYSLOG_ENABLED=false               # Set true when devices are configured to syslog
SYSLOG_HOST=0.0.0.0
SYSLOG_UDP_PORT=514                # Requires root / CAP_NET_BIND_SERVICE
SYSLOG_TCP_PORT=1514               # Non-privileged, safe default

# ── Worker timing ────────────────────────────────────────────────────
COLLECTOR_INTERVAL=60              # Seconds between each full poll cycle

# ── CORS ─────────────────────────────────────────────────────────────
API_CORS_ORIGINS=*                 # Allows frontend on any port
```

---

## 8. How to Add a New Device / Vendor

### To add a new vendor with a REST API

1. Create `backend/worker/collectors/<vendor>_inventory.py` — fetches device list and upserts to `inventory`
2. Create `backend/worker/collectors/<vendor>_events.py` — fetches events/alarms and normalizes to `UnifiedEvent`
3. Add `EventSource.<VENDOR>` to `backend/shared/models/event.py`
4. Add `<VENDOR>_ENABLED`, `<VENDOR>_API_KEY`, `<VENDOR>_URL` to `backend/config/settings.py` and both `.env` files
5. Import and call the new collectors in `backend/worker/main.py`
6. Add topology sync in `backend/worker/collectors/topology_sync.py`

### To add a new SNMP target device

Just add its IP to `SNMP_TARGETS` in `.env`. No code change needed.

### To add syslog from a new device

Configure the device to send syslog to the Naxis worker IP. No code change needed. If the device uses unusual message formats that do not match existing regex patterns, add new patterns to the `_KEYWORD_MAP` list in `syslog_receiver.py`.

---

## 9. Troubleshooting

### "Mist page shows no data"

1. Check if the API and worker containers are running: `docker ps | grep naxis`
2. If `naxis-api` or `naxis-worker` is in `Created` state: `docker start naxis-api naxis-worker`
3. Check worker logs: `docker logs naxis-worker --tail=50`
4. Verify the API responds: `curl http://localhost:8000/devices?platform=mist&limit=1`
5. Check CORS: browser console will show a CORS error if `API_CORS_ORIGINS` does not include your frontend port

### "Worker started but no events appear"

1. `docker logs naxis-worker` — look for `Mist collector: 0 events collected`
2. If 0 events: `MIST_ENABLED=true`? Is `MIST_API_KEY` set correctly?
3. Test the API key directly: `curl -H "Authorization: Token <key>" https://api.mist.com/api/v1/self`

### "SNMP polling not working"

1. Verify `SNMP_ENABLED=true` and `SNMP_TARGETS` is not empty in `.env`
2. The worker needs to be rebuilt after `.env` changes: `docker compose up -d --build worker`
3. Test SNMP manually: `snmpwalk -v2c -c <community> <target_ip> 1.3.6.1.2.1.1.5` (sysName)
4. Check firewall: SNMP uses UDP 161 — is it open between the worker container and the target?

### "Syslog receiver bound but no messages arrive"

1. Verify devices are configured to send syslog to the Naxis worker IP
2. Check the worker container's exposed port: `docker port naxis-worker`
3. Test locally: `logger -n <worker_ip> -P 514 "test message from $(hostname)"`
4. If port 514 fails with permission denied: use `SYSLOG_UDP_PORT=5514` and add iptables: `iptables -t nat -A PREROUTING -p udp --dport 514 -j REDIRECT --to-port 5514`

### "Topology tables are empty"

1. Check if inventory has data: `curl http://localhost:8000/devices?limit=1`
2. If inventory is populated, topology sync runs after each poll cycle. Wait 60 seconds.
3. Query directly: `psql -h localhost -U naxis -d naxis -c "SELECT COUNT(*) FROM topology_nodes;"`
4. Check worker logs for `Topology sync complete`

---

*This document should be kept current as new collectors and vendors are added. When in doubt, the code is the source of truth — the collector files have inline docstrings that explain the rationale for each design decision.*
