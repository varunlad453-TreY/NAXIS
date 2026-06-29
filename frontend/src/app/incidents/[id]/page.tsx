"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Activity,
  Server,
  Wifi,
  Users,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { SeverityBadge } from "@/components/incidents/severity-badge";
import { StatusBadge } from "@/components/incidents/status-badge";
import { EventRow } from "@/components/events/event-row";
import { EventListSkeleton } from "@/components/events/event-list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatTimestamp,
  formatAbsoluteTimestamp,
  formatConfidence,
} from "@/lib/utils";

export default function IncidentDetailPage() {
  const params = useParams();
  const incidentId = params.id as string;

  const { data: incident, isLoading, error } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.getIncident(incidentId),
    retry: 1,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["events", incidentId],
    queryFn: () => api.listEvents({ incident_id: incidentId, limit: 100 }),
    enabled: !!incidentId,
  });

  if (isLoading) {
    return <IncidentDetailSkeleton />;
  }

  if (error || !incident) {
    return (
      <div className="container mx-auto px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="border-l-2 border-l-critical-border pl-4 py-3 text-critical">
            <AlertCircle className="mb-2 h-6 w-6" />
            <h3 className="text-lg font-semibold">Incident not found</h3>
            <p className="text-foreground-muted">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to incidents
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to incidents
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-6 border-b border-border/60 pb-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={incident.severity} showDot />
              <StatusBadge status={incident.status} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {incident.title}
            </h1>
            <p className="font-mono text-sm text-foreground-subtle">{incident.incident_id}</p>
          </div>
          <div className="text-left lg:text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Confidence
            </div>
            <div className="mt-1 text-4xl font-semibold text-foreground">
              {formatConfidence(incident.confidence_score)}
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-10 lg:col-span-2">
            {incident.probable_cause && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Probable Cause
                </h2>
                <p className="max-w-3xl leading-relaxed text-foreground-muted">
                  {incident.probable_cause}
                </p>
              </section>
            )}

            {/* Timeline */}
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Timeline
              </h2>
              <div className="relative space-y-6 pl-4">
                <div className="absolute bottom-3 left-[9px] top-3 w-px bg-border/70" />

                <div className="relative flex gap-4">
                  <div className="relative z-10 mt-1 h-2 w-2 rounded-full bg-success ring-4 ring-background" />
                  <div className="flex-1 pb-2">
                    <div className="text-xs text-foreground-subtle">
                      {formatAbsoluteTimestamp(incident.updated_at)}
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-foreground">Last updated</div>
                    <div className="text-xs text-foreground-muted">
                      {formatTimestamp(incident.updated_at)}
                    </div>
                  </div>
                </div>

                <div className="relative flex gap-4">
                  <div className="relative z-10 mt-1 h-2 w-2 rounded-full bg-primary ring-4 ring-background" />
                  <div className="flex-1">
                    <div className="text-xs text-foreground-subtle">
                      {formatAbsoluteTimestamp(incident.created_at)}
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-foreground">Incident detected</div>
                    <div className="text-xs text-foreground-muted">
                      {formatTimestamp(incident.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Related Events */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Activity className="h-4 w-4 text-primary" />
                  Related Events
                </h2>
                <span className="text-xs text-foreground-subtle">{eventsData?.total ?? 0}</span>
              </div>
              {eventsLoading ? (
                <EventListSkeleton />
              ) : eventsData?.events && eventsData.events.length > 0 ? (
                <div className="border-t border-border/60">
                  <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
                    <div className="col-span-2">Severity / Time</div>
                    <div className="col-span-5">Event</div>
                    <div className="col-span-3">Scope</div>
                    <div className="col-span-2">Linked</div>
                  </div>
                  <div className="divide-y divide-border/60">
                    {eventsData.events.slice(0, 10).map((event) => (
                      <EventRow key={event.event_id} event={event} />
                    ))}
                  </div>
                  {eventsData.events.length > 10 && (
                    <div className="px-2 py-3 text-center text-xs text-foreground-subtle">
                      +{eventsData.events.length - 10} more events.{" "}
                      <Link
                        href={`/events?incident_id=${incidentId}`}
                        className="font-medium text-primary hover:text-primary-hover"
                      >
                        View all
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <div className="border-t border-border/60 py-8 text-sm text-foreground-muted">
                  No events found for this incident
                </div>
              )}
            </section>
          </div>

          {/* Sidebar */}
          <div className="space-y-10">
            {/* Impact Summary */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground">Impact Summary</h2>
              <div className="grid grid-cols-2 gap-4">
                <ImpactStat icon={<Activity className="h-4 w-4" />} label="Events" value={incident.event_count} />
                <ImpactStat icon={<Wifi className="h-4 w-4" />} label="Sites" value={incident.affected_sites_count} />
                <ImpactStat icon={<Server className="h-4 w-4" />} label="Devices" value={incident.affected_devices_count} />
                {incident.affected_clients.length > 0 && (
                  <ImpactStat icon={<Users className="h-4 w-4" />} label="Clients" value={incident.affected_clients.length} />
                )}
              </div>
            </section>

            {/* Affected Infrastructure */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground">Affected Infrastructure</h2>

              {incident.affected_sites.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                    Sites
                  </div>
                  <div className="space-y-1.5 border-l border-border/70 pl-3">
                    {incident.affected_sites.map((site) => (
                      <div key={site} className="font-mono text-sm text-foreground-muted">
                        {site}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {incident.affected_devices.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                    Devices
                  </div>
                  <div className="space-y-1.5 border-l border-border/70 pl-3">
                    {incident.affected_devices.slice(0, 5).map((device) => (
                      <div key={device} className="font-mono text-sm text-foreground-muted">
                        {device}
                      </div>
                    ))}
                    {incident.affected_devices.length > 5 && (
                      <div className="text-xs text-foreground-subtle">
                        +{incident.affected_devices.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function IncidentDetailSkeleton() {
  return (
    <div className="container mx-auto px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-10">
        <Skeleton className="h-4 w-32" />
        <div className="flex flex-col gap-6 border-b border-border/60 pb-8 lg:flex-row lg:justify-between">
          <div className="space-y-3">
            <div className="flex gap-3">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
            <Skeleton className="h-9 w-96" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-20 w-36" />
        </div>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          <div className="space-y-10 lg:col-span-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-10">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
