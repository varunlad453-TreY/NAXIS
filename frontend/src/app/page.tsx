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
    queryFn: () =>
      activeOnly ? api.listActiveIncidents() : api.listIncidents(),
    refetchInterval: 10000, // Refresh every 10s
  });

  const incidents = data?.incidents ?? [];

  const summary = useMemo(() => {
    const activeIncidents = incidents.filter((incident) =>
      ACTIVE_STATUSES.includes(incident.status)
    );

    const totalEvents = activeIncidents.reduce(
      (sum, incident) => sum + incident.event_count,
      0
    );
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
        ? activeIncidents.reduce(
            (sum, incident) => sum + incident.confidence_score,
            0
          ) / activeIncidents.length
        : 0;

    const focusIncident = [...activeIncidents].sort((left, right) => {
      const severityDelta =
        getSeverityOrder(left.severity) - getSeverityOrder(right.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      if (right.confidence_score !== left.confidence_score) {
        return right.confidence_score - left.confidence_score;
      }

      return (
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
      );
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
    const base = activeOnly
      ? summary.activeIncidents
      : incidents;

    if (!searchTerm) {
      return [...base].sort((left, right) => {
        const severityDelta =
          getSeverityOrder(left.severity) - getSeverityOrder(right.severity);
        if (severityDelta !== 0) {
          return severityDelta;
        }

        return (
          new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
        );
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
        if (severityDelta !== 0) {
          return severityDelta;
        }

        return (
          new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
        );
      });
  }, [activeOnly, incidents, searchTerm, summary.activeIncidents]);

  const displayedCount = displayedIncidents.length;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] shadow-[0_30px_80px_-55px_rgba(0,0,0,0.85)] backdrop-blur-xl">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.25fr_0.95fr] lg:p-8">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Live operational command
              </div>

              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  A smoother, sharper view of network operations.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-foreground-muted sm:text-lg">
                  Naxis keeps incidents, telemetry, and infrastructure context in one
                  calm control surface so the team can move faster with less noise.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  icon={<Shield className="h-4 w-4" />}
                  label="Active incidents"
                  value={formatCount(summary.activeIncidents.length)}
                  tone="text-primary"
                  detail={summary.criticalCount > 0 ? `${summary.criticalCount} critical` : "No critical incidents"}
                />
                <MetricCard
                  icon={<Activity className="h-4 w-4" />}
                  label="Events in scope"
                  value={formatCount(summary.totalEvents)}
                  tone="text-cyan-300"
                  detail="Correlated and live"
                />
                <MetricCard
                  icon={<Server className="h-4 w-4" />}
                  label="Devices impacted"
                  value={formatCount(summary.totalDevices)}
                  tone="text-amber-300"
                  detail="Across active incidents"
                />
                <MetricCard
                  icon={<Users className="h-4 w-4" />}
                  label="Clients affected"
                  value={formatCount(summary.totalClients)}
                  tone="text-emerald-300"
                  detail="Estimated from live impact"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="#incident-queue"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-background transition-transform hover:-translate-y-0.5 hover:bg-primary-hover"
                >
                  Review incident queue
                  <ArrowRight className="h-4 w-4" />
                </a>
                <Link
                  href="/devices"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-medium text-foreground transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                >
                  Open device inventory
                </Link>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_50px_-35px_rgba(0,0,0,0.75)]">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-foreground-subtle">
                      Priority spotlight
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-foreground">
                      {summary.focusIncident?.title ?? "No active incident"}
                    </h2>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-foreground-muted">
                    {summary.focusIncident ? summary.focusIncident.severity.toUpperCase() : "CLEAR"}
                  </div>
                </div>

                {summary.focusIncident ? (
                  <>
                    <p className="text-sm leading-6 text-foreground-muted">
                      {summary.focusIncident.incident_id} • {summary.focusIncident.event_count} events • {summary.focusIncident.affected_sites_count} sites • {summary.focusIncident.affected_devices_count} devices
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <SpotlightStat label="Confidence" value={formatConfidence(summary.focusIncident.confidence_score)} />
                      <SpotlightStat label="Updated" value={formatRelative(summary.focusIncident.updated_at)} />
                      <SpotlightStat label="Opened" value={formatRelative(summary.focusIncident.created_at)} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-foreground-muted">
                    All systems are quiet right now. Recent activity will appear here when an incident is detected.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <MiniPulseCard
                  label="System status"
                  value="Stable"
                  detail="Platform ingestion is healthy"
                  icon={<Shield className="h-4 w-4" />}
                />
                <MiniPulseCard
                  label="Average confidence"
                  value={formatConfidence(summary.averageConfidence)}
                  detail="Across active incidents"
                  icon={<Clock3 className="h-4 w-4" />}
                />
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-foreground-subtle">
                      Incident freshness
                    </div>
                    <div className="mt-2 text-sm text-foreground-muted">
                      Latest update {summary.latestIncident ? formatRelative(summary.latestIncident.updated_at) : "unavailable"}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-foreground-muted">
                    {formatCount(summary.totalSites)} sites in scope
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {Object.entries(summary.severityCounts).map(([severity, count]) => {
                    const total = Math.max(incidents.length, 1);
                    const width = `${Math.max((count / total) * 100, count > 0 ? 10 : 0)}%`;
                    return (
                      <div key={severity}>
                        <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-foreground-subtle">
                          <span>{severity}</span>
                          <span>{count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/5">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-primary via-cyan-300 to-primary"
                            style={{ width }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-4" id="incident-queue">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-foreground-subtle">
                    Incident queue
                  </div>
                  <h2 className="mt-1 text-xl font-semibold text-foreground">
                    {activeOnly ? "Active incidents" : "All incidents"}
                  </h2>
                </div>

                <div className="flex flex-col gap-3 lg:min-w-[26rem] lg:flex-row lg:items-center">
                  <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                    <button
                      onClick={() => setActiveOnly(true)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        activeOnly
                          ? "bg-white/10 text-foreground"
                          : "text-foreground-muted hover:text-foreground"
                      }`}
                    >
                      Active
                    </button>
                    <button
                      onClick={() => setActiveOnly(false)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        !activeOnly
                          ? "bg-white/10 text-foreground"
                          : "text-foreground-muted hover:text-foreground"
                      }`}
                    >
                      All
                    </button>
                  </div>

                  <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
                    <Search className="h-4 w-4 text-foreground-subtle" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search incidents"
                      className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-[1.5rem] border border-critical-border bg-critical-bg/70 p-4 backdrop-blur-xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-critical" />
                  <div>
                    <h3 className="mb-1 text-sm font-medium text-critical">
                      Failed to load incidents
                    </h3>
                    <p className="text-sm text-foreground-muted">
                      {error instanceof Error ? error.message : "Unknown error"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isLoading ? (
              <IncidentListSkeleton count={5} />
            ) : displayedIncidents.length > 0 ? (
              <div className="space-y-3">
                {displayedIncidents.map((incident) => (
                  <IncidentCard key={incident.incident_id} incident={incident} />
                ))}
              </div>
            ) : (
              <EmptyState variant={activeOnly ? "no-active" : "no-incidents"} />
            )}

            {!isLoading && displayedIncidents.length > 0 && (
              <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-sm text-foreground-subtle backdrop-blur-xl">
                Showing {displayedCount} of {data?.total ?? 0} incidents
              </div>
            )}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <aside className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <Layers3 className="h-4 w-4 text-primary" />
                Operational pulse
              </div>

              <div className="space-y-4">
                <PulseRow label="Active incidents" value={formatCount(summary.activeIncidents.length)} />
                <PulseRow label="Sites impacted" value={formatCount(summary.totalSites)} />
                <PulseRow label="Devices impacted" value={formatCount(summary.totalDevices)} />
                <PulseRow label="Total events" value={formatCount(summary.totalEvents)} />
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-foreground-subtle">
                      Current pace
                    </div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      Fast and stable
                    </div>
                  </div>
                  <div className="rounded-full border border-success/20 bg-success/10 px-3 py-1.5 text-xs text-success">
                    Healthy
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <ProgressBar label="Confidence" value={summary.averageConfidence} />
                  <ProgressBar label="Impact coverage" value={Math.min(summary.totalSites / Math.max(summary.activeIncidents.length || 1, 1) / 10, 1)} />
                </div>
              </div>
            </aside>

            <aside className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <Clock3 className="h-4 w-4 text-primary" />
                Recent activity
              </div>

              <div className="space-y-3">
                {[...incidents]
                  .sort(
                    (left, right) =>
                      new Date(right.updated_at).getTime() -
                      new Date(left.updated_at).getTime()
                  )
                  .slice(0, 3)
                  .map((incident) => (
                    <Link
                      key={incident.incident_id}
                      href={`/incidents/${incident.incident_id}`}
                      className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {incident.title}
                          </div>
                          <div className="mt-1 text-xs text-foreground-subtle">
                            {incident.incident_id}
                          </div>
                        </div>
                        <div className="text-xs text-foreground-subtle">
                          {formatRelative(incident.updated_at)}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-foreground-muted">
                        <span>{incident.severity.toUpperCase()}</span>
                        <span>{formatConfidence(incident.confidence_score)}</span>
                      </div>
                    </Link>
                  ))}
              </div>

              <div className="mt-4">
                <Link
                  href="/events"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
                >
                  Open event stream
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </aside>
          </aside>
        </section>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
}

function MetricCard({ icon, label, value, detail, tone }: MetricCardProps) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] ${tone}`}>
        {icon}
      </div>
      <div className="text-xs uppercase tracking-[0.2em] text-foreground-subtle">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-1 text-sm text-foreground-muted">{detail}</div>
    </div>
  );
}

interface SpotlightStatProps {
  label: string;
  value: string;
}

function SpotlightStat({ label, value }: SpotlightStatProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-foreground-subtle">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

interface MiniPulseCardProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}

function MiniPulseCard({ label, value, detail, icon }: MiniPulseCardProps) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-foreground-muted">
        <span>{label}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-primary">
          {icon}
        </div>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-1 text-sm text-foreground-muted">{detail}</div>
    </div>
  );
}

interface PulseRowProps {
  label: string;
  value: string;
}

function PulseRow({ label, value }: PulseRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3">
      <span className="text-sm text-foreground-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

interface ProgressBarProps {
  label: string;
  value: number;
}

function ProgressBar({ label, value }: ProgressBarProps) {
  const normalizedValue = Math.min(Math.max(value, 0), 1) * 100;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-foreground-subtle">
        <span>{label}</span>
        <span>{Math.round(normalizedValue)}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/5">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-primary via-cyan-300 to-primary transition-[width]"
          style={{ width: `${normalizedValue}%` }}
        />
      </div>
    </div>
  );
}
