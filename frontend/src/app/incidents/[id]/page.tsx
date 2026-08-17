"use client";

import { useMemo, useCallback } from "react";
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
  MapPin,
  Shield,
  HelpCircle,
  AlertTriangle,
  Network,
  Layers,
} from "lucide-react";

import Link from "next/link";
import { api } from "@/lib/api";
import { SeverityBadge } from "@/components/incidents/severity-badge";
import { StatusBadge } from "@/components/incidents/status-badge";
import { EventRow } from "@/components/events/event-row";
import { EventListSkeleton } from "@/components/events/event-list-skeleton";
import { CorrelationReasoning } from "@/components/incidents/correlation-reasoning";
import { AIRcaCard } from "@/components/incidents/ai-rca-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatTimestamp,
  formatAbsoluteTimestamp,
  formatConfidence,
} from "@/lib/utils";

const SEVERITY_SEVERITY_DESC: Record<string, { label: string; action: string }> = {
  critical: { label: "Outage", action: "Immediate escalation required — users are actively impacted." },
  major: { label: "Degraded", action: "Investigate promptly — performance or functionality impaired." },
  minor: { label: "Attention", action: "Monitor — anomaly detected but not yet impacting users." },
};

function buildImpactNarrative(incident: {
  affected_sites: string[];
  affected_devices: string[];
  affected_clients: string[];
  affected_sites_count: number;
  affected_devices_count: number;
  severity: string;
  title: string;
}): { headline: string; details: string[]; severity: "low" | "medium" | "high" | "critical" } {
  const siteCount = incident.affected_sites?.length ?? incident.affected_sites_count;
  const deviceCount = incident.affected_devices?.length ?? incident.affected_devices_count;
  const clientCount = incident.affected_clients?.length ?? 0;

  const details: string[] = [];

  if (siteCount === 0 && deviceCount === 0) {
    return {
      headline: "Impact assessment pending — insufficient telemetry to determine blast radius.",
      details: [],
      severity: "low",
    };
  }

  let headline: string;
  let narrativeSeverity: "low" | "medium" | "high" | "critical";

  if (siteCount === 1 && deviceCount <= 3) {
    headline = `Localized incident at ${incident.affected_sites?.[0] ?? "site"}`;
    details.push(`${deviceCount} device${deviceCount > 1 ? "s" : ""} affected — likely a single access switch, AP, or uplink failure.`);
    narrativeSeverity = deviceCount === 1 ? "low" : "medium";
  } else if (siteCount === 1 && deviceCount <= 10) {
    headline = `Site-level impact at ${incident.affected_sites?.[0] ?? "site"}`;
    details.push(`${deviceCount} devices affected across the site — possible distribution switch or upstream issue.`);
    narrativeSeverity = "high";
  } else if (siteCount === 1 && deviceCount > 10) {
    headline = `Major site degradation at ${incident.affected_sites?.[0] ?? "site"}`;
    details.push(`${deviceCount} devices affected — widespread impact suggests a core switch, WAN link, or power issue.`);
    narrativeSeverity = "critical";
  } else if (siteCount <= 3) {
    headline = `Multi-site impact across ${siteCount} sites`;
    details.push(`${deviceCount} devices affected across ${siteCount} locations — possible regional WAN, cloud, or backbone issue.`);
    narrativeSeverity = "critical";
  } else {
    headline = `Widespread impact across ${siteCount} sites`;
    details.push(`${deviceCount} devices affected across ${siteCount} sites — investigate core infrastructure, SD-WAN fabric, or upstream provider.`);
    narrativeSeverity = "critical";
  }

  if (clientCount > 0) {
    details.push(`${clientCount} client${clientCount > 1 ? "s" : ""} directly experiencing connectivity issues.`);
  }

  if (deviceCount === 0 && siteCount > 0) {
    headline = `Infrastructure event at ${siteCount} site${siteCount > 1 ? "s" : ""}`;
    details.push("No specific device data — review raw telemetry for details.");
    narrativeSeverity = "medium";
  }

  return { headline, details, severity: narrativeSeverity };
}

