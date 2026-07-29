"use client";

import {
  AlertCircle,
  AlertTriangle,
  Clock,
  HelpCircle,
  MapPin,
  Network,
  Server,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { IncidentDetail } from "@/types/incident";
import { Skeleton } from "@/components/ui/skeleton";

interface BlastRadiusPanelProps {
  incidentId?: string | null;
  incidentDetail?: IncidentDetail | null;
  loading?: boolean;
}

const SEVERITY_META: Record<string, { color: string; bg: string; icon: typeof AlertCircle }> = {
  critical: { color: "text-critical", bg: "bg-critical/10", icon: AlertCircle },
  major: { color: "text-major", bg: "bg-major/10", icon: AlertTriangle },
  minor: { color: "text-minor", bg: "bg-minor/10", icon: HelpCircle },
  info: { color: "text-info", bg: "bg-info/10", icon: HelpCircle },
};

const STATUS_META: Record<string, { color: string; label: string }> = {
  open: { color: "bg-critical", label: "Open" },
  investigating: { color: "bg-major", label: "Investigating" },
  mitigated: { color: "bg-minor", label: "Mitigated" },
  resolved: { color: "bg-success", label: "Resolved" },
  closed: { color: "bg-foreground-subtle", label: "Closed" },
  suppressed: { color: "bg-foreground-muted", label: "Suppressed" },
};

function formatTime(ts?: string | null) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatConfidence(score?: number | null) {
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

export function BlastRadiusPanel({
  incidentDetail,
  loading,
}: BlastRadiusPanelProps) {
  if (loading) {
    return (
      <div className="space-y-5 p-5">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!incidentDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Network className="mb-3 h-10 w-10 text-foreground-muted" />
        <p className="text-sm text-foreground-muted">No incident data available</p>
      </div>
    );
  }

  const severityMeta = SEVERITY_META[incidentDetail.severity] ?? SEVERITY_META.info;
  const SeverityIcon = severityMeta.icon;
  const statusMeta = STATUS_META[incidentDetail.status] ?? STATUS_META.open;

  const rootCauseCount = incidentDetail.topology_node_ids?.length ?? 0;
  const symptomCount = (incidentDetail.affected_devices?.length ?? 0) - rootCauseCount;

  return (
    <div className="space-y-5 p-5">
      {/* Severity + Status */}
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${severityMeta.bg}`}>
          <SeverityIcon className={`h-5 w-5 ${severityMeta.color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">
            {incidentDetail.title}
          </h3>
          <div className="mt-0.5 flex items-center gap-2">
            <span className={`text-xs font-medium ${severityMeta.color}`}>
              {incidentDetail.severity_label}
            </span>
            <span className="text-foreground-muted">·</span>
            <span className="flex items-center gap-1 text-xs text-foreground-muted">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusMeta.color}`} />
              {statusMeta.label}
            </span>
          </div>
        </div>
      </div>

      {/* Confidence */}
      <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-surface/50 px-4 py-3">
        <Shield className="h-5 w-5 text-primary" />
        <div>
          <div className="text-xs text-foreground-subtle">Confidence</div>
          <div className="text-lg font-semibold text-foreground">
            {formatConfidence(incidentDetail.confidence_score)}
          </div>
        </div>
      </div>

      {/* Blast Radius Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/40 bg-surface/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <MapPin className="h-3.5 w-3.5" />
            Sites
          </div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {incidentDetail.affected_sites_count}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-surface/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Server className="h-3.5 w-3.5" />
            Devices
          </div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {incidentDetail.affected_devices_count}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-surface/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <AlertCircle className="h-3.5 w-3.5" />
            Root Cause
          </div>
          <div className="mt-1 text-2xl font-semibold text-critical">
            {rootCauseCount}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-surface/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Activity className="h-3.5 w-3.5" />
            Symptoms
          </div>
          <div className="mt-1 text-2xl font-semibold text-major">
            {Math.max(0, symptomCount)}
          </div>
        </div>
      </div>

      {/* Probable Cause */}
      {incidentDetail.probable_cause && (
        <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            Probable Cause
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
            {incidentDetail.probable_cause}
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          Timeline
        </div>
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            <div>
              <div className="text-xs font-medium text-foreground">Incident Detected</div>
              <div className="text-[11px] text-foreground-muted">
                {formatTime(incidentDetail.created_at)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-foreground-muted ring-2 ring-background" />
            <div>
              <div className="text-xs font-medium text-foreground">Last Updated</div>
              <div className="text-[11px] text-foreground-muted">
                {formatTime(incidentDetail.updated_at)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Affected Sites */}
      {incidentDetail.affected_sites.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            Affected Sites
          </div>
          <div className="mt-2 space-y-1">
            {incidentDetail.affected_sites.slice(0, 5).map((site) => (
              <div key={site} className="font-mono text-xs text-foreground-muted">
                {site}
              </div>
            ))}
            {incidentDetail.affected_sites.length > 5 && (
              <div className="text-xs text-foreground-subtle">
                +{incidentDetail.affected_sites.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Affected Devices */}
      {incidentDetail.affected_devices.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Server className="h-3.5 w-3.5 text-primary" />
            Affected Devices
          </div>
          <div className="mt-2 space-y-1">
            {incidentDetail.affected_devices.slice(0, 8).map((device) => (
              <div key={device} className="font-mono text-xs text-foreground-muted">
                {device}
              </div>
            ))}
            {incidentDetail.affected_devices.length > 8 && (
              <div className="text-xs text-foreground-subtle">
                +{incidentDetail.affected_devices.length - 8} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* View Incident Link */}
      <Link
        href={`/incidents/${incidentDetail.incident_id}`}
        className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <Shield className="h-4 w-4" />
        View Full Incident Details
      </Link>
    </div>
  );
}

// Used locally
function Activity({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}
