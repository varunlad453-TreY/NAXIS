# NAXIS.ai — Azure hosting requirement

Written 2026-08-18. Supersedes the AWS hosting content in `ARCHITECTURE.md` §Deployment
and `TECHNICAL_QA.md` §8. The team has decided to host on **Azure**, with a
**managed PostgreSQL** (Azure Database for PostgreSQL Flexible Server).

Companion docs: `ARCHITECTURE.md` (target state), `DATA_POLICY.md` (what we store),
`ROADMAP.md` (phase order).

## What is being hosted

One VM running the existing `docker-compose` stack: `api` (uvicorn:8000), `worker`
(async daemon), `web` (Next.js:3000), `redis`. Postgres moves out of compose to the
managed service. No microservices, no AKS, no Container Apps — the deployable is
still one image with two entrypoints.

## Compute and data

| Need | Azure resource | SKU | Why this size |
|---|---|---|---|
| Compose host | Linux VM, Ubuntu 22.04 | **Standard_B2ms** — 2 vCPU / 8 GB | Measured container usage ~600 MB (web 302, worker 231, api 71). Headroom is for eight concurrent pollers plus the correlation cycle. B2s (4 GB) will OOM the Next.js build. |
| OS + Docker volumes | Premium SSD P10, 128 GB | | Images, build cache, and `json-file` logs capped at 50 MB × 3 per service |
| Database | **Azure Database for PostgreSQL Flexible Server** | **Burstable B2s** — 2 vCore / 4 GiB, 32 GiB storage, PG 16 | Not B1ms: see connection math. Steady-state data is ~1.9 GB today and bounded by retention. |
| Cache | `redis:7-alpine` **in compose** | | Redis carries real-time notifications only and is non-blocking. Do not provision Azure Cache for Redis. |
| Images | **ACR Basic** (optional) | | Building the frontend on 2 vCPU is slow; build in CI and pull |

### Database configuration

| Setting | Value | Why |
|---|---|---|
| Version | PostgreSQL 16 | Matches `postgres:16-alpine`. `gen_random_uuid()` is built in from PG13, and the schema needs no extensions — so no `azure.extensions` allowlist work. |
| Networking | **Private access (VNet integration)**, delegated subnet | No public endpoint at all. Not "public access + firewall rules". |
| Private DNS | `<name>.private.postgres.database.azure.com`, linked to the VNet | |
| TLS | `require_secure_transport = ON`, min TLS 1.2 | The pool sends `ssl='require'` when `POSTGRES_SSL=true` |
| HA | Disabled | Operations tool, not a revenue system; an RTO of hours is acceptable |
| Backup | 14 days, LRS, geo-redundant off | Longer than the 7-day default because `INCIDENT_RETENTION_DAYS=180` |
| Maintenance window | Custom, outside the correlation-heavy period | A failover restarts the pool; collectors mid-poll fail that cycle and retry |
| Server params | `log_min_duration_statement=1000` | The recursive-CTE topology traversal is the query to watch |

### Connection math — this picks the SKU

`api` runs `uvicorn --workers 2`, and each worker process builds its own pool
(`min_size=2, max_size=10`, `backend/shared/database/client.py`). Plus the `worker`
container's pool, plus the migration job:

```
api      2 procs × 10 = 20
worker   1 proc  × 10 = 10
migrate               =  1
                       ---
peak                     31
```

B1ms (2 GiB) caps `max_connections` at roughly 35 — 31 of 35 leaves nothing for a
`psql` session or a monitoring probe, and a pool that cannot grow surfaces as request
timeouts rather than a clear error. **B2s** is the first tier with real headroom.
Confirm the exact `max_connections` for the tier in the portal before committing.
Built-in PgBouncer is **not** available on the Burstable tier.

## Networking

| Need | Azure resource | Notes |
|---|---|---|
| VNet | 1 VNet, 3 subnets | `snet-app` (VM), `snet-pg` (delegated to `Microsoft.DBforPostgreSQL/flexibleServers`), `snet-pe` (private endpoints) |
| On-prem reach | **ExpressRoute circuit + gateway**, or Site-to-Site VPN (VpnGw1) | **Hard dependency, verify first.** DNAC, Arista WLC, ClearPass and the switches are on-prem and unreachable otherwise. The docs assume "multi-cloud connect already in place"; if that circuit terminates in AWS only, Azure needs its own. |
| Stable egress IP | **NAT Gateway** + 1 Standard public IP | Mist, VeloCloud/Silver Peak, Aruba Central, Cloudflare and Netskope all expect an allowlisted source IP. Without NAT Gateway the SNAT address is not stable. |
| DNS | **Azure DNS Private Resolver**, or VNet custom DNS pointing at corporate resolvers with a public forwarder | One resolver must answer for `api.mist.com`, the on-prem controller names, **and** the Flexible Server private FQDN |
| TLS front door | **Caddy or nginx container on the VM**, cert from the internal CA or Key Vault | Skip Application Gateway (~$125/mo) unless a WAF is mandated. Ports 8000 and 3000 stay on loopback behind the proxy. |
| Access control | NSG on `snet-app` | Inbound **443 from corporate CIDRs only**, 22 from the bastion. The VM gets **no public IP**. |
| SSH | Existing corporate jump host over ExpressRoute | Azure Bastion Basic is ~$140/mo and not worth it here |
| Device telemetry (optional) | Internal Standard Load Balancer, or the VM private IP directly | Only if `SYSLOG_ENABLED` / `SNMP_TRAP_ENABLED` become true — 514/UDP, 1514/TCP, 162/UDP. Application Gateway cannot carry UDP. |
| Time | `chrony` against Azure host time or corporate NTP | Correctness dependency: correlation buckets events into 300 s windows, so clock drift produces wrong incidents |

