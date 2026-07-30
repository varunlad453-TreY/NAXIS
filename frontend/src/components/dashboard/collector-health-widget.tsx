"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  HardDrive,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { AlertBanner } from "@/components/integrations/alert-banner";
import type { TelemetryAlert, TelemetryResponse } from "@/types/integration";

type StatusKey = "healthy" | "degraded" | "error" | "stale";

const STATUS_META: Record<
  StatusKey,
  { label: string; dot: string; text: string; bg: string; border: string }
> = {
  healthy: {
    label: "Healthy",
    dot: "bg-success",
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/15",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-minor",
    text: "text-minor",
    bg: "bg-minor/10",
    border: "border-minor/15",
  },
  error: {
    label: "Error",
    dot: "bg-critical",
    text: "text-critical",
    bg: "bg-critical/10",
    border: "border-critical/15",
  },
  stale: {
    label: "Stale",
    dot: "bg-warning",
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/15",
  },
};

const STATUS_ORDER: StatusKey[] = ["healthy", "degraded", "error", "stale"];

const MAX_VISIBLE_ALERTS = 3;

function StatItem({ count, statusKey }: { count: number; statusKey: StatusKey }) {
  const meta = STATUS_META[statusKey];
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors",
        meta.bg,
        meta.border,
      )}
    >
      <span className={cn("font-mono text-lg font-semibold tabular-nums", meta.text)}>
        {count}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        {meta.label}
      </span>
    </div>
  );
}

export function CollectorHealthWidget() {
  const [alertsExpanded, setAlertsExpanded] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["telemetry"],
    queryFn: () => api.getTelemetry(),
    refetchInterval: 30000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div
        className="rounded-xl border border-border/60 bg-surface/40 p-5"
        style={{ animation: "naxis-enter 0.6s 0.1s both" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-foreground/5" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-36 animate-pulse rounded bg-foreground/5" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-foreground/5" />
          </div>
          <div className="ml-auto h-6 w-20 animate-pulse rounded-full bg-foreground/5" />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[62px] animate-pulse rounded-lg bg-foreground/5" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-critical/20 bg-critical/5 px-4 py-3"
        style={{ animation: "naxis-enter 0.6s 0.1s both" }}
      >
        <XCircle className="h-4 w-4 shrink-0 text-critical" />
        <span className="text-sm leading-5 text-critical">
          Failed to load collector health
        </span>
        <button
          onClick={() => window.location.reload()}
          className="ml-auto rounded-lg border border-critical/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-critical transition-colors hover:bg-critical/10"
        >
          Retry
        </button>
      </div>
    );
  }

  const { alerts, summary } = data;
  const hasAlerts = alerts.length > 0;
  const visibleAlerts = alerts.slice(0, MAX_VISIBLE_ALERTS);
  const overflowCount = alerts.length - MAX_VISIBLE_ALERTS;
  const allHealthy = summary.error === 0 && summary.stale === 0 && !hasAlerts;
  const hasCritical = alerts.some((a: TelemetryAlert) => a.severity === "critical");

  return (
    <section
      className="group rounded-xl border border-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-border hover:bg-surface"
      style={{ animation: "naxis-enter 0.6s 0.2s both" }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              allHealthy ? "bg-success/10 text-success" : hasCritical ? "bg-critical/10 text-critical" : "bg-minor/10 text-minor",
            )}
          >
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Collector Health
            </h3>
            <p className="text-[10px] leading-4 text-foreground-subtle/70">
              Data pipeline status
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {allHealthy && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-semibold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              All healthy
            </span>
          )}
          {hasCritical && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-critical/10 px-2.5 py-1 text-[10px] font-semibold text-critical">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-critical" />
              </span>
              {alerts.filter((a: TelemetryAlert) => a.severity === "critical").length} critical
            </span>
          )}
          <span className="rounded-full bg-foreground/5 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-foreground-subtle">
            {summary.totalCollectors}
          </span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2.5">
        {STATUS_ORDER.map((key) => (
          <StatItem key={key} count={summary[key]} statusKey={key} />
        ))}
      </div>

      {hasAlerts && (
        <>
          <div className="mb-3 flex items-center justify-between border-t border-border/40 pt-3.5">
            <button
              onClick={() => setAlertsExpanded((v) => !v)}
              className="flex items-center gap-2 text-left transition-colors hover:text-foreground"
            >
              <div className="flex items-center gap-1.5">
                {hasCritical ? (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical/40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-critical" />
                  </span>
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-minor" />
                )}
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Active Alerts
                </span>
                <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {alerts.length}
                </span>
              </div>
              {alertsExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-foreground-subtle" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-foreground-subtle" />
              )}
            </button>

            <Link
              href="/integrations"
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:text-primary/80"
            >
              View all
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {alertsExpanded && (
            <div className="space-y-2">
              {visibleAlerts.map((alert, i) => (
                <AlertBanner
                  key={`${alert.collectorId}-${alert.type}-${i}`}
                  alert={alert}
                />
              ))}
              {overflowCount > 0 && (
                <Link
                  href="/integrations"
                  className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border/40 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle transition-colors hover:border-border hover:text-foreground"
                >
                  <AlertTriangle className="h-3 w-3" />
                  +{overflowCount} more — view all in Integrations
                  <ChevronRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {allHealthy && (
        <div className="flex items-center justify-between border-t border-border/40 pt-3.5">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="text-[10px] font-medium text-foreground-subtle">
              All collectors operating normally
            </span>
          </div>
          <Link
            href="/integrations"
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:text-primary/80"
          >
            Details
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </section>
  );
}
