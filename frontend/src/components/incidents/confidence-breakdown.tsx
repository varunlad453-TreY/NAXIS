"use client";

import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Cell, Tooltip, LabelList } from "recharts";
import type { ConfidenceBreakdown as ConfidenceBreakdownType } from "@/types/incident";
import { Skeleton } from "@/components/ui/skeleton";

interface ConfidenceBreakdownProps {
  breakdown: ConfidenceBreakdownType | null;
  total: number;
  isLoading?: boolean;
}

const FACTOR_LABELS: Record<string, string> = {
  event_score: "Event Count",
  avg_severity: "Severity Weight",
  device_score: "Device Diversity",
};

const FACTOR_COLORS: Record<string, string> = {
  event_score: "#3b82f6",
  avg_severity: "#8b5cf6",
  device_score: "#10b981",
};

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function ConfidenceBreakdown({ breakdown, total, isLoading }: ConfidenceBreakdownProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!breakdown) {
    return (
      <div className="rounded-lg border border-border/40 p-4 text-sm text-foreground-muted">
        Confidence breakdown not available for this incident.
      </div>
    );
  }

  const bars = Object.entries(FACTOR_LABELS).map(([key, label]) => ({
    key,
    label,
    value: breakdown[key as keyof ConfidenceBreakdownType] as number,
    color: FACTOR_COLORS[key] ?? "#6b7280",
  }));

  return (
    <div className="space-y-4">
      {/* Total score */}
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          Overall Confidence
        </span>
        <span className="text-xl font-bold text-foreground">{formatPct(total)}</span>
      </div>

      {/* Factor breakdown bars */}
      <div className="space-y-3">
        {bars.map(({ key, label, value, color }) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground-muted">{label}</span>
              <span className="font-medium text-foreground">{formatPct(value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Formula description */}
      <details className="group cursor-pointer">
        <summary className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle transition-colors hover:text-foreground-muted">
          How is this calculated?
        </summary>
        <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
          Confidence = (Event Count × 0.4) + (Severity Weight × 0.4) + (Device Diversity × 0.2).
          Event Count uses a logarithmic scale so the first few events contribute more than later ones.
          Severity Weight is the mean of per-event severity scores (critical=1.0, major=0.7, minor=0.4, warning=0.2, info=0.1).
          Device Diversity is normalized by 5 devices — 5+ unique devices gives a perfect score.
        </p>
      </details>
    </div>
  );
}