### Port matrix

**Inbound:** 443 from corporate CIDRs → reverse proxy; 22 from the bastion. Nothing else.
No public ingress.

**Outbound:** 443 to `api.mist.com`, the VeloCloud VCO, Silver Peak Orchestrator, Aruba
Central, Cloudflare, Netskope, Keycloak, and the LLM endpoint if Phase 5 is enabled;
443 to Key Vault and Monitor private endpoints; 5432 to the Flexible Server private IP;
443 to on-prem DNAC / Arista WLC / ClearPass over ExpressRoute; DNS 53; NTP 123; OS
mirrors and the container registry.

## Identity, secrets, observability

| Need | Azure resource |
|---|---|
| Eight vendors' credentials, replacing plaintext `config/.env` | **Key Vault** (Standard) + private endpoint, VM **system-assigned managed identity**, RBAC role `Key Vault Secrets User` |
| SSO | **Existing Keycloak** — no Azure resource. Needs egress to the Keycloak host for JWKS, `KEYCLOAK_ENABLED=true`, and a reachable `KEYCLOAK_SERVER_URL` |
| Logs and alerts | **Log Analytics workspace** + Azure Monitor Agent. Alert on worker heartbeat staleness (the one that matters — a dead worker means silently stale data), disk >80%, DB connections, API 5xx |
| Phase 5 LLM | Azure OpenAI, or an external API reached via NAT Gateway. Behind `llm_enabled` |

## Code and config deltas

The three original RDS blockers are now two-and-a-half:

1. **TLS on the pool — done.** `create_pool()` passes `ssl='require'` when
   `POSTGRES_SSL=true` or `ENVIRONMENT=production`. Note this encrypts but does not
   verify the server certificate; acceptable inside the VNet with a private endpoint.
   For verification, pass an `ssl.SSLContext` loading the DigiCert Global Root G2 bundle.
2. **Migration runner — done.** `scripts/migrate.py` is idempotent via a
   `schema_migrations` table, and both it and `schemas/` are now copied into the image,
   so `make migrate` works in-container. `docker-entrypoint-initdb.d` does not exist on
   a managed server, so this is the only path in.
3. **`dns: 8.8.8.8` — NOT done.** Still set on `worker` and `web` in
   `docker-compose.yml`, and on `worker`, `api` and `web` in `docker-compose.dev.yml`.
   Hardcoded public DNS cannot resolve the Flexible Server private FQDN or any on-prem
   controller name. This must be removed from the Azure profile.

Additional work, not previously tracked:

4. **`NEXT_PUBLIC_API_URL` is baked at build time** (`docker-compose.yml` build args).
   It is inlined into the browser bundle, so the hosted build must be rebuilt with the
   real internal URL — setting it only at runtime never reaches the browser. Nothing
   hosted works until this changes.
5. **Key Vault is not wired.** `backend/config/settings.py` is pydantic-settings over
   `config/.env` only. Needs either a boot-time render of `.env` from Key Vault via the
   managed identity, or a settings source that reads Key Vault directly.
6. **`DATABASE_URL` must be set explicitly.** `client.py` reads it from the environment
   and never consults `settings.postgres_url`; setting only `POSTGRES_HOST` leaves the
   pool pointed at localhost. (`settings.postgres_url` has no callers — it is a trap.)
7. **Remove the `postgres` service** from the compose profile used on Azure, and drop
   the `depends_on: postgres` conditions on `api` and `worker`, or compose refuses to
   start.
8. **No API rate limiting.** The reverse proxy is the cheapest place to add it.

### Compose override sketch

```yaml
# docker-compose.azure.yml
services:
  postgres: !reset null
  worker:
    dns: !reset null
    depends_on:
      redis:
        condition: service_healthy
  api:
    dns: !reset null
    depends_on:
      worker:
        condition: service_started
```

## Data migration

The database is ~1.9 GB, so a plain dump and restore over the private endpoint is
enough — no Azure Database Migration Service, no logical replication:

```
pg_dump -Fc -h 127.0.0.1 -U naxis naxis > naxis.dump
python scripts/migrate.py                      # build the schema on the managed server
pg_restore --data-only --disable-triggers -h <fqdn> -U naxis -d naxis naxis.dump
```

Build the schema with the runner rather than restoring `pg_dump`'s DDL, so
`schema_migrations` stays accurate. Otherwise the runner believes nothing has been
applied and replays `003_telemetry_expansion.sql`, which has no `IF NOT EXISTS` guards
and will error.

## Cost (pay-as-you-go, USD/month)

| Item | Cost |
|---|---|
| VM B2ms + 128 GB Premium SSD | 78 |
| Flexible Server B2s + 32 GiB + backup | 40 |
| NAT Gateway + public IP | 36 |
| Log Analytics (~5 GB ingest) | 12 |
| Key Vault + 3 private endpoints | 24 |
| ACR Basic | 5 |
| Private DNS zones | 1 |
| **Subtotal** | **~196** |
| ExpressRoute gateway, if new | +180 |
| VPN Gateway VpnGw1 (cheaper alternative) | +140 |

One-year reserved capacity cuts VM and database compute by roughly 35%. Excludes the
carrier's ExpressRoute circuit charge.

## Open questions

- Does the existing multi-cloud connect terminate in Azure, or is it AWS-only?
  Everything else depends on this.
- Region — pick the one nearest the corporate estate; the ExpressRoute peering location
  constrains the choice.
- Who issues the TLS certificate for the internal FQDN, and is a WAF mandated by policy?
- Azure OpenAI or an external LLM API for Phase 5?
