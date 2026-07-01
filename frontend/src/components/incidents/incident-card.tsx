"use client";

import Link from "next/link";
import { Clock, Activity, Server, Wifi } from "lucide-react";
import type { IncidentSummary } from "@/types/incident";
import { SeverityBadge } from "./severity-badge";
import { StatusBadge } from "./status-badge";
import { formatTimestamp, formatConfidence, cn, getSeverityColors } from "@/lib/utils";

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
        "group grid grid-cols-12 items-center gap-4 px-2 py-4 transition-colors",
        "hover:bg-surface",
        !isActive && "opacity-70"
      )}
    >
      <div className="col-span-12 flex items-start gap-3 lg:col-span-5">
        <div className={cn("mt-2 h-2 w-2 rounded-full flex-shrink-0", severityColors.dot)} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} showDot={false} />
            <StatusBadge status={incident.status} />
          </div>
          <h3 className="mt-1.5 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
            {incident.title}
          </h3>
          <div className="mt-1 hidden items-center gap-2 text-xs text-foreground-subtle sm:flex">
            <span className="font-mono">{incident.incident_id}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimestamp(incident.created_at)}
            </span>
          </div>
        </div>
      </div>

      <div className="col-span-12 flex items-center gap-5 pl-5 text-sm lg:col-span-4 lg:pl-0">
        <ImpactItem icon={<Activity className="h-3.5 w-3.5" />} value={incident.event_count} label="Events" />
        <ImpactItem icon={<Server className="h-3.5 w-3.5" />} value={incident.affected_devices_count} label="Devices" />
        <ImpactItem icon={<Wifi className="h-3.5 w-3.5" />} value={incident.affected_sites_count} label="Sites" />
      </div>

      <div className="col-span-6 pl-5 text-sm lg:col-span-2 lg:pl-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Confidence</div>
        <div className="mt-0.5 font-semibold text-foreground">
          {formatConfidence(incident.confidence_score)}
        </div>
      </div>

      <div className="col-span-6 text-right text-xs text-foreground-subtle lg:col-span-1">
        {formatTimestamp(incident.updated_at)}
      </div>
    </Link>
  );
}

function ImpactItem({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-foreground-subtle">{icon}</span>
      <span className="font-semibold text-foreground">{value}</span>
      <span className="text-xs text-foreground-subtle">{label}</span>
    </div>
  );
}
