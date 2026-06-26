"use client";

import { AlertCircle, AlertTriangle, Info, TrendingUp } from "lucide-react";
import type { IncidentSummary } from "@/types/incident";
import { cn, getSeverityColors } from "@/lib/utils";

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

  const totalDevices = activeIncidents.reduce(
    (sum, i) => sum + i.affected_devices_count,
    0
  );

  const totalSites = activeIncidents.reduce(
    (sum, i) => sum + i.affected_sites_count,
    0
  );

  return (
    <div className={cn("space-y-4", className)}>
      {/* Active Incidents */}
      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground-muted">
            Active Incidents
          </h3>
          <TrendingUp className="h-4 w-4 text-primary" />
        </div>
        <div className="mb-2 text-4xl font-semibold tracking-tight text-foreground">
          {stats.total}
        </div>
        <div className="text-xs text-foreground-subtle">
          {stats.total === 0 ? "All systems operational" : "Requiring attention"}
        </div>
      </div>

      {/* By Severity */}
      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <h3 className="text-sm font-medium text-foreground-muted mb-4">
          By Severity
        </h3>
        <div className="space-y-3">
          {[
            { label: "Critical", count: stats.critical, icon: <AlertCircle className="h-4 w-4 text-critical" />, tone: getSeverityColors("critical") },
            { label: "Major", count: stats.major, icon: <AlertTriangle className="h-4 w-4 text-major" />, tone: getSeverityColors("major") },
            { label: "Minor", count: stats.minor, icon: <AlertTriangle className="h-4 w-4 text-minor" />, tone: getSeverityColors("minor") },
            { label: "Info", count: stats.info, icon: <Info className="h-4 w-4 text-info" />, tone: getSeverityColors("info") },
          ].map((item) => (
            <div key={item.label} className="space-y-2 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {item.icon}
                  <span className="text-sm text-foreground-muted">{item.label}</span>
                </div>
                <span className="text-sm font-medium text-foreground">{item.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5">
                <div
                  className={cn("h-1.5 rounded-full", item.tone.dot)}
                  style={{ width: `${Math.max(item.count * 12, item.count > 0 ? 14 : 0)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Impact Summary */}
      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <h3 className="text-sm font-medium text-foreground-muted mb-4">
          Impact Summary
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-foreground-subtle">
              Affected Sites
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {totalSites || 0}
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-foreground-subtle">
              Affected Devices
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {totalDevices || 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
