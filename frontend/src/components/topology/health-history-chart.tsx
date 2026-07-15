"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { api } from "@/lib/api";
import { HEALTH_STATUS_META } from "@/types/topology";
import type { HealthSnapshot } from "@/types/topology";
import { Skeleton } from "@/components/ui/skeleton";

interface HealthHistoryChartProps {
  nodeId: string;
}

type RangeKey = "6h" | "24h" | "7d";

const RANGES: { key: RangeKey; label: string; hours: number }[] = [
  { key: "6h", label: "6H", hours: 6 },
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 168 },
];

function formatHour(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return ts;
  }
}

interface ChartDataPoint {
  time: string;
  fullTime: string;
  healthy?: number;
  warning?: number;
  critical?: number;
  unknown?: number;
  statusKey: string;
}

function snapshotsToChartData(history: HealthSnapshot[], range: RangeKey): ChartDataPoint[] {
  if (!history.length) return [];

  const reversed = [...history].reverse();
  const bucketKey = range === "7d" ? "day" : "hour";

  const buckets = new Map<string, ChartDataPoint>();

  for (const snap of reversed) {
    const ts = snap.snapshot_at;
    const key = bucketKey === "day" ? formatDate(ts) : formatHour(ts);

    if (!buckets.has(key)) {
      buckets.set(key, {
        time: key,
        fullTime: ts,
        statusKey: snap.health_status,
        [snap.health_status]: 1,
      });
    }
  }

  const result = Array.from(buckets.values());
  return result.slice(-100);
}

export function HealthHistoryChart({ nodeId }: HealthHistoryChartProps) {
  const [range, setRange] = useState<RangeKey>("24h");

  const hours = RANGES.find((r) => r.key === range)?.hours ?? 24;

  const { data, isLoading, error } = useQuery({
    queryKey: ["health-history", nodeId, hours],
    queryFn: () => api.getNodeHealthHistory(nodeId, { hours_back: hours, limit: 500 }),
    enabled: !!nodeId,
  });

  const chartData = useMemo(
    () => snapshotsToChartData(data?.history ?? [], range),
    [data?.history, range],
  );

  const summary = data?.summary;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border/40 bg-surface/50 p-4 text-sm text-foreground-muted">
        Failed to load health history
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 bg-surface/50 p-4 text-center text-sm text-foreground-muted">
        No health history data available yet
      </div>
    );
  }

  const totalSnapshots = Object.values(summary ?? {}).reduce((a: number, b: number) => a + b, 0);
  const pct = (status: string) =>
    totalSnapshots > 0 ? Math.round(((summary?.[status] ?? 0) / totalSnapshots) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Time range toggles */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground-subtle uppercase tracking-[0.14em]">
          Health Timeline
        </span>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                range === r.key
                  ? "bg-primary/10 text-primary"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-28 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: "hsl(var(--foreground-muted))" }}
              axisLine={{ stroke: "hsl(var(--border) / 0.4)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0]?.payload as ChartDataPoint | undefined;
                if (!data) return null;
                const statusKey = data.statusKey;
                const meta = HEALTH_STATUS_META[statusKey] ?? HEALTH_STATUS_META.unknown;
                return (
                  <div className="rounded-lg border border-border/60 bg-surface px-3 py-2 shadow-surface-lg text-xs">
                    <div className="font-mono text-foreground-muted">{data.fullTime}</div>
                    <div className="mt-0.5 font-semibold" style={{ color: meta.color }}>
                      {meta.label}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey={() => 1} radius={[2, 2, 0, 0]} maxBarSize={24}>
              {chartData.map((entry, index) => {
                const meta = HEALTH_STATUS_META[entry.statusKey] ?? HEALTH_STATUS_META.unknown;
                return <Cell key={index} fill={meta.color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary breakdown */}
      {summary && (
        <div className="flex gap-3 text-[10px]">
          {(["healthy", "warning", "critical", "unknown"] as const).map((status) => {
            const meta = HEALTH_STATUS_META[status];
            const count = summary[status] ?? 0;
            return (
              <div key={status} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="text-foreground-muted">{meta.label}</span>
                <span className="font-medium text-foreground">{pct(status)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
