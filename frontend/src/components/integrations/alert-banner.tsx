"use client";

import { useState } from "react";
import {
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";

import { cn, formatTimestamp } from "@/lib/utils";
import type { TelemetryAlert, TelemetryAlertSeverity } from "@/types/integration";

interface AlertBannerProps {
  alert: TelemetryAlert;
}

interface AlertBannerGroupProps {
  alerts: TelemetryAlert[];
}

const severityConfig: Record<
  TelemetryAlertSeverity,
  {
    icon: typeof AlertTriangle;
    bg: string;
    border: string;
    text: string;
    dot: string;
    label: string;
  }
> = {
  warning: {
    icon: AlertTriangle,
    bg: "bg-minor-bg",
    border: "border-minor-border",
    text: "text-minor",
    dot: "bg-minor",
    label: "Warning",
  },
  critical: {
    icon: XCircle,
    bg: "bg-critical-bg",
    border: "border-critical-border",
    text: "text-critical",
    dot: "bg-critical",
    label: "Critical",
  },
};

const alertTypeLabels: Record<string, string> = {
  staleData: "Stale data",
  repeatedFailure: "Repeated failure",
  dataGap: "Data gap",
};

function AlertIcon({ severity }: { severity: TelemetryAlertSeverity }) {
  const config = severityConfig[severity];
  const Icon = config.icon;
  return <Icon className={cn("h-4 w-4 shrink-0", config.text)} />;
}

export function AlertBanner({ alert }: AlertBannerProps) {
  const config = severityConfig[alert.severity];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors",
        config.bg,
        config.border
      )}
    >
      {/* Severity dot */}
      <span
        className={cn(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          config.dot,
          alert.severity === "critical" && "animate-pulse"
        )}
      />

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <AlertIcon severity={alert.severity} />
          <span className={cn("text-xs font-semibold uppercase tracking-[0.12em]", config.text)}>
            {alertTypeLabels[alert.type] ?? alert.type}
          </span>
          <span className="text-xs text-foreground-muted">•</span>
          <span className="text-xs font-medium text-foreground-subtle">{alert.sourceSystem}</span>
        </div>
        <p className="text-sm leading-5 text-foreground">{alert.message}</p>
      </div>

      {/* Badge */}
      <div className="shrink-0">          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              alert.severity === "critical"
                ? "bg-critical/10 text-critical"
                : "bg-minor/10 text-minor"
            )}
          >
            {alert.severity === "critical" ? (
              <AlertCircle className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            {severityConfig[alert.severity].label}
          </span>
      </div>
    </div>
  );
}

export function AlertBannerGroup({ alerts }: AlertBannerGroupProps) {
  const [expanded, setExpanded] = useState(true);

  if (!alerts.length) {
    return null;
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <div className="rounded-2xl border border-border/40 bg-background/40 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-background-elevated/30"
      >
        <div className="flex items-center gap-3">
          {/* Animated warning dot */}
          {criticalCount > 0 ? (
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical/40" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-critical" />
            </span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-minor" />
          )}

          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              Collector Health Alerts
            </span>
            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums">
              {alerts.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Summary badges */}            {criticalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-critical/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-critical">
                <XCircle className="h-3 w-3" />
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-minor/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-minor">
                <AlertTriangle className="h-3 w-3" />
                {warningCount} warning
              </span>
            )}

          {expanded ? (
            <ChevronUp className="h-4 w-4 text-foreground-subtle" />
          ) : (
            <ChevronDown className="h-4 w-4 text-foreground-subtle" />
          )}
        </div>
      </button>

      {/* Alert list */}
      {expanded && (
        <div className="space-y-2 border-t border-border/40 px-4 py-3">
          {alerts.map((alert, index) => (
            <AlertBanner key={`${alert.collectorId}-${alert.type}-${index}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
