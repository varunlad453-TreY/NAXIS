# Mist Card — Design (Features 5, 8, 9, 12)

Scope: capabilities that live *inside* the Naxis Mist card and don't just mirror the Mist portal. Design only — no code in this pass.

Constraint recap:
- Base Wi-Fi Assurance license only (no Marvis, no Advanced Analytics)
- Postgres is the only store
- **No storage of raw client events** (Feature 8 is a live pass-through)
- CSV export only (no PDF, no email)

---

## Feature 5 — AP Lifecycle Ledger

**Goal:** for any AP (by serial), show its full career: first-seen, every firmware change, every reboot, every site move, every rename, every replacement. Naxis remembers what Mist forgets.

### Data model

New table:

```sql
CREATE TABLE mist_ap_history (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mist_ap_id    UUID NOT NULL,          -- Mist AP object id
  serial        TEXT NOT NULL,          -- stable across renames/replacements
  mac           TEXT NOT NULL,
  hostname      TEXT,
  model         TEXT,
  site_id       UUID,
  site_name     TEXT,
  firmware      TEXT,
  reachability  TEXT,                   -- reachable | unreachable | degraded
  uptime_s      BIGINT,
  raw           JSONB NOT NULL          -- full snapshot for future fields
);

CREATE INDEX mist_ap_history_serial_time    ON mist_ap_history (serial, observed_at DESC);
CREATE INDEX mist_ap_history_mist_id_time   ON mist_ap_history (mist_ap_id, observed_at DESC);
CREATE INDEX mist_ap_history_site_time      ON mist_ap_history (site_id, observed_at DESC);
```

Append-only. One row per AP per collection cycle **only when something meaningful changed** (see "diff rules" below). This keeps growth bounded — an AP that never changes writes one row and then goes silent.

### Diff rules (what counts as "meaningful")

Write a new history row when the current poll differs from the latest history row for that serial in any of:
- `firmware`
- `site_id` (moved)
- `hostname` (renamed)
- `model` (replaced hardware, same serial slot)
- `reachability` transition (reachable ↔ unreachable)
- `uptime_s` **decreased** vs previous (reboot detection)

Everything else (client counts, radio state, RSSI) does not trigger a row — those live in the live inventory table.

### Retention

Unbounded by default. This table grows slowly (state changes are rare). Optional monthly job later to compact runs of `reachability` flapping.

### Collector change

Existing Mist inventory collector adds one post-normalize step: compare each AP to `latest_history_row` for that serial, write a new row if any diff rule fires.

### API

```
GET  /api/v1/mist/aps/{serial}/history
     → [{observed_at, event: "firmware_change" | "site_move" | "rename" | "reboot" | "reachability" | "first_seen", from, to, snapshot}]

GET  /api/v1/mist/aps/{serial}/history.csv
     → CSV of the same
```

`event` is derived on read by diffing consecutive rows — the table itself just stores snapshots. Keeps write logic simple.

### UI (Mist card → AP detail → "Lifecycle" tab)

Vertical timeline. Each event a row:
```
2026-06-14  Firmware upgrade   0.14.29586  →  0.14.30112
2026-05-02  Reboot             uptime reset to 0
2026-03-11  Site moved         Retail-SF-3  →  Retail-SF-4
2026-01-20  First seen         site: Retail-SF-3, fw: 0.14.28001
```

Filters: event type, date range. "Export CSV" button at top.

---

## Feature 8 — Client 1:1 Timeline (live pass-through)

**Constraint:** no local storage of client events. Everything queried on demand from Mist.

### Approach

Given a MAC address, fan out to Mist APIs and stitch results in the API layer. Naxis stores nothing; the card is a **unified viewer** for data that already exists in Mist but is scattered across endpoints.

### Mist endpoints used

- `GET /api/v1/sites/:site_id/clients/search?mac=...` — current session
- `GET /api/v1/sites/:site_id/insights/client/:mac/events` — events (associate/disassociate/roam/auth)
- `GET /api/v1/sites/:site_id/insights/client/:mac/sessions` — historical sessions
- `GET /api/v1/orgs/:org_id/clients/search?mac=...` — org-wide, to find which sites saw the MAC

### API

```
GET /api/v1/mist/clients/{mac}/timeline?since=<iso>&until=<iso>
     → {
         mac,
         current: { site, ap, ssid, band, connected_since, rssi } | null,
         sessions: [{ site, ap, ssid, band, started, ended, disconnect_reason }],
         events:   [{ ts, site, ap, type, detail }],
         sites_seen: [{ site_id, site_name, first_seen, last_seen }]
       }

GET /api/v1/mist/clients/{mac}/timeline.csv
```

Backend does: (1) org-wide MAC lookup to enumerate sites, (2) parallel per-site fetches, (3) merge and sort chronologically. All requests within the Mist token's rate limit — implement a simple in-request semaphore.

### Caching

Short-lived in-memory cache (60 s) keyed by `(mac, since, until)` to avoid re-querying Mist when the user clicks between tabs. No Postgres write.

### UI (new panel in Mist card: "Client lookup")

- MAC input at top (also accepts hostname, resolves via a `/clients/search` call)
- Left column: sites the MAC has ever appeared in (from `sites_seen`)
- Main: interleaved timeline — sessions as bars, events as points
- Row click → drill into the session (AP, SSID, band, disconnect reason)
- "Export CSV" — flat table of the merged events + sessions

### Failure modes

- MAC never seen → empty state ("No history for this client in the last 7 days.")
- Rate-limit hit → show partial results + "Some sites skipped due to rate limit. Retry in N seconds."
- License downgrade removes historical insights → gracefully degrade to `current` only.

---

