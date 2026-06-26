"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
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
  const router = useRouter();
  const incidentId = params.id as string;

  const { data: incident, isLoading, error } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.getIncident(incidentId),
    retry: 1,
  });

  // Fetch events related to this incident
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
      <div className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-lg border border-critical-border bg-critical-bg p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-6 w-6 text-critical flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-medium text-critical mb-2">
                  Incident not found
                </h3>
                <p className="text-foreground-muted mb-4">
                  {error instanceof Error ? error.message : "Unknown error"}
                </p>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary-hover"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to incidents
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to incidents
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-semibold text-foreground mb-3">
                {incident.title}
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                <SeverityBadge severity={incident.severity} showDot />
                <StatusBadge status={incident.status} />
                <span className="text-sm text-foreground-subtle font-mono">
                  {incident.incident_id}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-foreground-subtle mb-1">Confidence</div>
              <div className="text-3xl font-semibold text-foreground">
                {formatConfidence(incident.confidence_score)}
              </div>
            </div>
          </div>
        </div>

        {/* Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Probable Cause */}
            {incident.probable_cause && (
              <div className="rounded-lg border border-border bg-background-elevated p-6">
                <h2 className="text-sm font-medium text-foreground-muted mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Probable Cause
                </h2>
                <p className="text-foreground leading-relaxed">
                  {incident.probable_cause}
                </p>
              </div>
            )}

            {/* Timeline */}
            <div className="rounded-lg border border-border bg-background-elevated p-6">
              <h2 className="text-sm font-medium text-foreground-muted mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Timeline
              </h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-success" />
                    <div className="w-px h-full bg-border mt-2" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="text-sm text-foreground-muted mb-1">
                      {formatAbsoluteTimestamp(incident.updated_at)}
                    </div>
                    <div className="text-sm text-foreground">
                      Last updated
                    </div>
                    <div className="text-xs text-foreground-subtle mt-1">
                      {formatTimestamp(incident.updated_at)}
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-foreground-muted mb-1">
                      {formatAbsoluteTimestamp(incident.created_at)}
                    </div>
                    <div className="text-sm text-foreground">
                      Incident detected
                    </div>
                    <div className="text-xs text-foreground-subtle mt-1">
                      {formatTimestamp(incident.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Related Events */}
            <div className="rounded-lg border border-border bg-background-elevated p-6">
              <h2 className="text-sm font-medium text-foreground-muted mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Related Events ({eventsData?.total ?? 0})
              </h2>
              {eventsLoading ? (
                <EventListSkeleton />
              ) : eventsData?.events && eventsData.events.length > 0 ? (
                <div className="border border-border rounded-lg divide-y">
                  {eventsData.events.slice(0, 10).map((event) => (
                    <EventRow key={event.event_id} event={event} />
                  ))}
                  {eventsData.events.length > 10 && (
                    <div className="text-xs text-foreground-subtle text-center py-3">
                      +{eventsData.events.length - 10} more events. <Link href={`/events?incident_id=${incidentId}`} className="text-primary hover:text-primary-hover">View all</Link>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-foreground-muted py-4 text-center">
                  No events found for this incident
                </div>
              )}
            </div>
          </div>

          {/* Sidebar - 1 column */}
          <div className="space-y-6">
            {/* Impact Summary */}
            <div className="rounded-lg border border-border bg-background-elevated p-6">
              <h2 className="text-sm font-medium text-foreground-muted mb-4">
                Impact Summary
              </h2>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <Activity className="h-4 w-4" />
                    <span className="text-sm">Events</span>
                  </div>
                  <div className="text-2xl font-semibold text-foreground">
                    {incident.event_count}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <Wifi className="h-4 w-4" />
                    <span className="text-sm">Sites</span>
                  </div>
                  <div className="text-2xl font-semibold text-foreground">
                    {incident.affected_sites_count}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <Server className="h-4 w-4" />
                    <span className="text-sm">Devices</span>
                  </div>
                  <div className="text-2xl font-semibold text-foreground">
                    {incident.affected_devices_count}
                  </div>
                </div>

                {incident.affected_clients.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 text-foreground-muted mb-2">
                      <Users className="h-4 w-4" />
                      <span className="text-sm">Clients</span>
                    </div>
                    <div className="text-2xl font-semibold text-foreground">
                      {incident.affected_clients.length}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Affected Infrastructure */}
            <div className="rounded-lg border border-border bg-background-elevated p-6">
              <h2 className="text-sm font-medium text-foreground-muted mb-4">
                Affected Infrastructure
              </h2>

              {incident.affected_sites.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs text-foreground-subtle mb-2">Sites</div>
                  <div className="space-y-1">
                    {incident.affected_sites.map((site) => (
                      <div
                        key={site}
                        className="text-sm font-mono text-foreground-muted px-2 py-1 rounded bg-background/50"
                      >
                        {site}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {incident.affected_devices.length > 0 && (
                <div>
                  <div className="text-xs text-foreground-subtle mb-2">Devices</div>
                  <div className="space-y-1">
                    {incident.affected_devices.slice(0, 5).map((device) => (
                      <div
                        key={device}
                        className="text-sm font-mono text-foreground-muted px-2 py-1 rounded bg-background/50"
                      >
                        {device}
                      </div>
                    ))}
                    {incident.affected_devices.length > 5 && (
                      <div className="text-xs text-foreground-subtle text-center pt-1">
                        +{incident.affected_devices.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncidentDetailSkeleton() {
  return (
    <div className="container mx-auto px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <Skeleton className="h-4 w-32 mb-6" />
        <div className="mb-8">
          <Skeleton className="h-9 w-96 mb-3" />
          <div className="flex gap-3">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
