"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, MapPin, RefreshCw } from "lucide-react";
import { api, type MistSleAnomaly } from "@/lib/api";

const SLE_LABELS: Record<string, string> = {
  "successful-connect": "Successful Connect",
  "throughput":         "Throughput",
  "coverage":           "Coverage",
  "capacity":           "Capacity",
  "roaming":            "Roaming",
  "time-to-connect":    "Time to Connect",
  "ap-health":          "AP Health",
  "ap-redundancy":      "AP Redundancy",
};

const WINDOWS = [
  { label: "1h",  hours: 1 },
  { label: "6h",  hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d",  hours: 168 },
];

const Z_BANDS = [
  { label: "Critical (z ≤ −2)", value: -2 },
  { label: "Warning (z ≤ −1)",  value: -1 },
  { label: "All deviations",    value: 0 },
];

function zColor(z: number) {
  if (z <= -2) return "text-critical";
  if (z <= -1) return "text-major";
  return "text-foreground-muted";
}

function zBadge(z: number) {
  if (z <= -2) return "bg-critical/10 text-critical border-critical/30";
  if (z <= -1) return "bg-major/10 text-major border-major/30";
  return "bg-surface text-foreground-muted border-border/40";
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function AnomalyRow({ row }: { row: MistSleAnomaly }) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 px-3 py-2.5 text-sm border-b border-border/30 last:border-0 hover:bg-surface/50 transition-colors">
      <div className="col-span-4 flex items-center gap-2 min-w-0">
        <MapPin className="h-3 w-3 shrink-0 text-violet-400" />
        <span className="truncate text-foreground font-medium">{row.site_name}</span>
      </div>
      <div className="col-span-3">
        <span className="text-xs px-1.5 py-0.5 rounded border font-medium bg-surface/60 border-border/40 text-foreground-muted">
          {SLE_LABELS[row.sle] || row.sle}
        </span>
      </div>
      <div className="col-span-2 text-right font-mono">
        <span className={zColor(row.z_score)}>{pct(row.current)}</span>
        <div className="text-[10px] text-foreground-subtle">org avg {pct(row.org_mean)}</div>
      </div>
      <div className="col-span-2 text-right">
        <span className={`text-xs font-mono ${zColor(row.z_score)}`}>
          {row.delta_pct > 0 ? "+" : ""}{row.delta_pct}pp
        </span>
      </div>
      <div className="col-span-1 text-right">
        <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-mono font-semibold ${zBadge(row.z_score)}`}>
          {row.z_score.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function SleAnomalyPanel() {
  const [windowHours, setWindowHours] = useState(24);
  const [zThreshold, setZThreshold] = useState(-1);
  const [sleFilter, setSleFilter] = useState<string>("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["mist-sle-anomalies", windowHours, zThreshold, sleFilter],
    queryFn: () => api.mistSleAnomalies({
      window: windowHours,
      limit: 100,
      z_threshold: zThreshold,
      sle: sleFilter || undefined,
    }),
    staleTime: 4 * 60 * 1000,
  });

  const csvHref = api.mistSleAnomaliesCsvUrl({
    window: windowHours,
    z_threshold: zThreshold,
    sle: sleFilter || undefined,
  });

  const anomalies = data?.anomalies ?? [];
  const critical = anomalies.filter(a => a.z_score <= -2).length;
  const warning  = anomalies.filter(a => a.z_score > -2 && a.z_score <= -1).length;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">SLE Anomalies</div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Sites deviating from org baseline</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Z-score deviation across all sites. Negative = below org average for that SLE. Live from Mist — no storage.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setWindowHours(w.hours)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                windowHours === w.hours
                  ? "bg-primary/15 text-primary"
                  : "text-foreground-subtle hover:bg-surface hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {Z_BANDS.map(b => (
            <button
              key={b.value}
              type="button"
              onClick={() => setZThreshold(b.value)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                zThreshold === b.value
                  ? "bg-primary/15 text-primary"
                  : "text-foreground-subtle hover:bg-surface hover:text-foreground"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <select
          value={sleFilter}
          onChange={e => setSleFilter(e.target.value)}
          className="rounded-md border border-border/50 bg-transparent px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/60"
        >
          <option value="">All SLE metrics</option>
          {Object.entries(SLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-foreground-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </button>

        {data && (
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:border-primary/60 hover:text-foreground"
          >
            <Download className="h-3 w-3" /> Export CSV
          </a>
        )}
      </div>

      {/* Summary badges */}
      {data && (
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-critical/30 bg-critical/5 px-3 py-1.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-critical" />
            <span className="font-semibold text-critical">{critical}</span>
            <span className="text-foreground-muted">critical (z ≤ −2)</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-major/30 bg-major/5 px-3 py-1.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-major" />
            <span className="font-semibold text-major">{warning}</span>
            <span className="text-foreground-muted">warning (z ≤ −1)</span>
          </div>
          <div className="ml-auto text-xs text-foreground-subtle self-center">
            {data.count} entries · {windowHours}h window · 5 min cache
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-foreground-muted">Fetching from Mist…</div>
      )}

      {error && (
        <div className="rounded-lg border border-critical/40 bg-critical/5 px-4 py-3 text-sm text-critical">
          {(error as Error).message}
        </div>
      )}

      {data && anomalies.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/50 bg-surface/20 px-4 py-8 text-center text-sm text-foreground-muted">
          No sites deviating beyond threshold in this window.
        </div>
      )}

      {data && anomalies.length > 0 && (
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="hidden grid-cols-12 gap-2 border-b border-border/60 bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
            <div className="col-span-4">Site</div>
            <div className="col-span-3">SLE Metric</div>
            <div className="col-span-2 text-right">Current / Avg</div>
            <div className="col-span-2 text-right">Delta</div>
            <div className="col-span-1 text-right">Z-Score</div>
          </div>
          <div className="divide-y divide-border/20">
            {anomalies.map((a, i) => (
              <AnomalyRow key={`${a.site_id}-${a.sle}-${i}`} row={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