export default function IncidentDetailPage() {
  const params = useParams();
  const router = useRouter();
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

  const impact = useMemo(() => incident ? buildImpactNarrative(incident) : null, [incident]);
  const severityInfo = incident ? SEVERITY_SEVERITY_DESC[incident.severity] ?? null : null;

  const onViewInTopology = useCallback(() => {
    if (incident?.topology_node_ids && incident.topology_node_ids.length > 0) {
      const ids = incident.topology_node_ids.join(",");
      router.push(`/topology?highlight=${encodeURIComponent(ids)}&incident=${encodeURIComponent(incidentId)}`);
    }
  }, [incident, router]);

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
              href="/correlation"
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
          href="/correlation"
          className="inline-flex items-center gap-2 text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to incidents
        </Link>

        {/* Assessment Header */}
        <div className="border-b border-border/40 pb-6 sm:pb-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={incident.severity} showDot className="text-xs" />
                <StatusBadge status={incident.status} />
                {incident.symptom_device_ids.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber">
                    <Layers className="h-3 w-3" />
                    Cascade
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {incident.title}
              </h1>

              {/* Impact narrative */}
              {impact && (
                <div className="space-y-2">
                  <p className="text-base font-medium text-foreground">{impact.headline}</p>
                  {impact.details.map((d, i) => (
                    <p key={i} className="text-sm text-foreground-muted">{d}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-row gap-6 lg:flex-col lg:items-end">
              {/* Confidence */}
              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                  Confidence
                </div>
                <div className="mt-1 text-3xl font-semibold text-foreground">
                  {formatConfidence(incident.confidence_score)}
                </div>
              </div>
              {/* Incident ID */}
              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                  Incident ID
                </div>
                <div className="mt-1 font-mono text-xs text-foreground-subtle">{incident.incident_id}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action callout */}
        {severityInfo && incident.severity !== "info" && (
          <div className="flex items-start gap-3 border-l-2 border-l-primary pl-3 py-2">
            {incident.severity === "critical" ? (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-critical" />
            ) : incident.severity === "major" ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-major" />
            ) : (
              <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-minor" />
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">{severityInfo.label}</p>
              <p className="text-sm text-foreground-muted">{severityInfo.action}</p>
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-10 lg:col-span-2">
            {/* Probable Cause */}
            {incident.probable_cause && (
              <section className="space-y-3 border-t border-border/40 pt-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Probable Cause
                </h2>
                <p className="max-w-3xl leading-relaxed text-foreground-muted">
                  {incident.probable_cause}
                </p>
              </section>
            )}

            {/* Correlation Reasoning */}
            <CorrelationReasoning incident={incident} />

            {/* Timeline */}
            <section className="space-y-4 border-t border-border/40 pt-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Timeline
              </h2>
              <div className="relative space-y-6 pl-4">
                <div className="absolute bottom-3 left-[5px] top-3 w-px bg-border/70" />

                <div className="relative flex gap-4">
                  <div className="relative z-10 mt-1 h-1.5 w-1.5 bg-success" />
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
                  <div className="relative z-10 mt-1 h-1.5 w-1.5 bg-primary" />
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

            {/* AI Root Cause Analysis */}
            <AIRcaCard incidentId={incidentId} />

            {/* Related Events */}
            <section className="space-y-4 border-t border-border/40 pt-5">
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
          <div className="space-y-8">
            {/* Blast Radius */}
            <section className="border-t border-border/40 pt-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Shield className="h-4 w-4 text-primary" />
                Blast Radius
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <ImpactStat icon={<MapPin className="h-4 w-4" />} label="Sites" value={incident.affected_sites_count} />
                <ImpactStat icon={<Server className="h-4 w-4" />} label="Devices" value={incident.affected_devices_count} />
                <ImpactStat icon={<Activity className="h-4 w-4" />} label="Events" value={incident.event_count} />
                {incident.affected_clients.length > 0 && (
                  <ImpactStat icon={<Users className="h-4 w-4" />} label="Clients" value={incident.affected_clients.length} />
                )}
              </div>
              {incident.topology_node_ids && incident.topology_node_ids.length > 0 && (
                <button
                  onClick={onViewInTopology}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Network className="h-4 w-4" />
                  View in Topology
                </button>
              )}
            </section>

            {/* Affected Sites */}
            {incident.affected_sites.length > 0 && (
              <section className="border-t border-border/40 pt-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  Affected Sites
                </h2>
                <div className="mt-3 space-y-1.5 border-l border-border/70 pl-3">
                  {incident.affected_sites.map((site) => (
                    <div key={site} className="font-mono text-sm text-foreground-muted">
                      {site}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Affected Devices */}
            {incident.affected_devices.length > 0 && (
              <section className="border-t border-border/40 pt-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Server className="h-4 w-4 text-primary" />
                  Affected Devices
                </h2>
                <div className="mt-3 space-y-1.5">
                  {incident.affected_devices.slice(0, 8).map((device) => (
                    <div key={device} className="font-mono text-xs text-foreground-muted">
                      {device}
                    </div>
                  ))}
                  {incident.affected_devices.length > 8 && (
                    <div className="text-xs text-foreground-subtle">
                      +{incident.affected_devices.length - 8} more
                    </div>
                  )}
                </div>
              </section>
            )}
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
        <div className="border-b border-border/40 pb-6 sm:pb-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:justify-between">
            <div className="space-y-3">
              <div className="flex gap-3">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
              <Skeleton className="h-9 w-96" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="space-y-4 text-right">
              <Skeleton className="h-12 w-24 ml-auto" />
              <Skeleton className="h-4 w-32 ml-auto" />
            </div>
          </div>
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