## Feature 9 — SLE Anomaly Ranking

**Goal:** don't show raw SLE %; show *deviation from each site's own baseline*. A site at 92% might be fine (baseline 90%) or terrible (baseline 99%).

### Data model

```sql
CREATE TABLE mist_sle_history (
  id           BIGSERIAL PRIMARY KEY,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  site_id      UUID NOT NULL,
  site_name    TEXT NOT NULL,
  sle          TEXT NOT NULL,          -- ttc | throughput | coverage | capacity | roaming | successful_connect
  value        DOUBLE PRECISION NOT NULL,  -- 0..1 (percent as fraction)
  numerator    BIGINT,                 -- optional (successful events)
  denominator  BIGINT,                 -- optional (total events)
  raw          JSONB NOT NULL
);

CREATE INDEX mist_sle_history_site_sle_time
  ON mist_sle_history (site_id, sle, observed_at DESC);
```

### Collector

New periodic job (every 15 min): for each site, call `/api/v1/sites/:site_id/sle` for each SLE key, insert one row per (site, sle, cycle).

### Baseline math

Baseline = **rolling 30-day mean and stddev** per (site_id, sle), computed on read. No baseline table — direct query:

```sql
WITH recent AS (
  SELECT site_id, sle, value
  FROM mist_sle_history
  WHERE observed_at >= NOW() - INTERVAL '30 days'
    AND observed_at <  NOW() - INTERVAL '1 hour'  -- exclude current window
),
baseline AS (
  SELECT site_id, sle,
         AVG(value) AS mean,
         STDDEV_SAMP(value) AS sd
  FROM recent
  GROUP BY site_id, sle
),
current AS (
  SELECT DISTINCT ON (site_id, sle) site_id, sle, value, observed_at
  FROM mist_sle_history
  WHERE observed_at >= NOW() - INTERVAL '1 hour'
  ORDER BY site_id, sle, observed_at DESC
)
SELECT c.site_id, c.sle, c.value AS current,
       b.mean, b.sd,
       (c.value - b.mean) / NULLIF(b.sd, 0) AS z_score
FROM current c JOIN baseline b USING (site_id, sle)
ORDER BY z_score ASC;
```

Negative z-score = worse than baseline. Ranking by ascending z-score surfaces "sites that dropped hardest relative to their own norm" — regardless of absolute value.

### API

```
GET  /api/v1/mist/sle/anomalies?window=1h&limit=20
     → [{ site_id, site_name, sle, current, baseline_mean, baseline_sd, z_score, delta_pct }]

GET  /api/v1/mist/sle/anomalies.csv

GET  /api/v1/mist/sites/{site_id}/sle/trend?sle=ttc&days=30
     → [{ observed_at, value, baseline_mean }]        # for the drilldown chart
```

### UI

Panel: "Sites deviating from baseline this hour."
Table columns: **site · sle · current · your usual · Δ · z-score · trend sparkline**.

Sort by z-score by default. Threshold indicators:
- z ≤ −2 → red (statistically significant drop)
- −2 < z ≤ −1 → amber
- z > −1 → hidden by default (toggle "show all")

Click a row → 30-day trend chart with baseline band overlaid.

### Cold-start behavior

If a (site, sle) has fewer than 7 days of history, hide from the ranked list and show in a separate "Building baseline (N/30 days)" section. Prevents noise during rollout.

---

## Feature 12 — CSV Report Exports

**Scope confirmed:** CSV only, one-off download, no scheduling, no email, no PDF.

### Design

Every list-style API endpoint gets a **`.csv` twin** that returns the same rows as `text/csv` with `Content-Disposition: attachment`.

Column set = whatever the current filter/query returned. Query params identical to the JSON endpoint. No new query-builder UI — the export mirrors what the user is already looking at.

### Endpoints (adds `.csv` variants — no new logic layer)

```
GET /api/v1/mist/aps.csv?site_id=&reachability=&firmware=&fields=
GET /api/v1/mist/aps/{serial}/history.csv
GET /api/v1/mist/sle/anomalies.csv?window=&sle=
GET /api/v1/mist/sites/{site_id}/sle/trend.csv?sle=&days=
GET /api/v1/mist/clients/{mac}/timeline.csv?since=&until=
```

Optional `fields=` query param — comma-separated allow-list to trim columns. If omitted, sensible default column set per endpoint.

### Implementation notes

- Streamed generation (`StreamingResponse`) so large exports don't buffer in memory.
- CSV writer: `csv.writer` with `QUOTE_MINIMAL`, UTF-8, `\r\n` line ending (Excel-friendly).
- Filename: `naxis-mist-<endpoint>-<yyyymmdd-hhmm>.csv`.
- Timestamps: ISO 8601 UTC. No locale-specific formatting.

### UI

One "Export CSV" button on each panel where a CSV endpoint exists. Sends the current filter state, downloads the file. No modal, no field picker in v1.

---

## Build order (when we're ready to code)

1. **Feature 5** — simplest, self-contained, unlocks the append-only pattern.
2. **Feature 9** — new collector job + SQL, independent of 5.
3. **Feature 12** — trivially added once 5 and 9 have endpoints.
4. **Feature 8** — last; no schema, but the most Mist-API surface area and the most rate-limit risk.

## Open questions

- **SLE poll cadence.** 15 min → 96 samples/day. 5 min → 288/day. Tradeoff: baseline quality vs. Mist rate limits. Recommend 15 min for MVP.
- **AP history retention.** Unbounded is fine for a year or two; revisit only if row count crosses ~10M.
- **Client timeline `since`/`until` defaults.** Default to last 24h. Wider windows need per-site fan-out — cap `until - since` at 7 days to keep response time predictable.
