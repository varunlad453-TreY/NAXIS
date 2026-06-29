"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Activity,
  Clock3,
  Layers3,
  Search,
  Server,
  Shield,
  Sparkles,
  Users,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { IncidentCard } from "@/components/incidents/incident-card";
import { IncidentListSkeleton } from "@/components/incidents/incident-skeleton";
import { EmptyState } from "@/components/incidents/empty-state";
import type { IncidentSummary, IncidentSeverity } from "@/types/incident";
import { formatConfidence, formatTimestamp, getSeverityOrder } from "@/lib/utils";

const ACTIVE_STATUSES: IncidentSummary["status"][] = ["open", "investigating", "mitigated"];

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatRelative(timestamp: string): string {
  try {
    return formatTimestamp(timestamp);
  } catch {
    return timestamp;
  }
}

export default function HomePage() {
  const [activeOnly, setActiveOnly] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents", activeOnly],
    queryFn: () => (activeOnly ? api.listActiveIncidents() : api.listIncidents()),
    refetchInterval: 10000,
  });

  const incidents = data?.incidents ?? [];

  const summary = useMemo(() => {
    const activeIncidents = incidents.filter((incident) =>
      ACTIVE_STATUSES.includes(incident.status)
    );

    const totalEvents = activeIncidents.reduce((sum, incident) => sum + incident.event_count, 0);
    const totalSites = activeIncidents.reduce(
      (sum, incident) => sum + incident.affected_sites_count,
      0
    );
    const totalDevices = activeIncidents.reduce(
      (sum, incident) => sum + incident.affected_devices_count,
      0
    );
    const totalClients = activeIncidents.reduce(
      (sum, incident) => sum + Math.max(incident.affected_devices_count * 2, 0),
      0
    );
    const criticalCount = activeIncidents.filter(
      (incident) => incident.severity === "critical"
    ).length;
    const averageConfidence =
      activeIncidents.length > 0
        ? activeIncidents.reduce((sum, incident) => sum + incident.confidence_score, 0) /
          activeIncidents.length
        : 0;

    const focusIncident = [...activeIncidents].sort((left, right) => {
      const severityDelta = getSeverityOrder(left.severity) - getSeverityOrder(right.severity);
      if (severityDelta !== 0) return severityDelta;
      if (right.confidence_score !== left.confidence_score) {
        return right.confidence_score - left.confidence_score;
      }
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    })[0] ?? incidents[0];

    const latestIncident = [...incidents].sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    )[0];

    const severityCounts = incidents.reduce(
      (accumulator, incident) => {
        accumulator[incident.severity] += 1;
        return accumulator;
      },
      { critical: 0, major: 0, minor: 0, info: 0 } satisfies Record<IncidentSeverity, number>
    );

    return {
      activeIncidents,
      totalEvents,
      totalSites,
      totalDevices,
      totalClients,
      criticalCount,
      averageConfidence,
      focusIncident,
      latestIncident,
      severityCounts,
    };
  }, [incidents]);

  const displayedIncidents = useMemo(() => {
    const base = activeOnly ? summary.activeIncidents : incidents;

    if (!searchTerm) {
      return [...base].sort((left, right) => {
        const severityDelta =
          getSeverityOrder(left.severity) - getSeverityOrder(right.severity);
        if (severityDelta !== 0) return severityDelta;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      });
    }

    const term = searchTerm.toLowerCase();
    return base
      .filter(
        (incident) =>
          incident.title.toLowerCase().includes(term) ||
          incident.incident_id.toLowerCase().includes(term) ||
          incident.severity.toLowerCase().includes(term)
      )
      .sort((left, right) => {
        const severityDelta =
          getSeverityOrder(left.severity) - getSeverityOrder(right.severity);
        if (severityDelta !== 0) return severityDelta;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      });
  }, [activeOnly, incidents, searchTerm, summary.activeIncidents]);

  const displayedCount = displayedIncidents.length;

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Hero */}
        <section className="border-b border-border/60 pb-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                <Sparkles className="h-3 w-3" />
                Live operational command
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Network operations, clearer and calmer.
              </h1>
              <p className="max-w-xl text-base leading-7 text-foreground-muted">
                Correlated incidents, telemetry, and infrastructure context in one calm control surface.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <a
                href="#incident-queue"
                className="group inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
              >
                Review incident queue
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <Link
                href="/devices"
                className="text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
              >
                Device inventory
              </Link>
            </div>
          </div>

          {/* KPI strip */}
          <div className="mt-10 flex flex-wrap items-end gap-8 lg:gap-12">
            <KpiStat
              value={formatCount(summary.activeIncidents.length)}
              label="Active incidents"
              hint={summary.criticalCount > 0 ? `${summary.criticalCount} critical` : "No critical"}
              tone="text-primary"
            />
            <KpiStat
              value={formatCount(summary.totalEvents)}
              label="Events in scope"
              hint="Correlated live"
              tone="text-cyan-400"
            />
            <KpiStat
              value={formatCount(summary.totalDevices)}
              label="Devices impacted"
              hint="Across active"
              tone="text-amber-400"
            />
            <KpiStat
              value={formatCount(summary.totalClients)}
              label="Clients affected"
              hint="Estimated impact"
              tone="text-emerald-400"
            />
          </div>
        </section>

        {/* Main content */}
        <section className="mt-10 grid gap-10 xl:grid-cols-[1fr_320px]">
          {/* Incident queue */}
          <div className="space-y-6" id="incident-queue">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                  Incident queue
                </div>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                  {activeOnly ? "Active incidents" : "All incidents"}
                </h2>
              </div>

              <div className="flex items-center gap-5">
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={() => setActiveOnly(true)}
                    className={`relative px-2 py-1.5 text-sm font-medium transition-colors ${
                      activeOnly ? "text-foreground" : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    Active
                    {activeOnly && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
                  </button>
                  <button
                    onClick={() => setActiveOnly(false)}
                    className={`relative px-2 py-1.5 text-sm font-medium transition-colors ${
                      !activeOnly ? "text-foreground" : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    All
                    {!activeOnly && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
                  </button>
                </div>

                <div className="flex items-center gap-2 border-b border-border/70 bg-transparent px-1 py-1.5 transition-colors focus-within:border-primary/30">
                  <Search className="h-4 w-4 text-foreground-subtle" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search incidents"
                    className="w-full min-w-[8rem] bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 border-l-2 border-l-critical-border pl-4 py-2 text-critical">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-medium">Failed to load incidents</h3>
                  <p className="text-sm text-foreground-muted">
                    {error instanceof Error ? error.message : "Unknown error"}
                  </p>
                </div>
              </div>
            )}

            {isLoading ? (
              <IncidentListSkeleton count={5} />
            ) : displayedIncidents.length > 0 ? (
              <div className="border-t border-border/60">
                <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
                  <div className="col-span-5">Incident</div>
                  <div className="col-span-4">Impact</div>
                  <div className="col-span-2">Confidence</div>
                  <div className="col-span-1 text-right">When</div>
                </div>
                <div className="divide-y divide-border/60">
                  {displayedIncidents.map((incident) => (
                    <IncidentCard key={incident.incident_id} incident={incident} />
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState variant={activeOnly ? "no-active" : "no-incidents"} />
            )}

            {!isLoading && displayedIncidents.length > 0 && (
              <div className="text-sm text-foreground-subtle">
                Showing {displayedCount} of {data?.total ?? 0} incidents
              </div>
            )}
          </div>

          {/* Right sidebar - boxless */}
          <aside className="space-y-8 xl:sticky xl:top-24 xl:self-start">
            {/* Spotlight */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TrendingUp className="h-4 w-4 text-primary" />
                Priority spotlight
              </div>

              {summary.focusIncident ? (
                <div className="space-y-4 border-b border-border/60 pb-8">
                  <div className="flex items-start gap-3">
                    <SeverityDot severity={summary.focusIncident.severity} />
                    <div>
                      <div className="font-medium text-foreground">{summary.focusIncident.title}</div>
                      <div className="mt-0.5 font-mono text-xs text-foreground-subtle">
                        {summary.focusIncident.incident_id}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Confidence</div>
                      <div className="mt-0.5 font-semibold text-foreground">
                        {formatConfidence(summary.focusIncident.confidence_score)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Events</div>
                      <div className="mt-0.5 font-semibold text-foreground">
                        {formatCount(summary.focusIncident.event_count)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Devices</div>
                      <div className="mt-0.5 font-semibold text-foreground">
                        {formatCount(summary.focusIncident.affected_devices_count)}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-foreground-subtle">
                    Updated {formatRelative(summary.focusIncident.updated_at)}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 border-b border-border/60 pb-8">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground-subtle">
                    <Shield className="h-5 w-5" />
                  </div>
                  <p className="font-medium text-foreground">No active incident</p>
                  <p className="text-sm text-foreground-muted">
                    Recent activity will appear here when detected.
                  </p>
                </div>
              )}
            </div>

            {/* Operational pulse */}
            <div className="space-y-4 border-b border-border/60 pb-8">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Layers3 className="h-4 w-4 text-primary" />
                Operational pulse
              </div>

              <div className="space-y-2 text-sm">
                <PulseRow label="Active incidents" value={formatCount(summary.activeIncidents.length)} />
                <PulseRow label="Sites impacted" value={formatCount(summary.totalSites)} />
                <PulseRow label="Devices impacted" value={formatCount(summary.totalDevices)} />
                <PulseRow label="Total events" value={formatCount(summary.totalEvents)} />
              </div>

              <div className="space-y-4 pt-2">
                <ProgressBar label="Confidence" value={summary.averageConfidence} />
                <ProgressBar
                  label="Impact coverage"
                  value={Math.min(summary.totalSites / Math.max(summary.activeIncidents.length || 1, 1) / 10, 1)}
                />
              </div>
            </div>

            {/* Freshness */}
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                Incident freshness
              </div>
              <div className="text-sm text-foreground-muted">
                Latest update{" "}
                <span className="text-foreground">
                  {summary.latestIncident ? formatRelative(summary.latestIncident.updated_at) : "unavailable"}
                </span>
              </div>
              <div className="space-y-3">
                {Object.entries(summary.severityCounts).map(([severity, count]) => {
                  const total = Math.max(incidents.length, 1);
                  const width = `${Math.max((count / total) * 100, count > 0 ? 8 : 0)}%`;
                  return (
                    <div key={severity}>
                      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                        <span>{severity}</span>
                        <span>{count}</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-300 transition-[width] duration-700"
                          style={{ width }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent activity */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock3 className="h-4 w-4 text-primary" />
                Recent activity
              </div>

              <div className="space-y-1">
                {[...incidents]
                  .sort(
                    (left, right) =>
                      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
                  )
                  .slice(0, 4)
                  .map((incident) => (
                    <Link
                      key={incident.incident_id}
                      href={`/incidents/${incident.incident_id}`}
                      className="group flex items-start gap-3 rounded-lg py-2 transition-colors hover:bg-surface"
                    >
                      <SeverityDot severity={incident.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                          {incident.title}
                        </div>
                        <div className="mt-0.5 text-xs text-foreground-subtle">
                          {formatRelative(incident.updated_at)} • {formatConfidence(incident.confidence_score)}
                        </div>
                      </div>
                    </Link>
                  ))}
              </div>

              <Link
                href="/events"
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
              >
                Open event stream
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function KpiStat({
  value,
  label,
  hint,
  tone,
}: {
  value: string;
  label: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className="min-w-[7rem]">
      <div className={`text-3xl font-semibold tracking-tight sm:text-4xl ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
        {label}
      </div>
      <div className="mt-0.5 text-xs text-foreground-muted">{hint}</div>
    </div>
  );
}

function SeverityDot({ severity }: { severity: IncidentSeverity }) {
  return (
    <span
      className={`mt-1.5 h-2 w-2 rounded-full ${
        severity === "critical"
          ? "bg-critical"
          : severity === "major"
          ? "bg-major"
          : severity === "minor"
          ? "bg-minor"
          : "bg-info"
      }`}
    />
  );
}

function PulseRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-foreground-muted">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  const normalizedValue = Math.min(Math.max(value, 0), 1) * 100;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        <span>{label}</span>
        <span>{Math.round(normalizedValue)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-300 transition-[width] duration-700 ease-out"
          style={{ width: `${normalizedValue}%` }}
        />
      </div>
    </div>
  );
}
