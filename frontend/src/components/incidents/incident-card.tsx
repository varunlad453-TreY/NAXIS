"use client";

import Link from "next/link";
import { Clock, Activity, Server, Wifi } from "lucide-react";
import type { IncidentSummary } from "@/types/incident";
import { SeverityBadge } from "./severity-badge";
import { StatusBadge } from "./status-badge";
import { formatTimestamp, formatConfidence, cn } from "@/lib/utils";

interface IncidentCardProps {
  incident: IncidentSummary;
}

export function IncidentCard({ incident }: IncidentCardProps) {
  const isActive = ["open", "investigating", "mitigated"].includes(incident.status);

  return (
    <Link
      href={`/incidents/${incident.incident_id}`}
      className={cn(
        "group block rounded-lg border bg-background-elevated p-5 transition-all",
        "hover:border-border-hover hover:bg-background-hover",
        isActive ? "border-border" : "border-border/50 opacity-75"
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-foreground leading-snug mb-2 group-hover:text-primary transition-colors">
            {incident.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={incident.severity} showDot />
            <StatusBadge status={incident.status} />
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xs text-foreground-subtle mb-1">Confidence</div>
          <div className="text-sm font-mono text-foreground-muted">
            {formatConfidence(incident.confidence_score)}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border/50">
        <div className="flex items-center gap-2 text-foreground-muted">
          <Activity className="h-3.5 w-3.5 text-foreground-subtle" />
          <div>
            <div className="text-2xs text-foreground-subtle">Events</div>
            <div className="text-sm font-medium">{incident.event_count}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-foreground-muted">
          <Server className="h-3.5 w-3.5 text-foreground-subtle" />
          <div>
            <div className="text-2xs text-foreground-subtle">Devices</div>
            <div className="text-sm font-medium">{incident.affected_devices_count}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-foreground-muted">
          <Wifi className="h-3.5 w-3.5 text-foreground-subtle" />
          <div>
            <div className="text-2xs text-foreground-subtle">Sites</div>
            <div className="text-sm font-medium">{incident.affected_sites_count}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-2xs text-foreground-subtle">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          <span>{formatTimestamp(incident.created_at)}</span>
        </div>
        <div className="font-mono">{incident.incident_id}</div>
      </div>
    </Link>
  );
}
