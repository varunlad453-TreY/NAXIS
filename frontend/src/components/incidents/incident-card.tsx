"use client";

import Link from "next/link";
import { Clock, Activity, Server, Wifi } from "lucide-react";
import type { IncidentSummary } from "@/types/incident";
import { SeverityBadge } from "./severity-badge";
import { StatusBadge } from "./status-badge";
import {
  formatTimestamp,
  formatConfidence,
  cn,
  getSeverityColors,
} from "@/lib/utils";

interface IncidentCardProps {
  incident: IncidentSummary;
}

export function IncidentCard({ incident }: IncidentCardProps) {
  const isActive = ["open", "investigating", "mitigated"].includes(incident.status);
  const severityColors = getSeverityColors(incident.severity);

  return (
    <Link
      href={`/incidents/${incident.incident_id}`}
      className={cn(
        "group relative block overflow-hidden rounded-[1.4rem] border bg-white/[0.035] p-5 shadow-[0_20px_50px_-40px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]",
        isActive ? "border-white/10" : "border-white/5 opacity-80"
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1.5", severityColors.dot)} />

      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4 pl-1.5 sm:pl-2">
        <div className="min-w-0 flex-1">
          <h3 className="mb-2 text-base font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
            {incident.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={incident.severity} showDot />
            <StatusBadge status={incident.status} />
          </div>
        </div>
        <div className="flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-right">
          <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-foreground-subtle">
            Confidence
          </div>
          <div className="text-sm font-mono text-foreground-muted">
            {formatConfidence(incident.confidence_score)}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 border-t border-white/8 pt-4 pl-1.5 sm:pl-2">
        <div className="flex items-center gap-2 text-foreground-muted">
          <Activity className="h-4 w-4 text-foreground-subtle" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">Events</div>
            <div className="text-sm font-medium text-foreground">{incident.event_count}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-foreground-muted">
          <Server className="h-4 w-4 text-foreground-subtle" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">Devices</div>
            <div className="text-sm font-medium text-foreground">{incident.affected_devices_count}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-foreground-muted">
          <Wifi className="h-4 w-4 text-foreground-subtle" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">Sites</div>
            <div className="text-sm font-medium text-foreground">{incident.affected_sites_count}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-4 text-[10px] uppercase tracking-[0.18em] text-foreground-subtle pl-1.5 sm:pl-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          <span>{formatTimestamp(incident.created_at)}</span>
        </div>
        <div className="font-mono">{incident.incident_id}</div>
      </div>
    </Link>
  );
}
