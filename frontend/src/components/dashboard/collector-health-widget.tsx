"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  HardDrive,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { TelemetryAlert } from "@/types/integration";

type StatusKey = "healthy" | "degraded" | "error" | "stale";

const STATUS_META: Record<
  StatusKey,
  { label: string; dot: string; text: string }
> = {
  healthy: { label: "Healthy", dot: "bg-success", text: "text-success" },
  degraded: { label: "Degraded", dot: "bg-minor", text: "text-minor" },
  error: { label: "Error", dot: "bg-critical", text: "text-critical" },
  stale: { label: "Stale", dot: "bg-warning", text: "text-warning" },
};

const STATUS_ORDER: StatusKey[] = ["healthy", "degraded", "error", "stale"];

const MAX_VISIBLE_ALERTS = 3;

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
      <div>
        <div className="flex items-center gap-2.5">
          <div className="h-4 w-4 animate-pulse bg-foreground/5" />
          <div className="space-y-1">
            <div className="h-3 w-36 animate-pulse bg-foreground/5" />
            <div className="h-2 w-24 animate-pulse bg-foreground/5" />
          </div>
        </div>
        <div className="mt-3 flex gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-16 animate-pulse bg-foreground/5" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-3 border-t border-critical/20 py-3 text-critical">
        <XCircle className="h-4 w-4 shrink-0" />
        <span className="text-sm leading-5">Failed to load collector health</span>
        <button
          onClick={() => window.location.reload()}
          className="ml-auto text-[10px] font-semibold uppercase tracking-[0.1em] text-critical transition-colors hover:text-critical/80"
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
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <HardDrive className={cn("h-4 w-4", allHealthy ? "text-success" : hasCritical ? "text-critical" : "text-minor")} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Collector Health</h3>
            <p className="text-[10px] leading-4 text-foreground-subtle/70">Data pipeline status</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          {allHealthy && (
            <span className="inline-flex items-center gap-1.5 text-success">
              <span className="h-1.5 w-1.5 bg-success" />
              All healthy
            </span>
          )}
          {hasCritical && (
            <span className="inline-flex items-center gap-1.5 text-critical">
              <span className="h-1.5 w-1.5 bg-critical" />
              {alerts.filter((a: TelemetryAlert) => a.severity === "critical").length} critical
            </span>
          )}
          <span className="font-mono tabular-nums text-foreground-subtle">
            {summary.totalCollectors}
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        {STATUS_ORDER.map((key) => {
          const meta = STATUS_META[key];
          return (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5", meta.dot)} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">{meta.label}</span>
              <span className={cn("font-mono font-semibold tabular-nums", meta.text)}>{summary[key]}</span>
            </span>
          );
        })}
      </div>

      {hasAlerts && (
        <>
          <div className="mb-2 flex items-center justify-between border-t border-border/40 pt-2.5">
            <button
              onClick={() => setAlertsExpanded((v) => !v)}
              className="flex items-center gap-2 text-left transition-colors hover:text-foreground"
            >
              <div className="flex items-center gap-1.5">
                {hasCritical ? (
                  <span className="h-2 w-2 bg-critical" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-minor" />
                )}
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Active Alerts
                </span>
                <span className="font-mono text-[10px] font-semibold tabular-nums">
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
            <div className="divide-y divide-border/30">
              {visibleAlerts.map((alert, i) => (
                <div key={`${alert.collectorId}-${alert.type}-${i}`} className="flex items-start gap-3 py-2">
                  <span className={cn(
                    "mt-1 h-2 w-2 shrink-0",
                    alert.severity === "critical" ? "bg-critical" : "bg-minor",
                    alert.severity === "critical" && "animate-pulse"
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={cn("text-xs font-semibold uppercase tracking-[0.12em]", alert.severity === "critical" ? "text-critical" : "text-minor")}>
                        {alert.type}
                      </span>
                      <span className="text-xs text-foreground-muted">·</span>
                      <span className="text-xs font-medium text-foreground-subtle">{alert.sourceSystem}</span>
                    </div>
                    <p className="text-sm leading-5 text-foreground">{alert.message}</p>
                  </div>
                  <span className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.12em]",
                    alert.severity === "critical" ? "text-critical" : "text-minor"
                  )}>
                    {alert.severity === "critical" ? "Critical" : "Warning"}
                  </span>
                </div>
              ))}
              {overflowCount > 0 && (
                <div className="py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                  <Link href="/integrations" className="flex items-center gap-1 transition-colors hover:text-foreground">
                    <AlertTriangle className="h-3 w-3" />
                    +{overflowCount} more — view all in Integrations
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {allHealthy && (
        <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 bg-success" />
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
