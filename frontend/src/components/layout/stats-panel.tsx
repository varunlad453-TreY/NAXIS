"use client";

import { AlertCircle, AlertTriangle, Info, TrendingUp } from "lucide-react";
import type { IncidentSummary } from "@/types/incident";
import { cn } from "@/lib/utils";

interface StatsPanelProps {
  incidents: IncidentSummary[];
  className?: string;
}

export function StatsPanel({ incidents, className }: StatsPanelProps) {
  const activeIncidents = incidents.filter((i) =>
    ["open", "investigating", "mitigated"].includes(i.status)
  );

  const stats = {
    total: activeIncidents.length,
    critical: activeIncidents.filter((i) => i.severity === "critical").length,
    major: activeIncidents.filter((i) => i.severity === "major").length,
    minor: activeIncidents.filter((i) => i.severity === "minor").length,
    info: activeIncidents.filter((i) => i.severity === "info").length,
  };

  const totalDevices = new Set(
    activeIncidents.flatMap((i) => i.affected_devices_count)
  ).size;

  const totalSites = new Set(
    activeIncidents.flatMap((i) => i.affected_sites_count)
  ).size;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Active Incidents */}
      <div className="rounded-lg border border-border bg-background-elevated p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground-muted">
            Active Incidents
          </h3>
          <TrendingUp className="h-4 w-4 text-foreground-subtle" />
        </div>
        <div className="text-4xl font-semibold text-foreground mb-2">
          {stats.total}
        </div>
        <div className="text-xs text-foreground-subtle">
          {stats.total === 0 ? "All systems operational" : "Requiring attention"}
        </div>
      </div>

      {/* By Severity */}
      <div className="rounded-lg border border-border bg-background-elevated p-5">
        <h3 className="text-sm font-medium text-foreground-muted mb-4">
          By Severity
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-critical" />
              <span className="text-sm text-foreground-muted">Critical</span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {stats.critical}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-major" />
              <span className="text-sm text-foreground-muted">Major</span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {stats.major}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-minor" />
              <span className="text-sm text-foreground-muted">Minor</span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {stats.minor}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-info" />
              <span className="text-sm text-foreground-muted">Info</span>
            </div>
            <span className="text-sm font-medium text-foreground">
              {stats.info}
            </span>
          </div>
        </div>
      </div>

      {/* Impact Summary */}
      <div className="rounded-lg border border-border bg-background-elevated p-5">
        <h3 className="text-sm font-medium text-foreground-muted mb-4">
          Impact Summary
        </h3>
        <div className="space-y-3">
          <div>
            <div className="text-2xl font-semibold text-foreground">
              {totalSites || 0}
            </div>
            <div className="text-xs text-foreground-subtle">Affected Sites</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-foreground">
              {totalDevices || 0}
            </div>
            <div className="text-xs text-foreground-subtle">Affected Devices</div>
          </div>
        </div>
      </div>
    </div>
  );
}
