"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Brain,
  Clock,
  MapPin,
  Search,
  Server,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { buildStats } from "@/lib/incident-stats";
import { groupByRootCause } from "@/lib/alerts";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/incidents/severity-badge";
import { StatusBadge } from "@/components/incidents/status-badge";
import { formatConfidence, formatElapsed } from "@/lib/utils";
import type { IncidentSeverity, IncidentSummary } from "@/types/incident";

const severityOrder: Record<IncidentSeverity, number> = { critical: 4, major: 3, minor: 2, info: 1 };

function KpiCell({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div>
      <div className={`text-3xl font-semibold ${tone ?? "text-foreground"}`}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">
        {label}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["correlation-incidents"],
    queryFn: () => api.listIncidents({ limit: 500 }),
    refetchInterval: 15000,
  });

  const { data: kpiData } = useQuery({
    queryKey: ["incident-stats"],
    queryFn: () => api.getIncidentStats(),
    refetchInterval: 30000,
  });

  const { data: engineStats } = useQuery({
    queryKey: ["correlation-stats"],
    queryFn: () => api.getCorrelationStats(),
    refetchInterval: 30000,
  });

  const engineHealth = engineStats as { status?: string; stats?: Record<string, unknown> } | undefined;

  const incidents = data?.incidents ?? [];
  const totalIncidents = data?.total ?? incidents.length;

  // Truthful KPIs — SQL aggregates from GET /incidents/stats; the list page
  // (limit 500) never becomes the headline number.
  const stats = useMemo(
    () => buildStats(kpiData, incidents, totalIncidents),
    [kpiData, incidents, totalIncidents]
  );

  const filteredIncidents = useMemo(() => {
    const term = search.toLowerCase();
    return incidents
      .filter((inc) => {
        if (severityFilter !== "all" && inc.severity !== severityFilter) return false;
        if (!term) return true;
        return (
          inc.title.toLowerCase().includes(term) ||
          inc.incident_id.toLowerCase().includes(term) ||
          (inc.site_name ?? "").toLowerCase().includes(term) ||
          (inc.root_device ?? "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity] || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [incidents, severityFilter, search]);

  const groups = useMemo(() => groupByRootCause(filteredIncidents), [filteredIncidents]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-10">

        {/* Header */}
        <div className="border-b border-border/60 pb-8">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-3 w-3" />
            Naxis Intelligence
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Alerts</h1>
          <p className="mt-1 text-sm text-foreground-muted max-w-2xl">
            Active outages and degraded service across all sites, grouped by root cause with
            confidence scores and blast radius.
          </p>

          {/* KPIs */}
          <div className="mt-8 flex flex-wrap gap-8">
            <KpiCell value={stats.active} label="Active outages" tone="text-critical" />
            <KpiCell value={stats.distinctSites} label="Sites affected" />
            <KpiCell value={stats.distinctDevices} label="Devices affected" />
            <KpiCell value={`${(stats.avgConfidence * 100).toFixed(0)}%`} label="Avg confidence" />
          </div>
        </div>

        {/* Engine telemetry — footnote, not a feature */}
        {engineHealth && (
          <p className="text-xs text-foreground-subtle flex items-center gap-1.5">
            <Brain className="h-3 w-3" />
            Correlation engine {engineHealth.status ?? "unknown"}
            {engineHealth.stats && (
              <>
                <span>·</span>
                <span>{engineHealth.stats.lastCycleIncidents as number ?? 0} incidents</span>
                <span>·</span>
                <span>{(engineHealth.stats.lastCycleEvents as number ?? 0).toLocaleString()} events</span>
                {engineHealth.stats.lastDurationMs != null && (
                  <>
                    <span>·</span>
                    <span>{(engineHealth.stats.lastDurationMs as number).toFixed(0)}ms</span>
                  </>
                )}
              </>
            )}
          </p>
        )}

        {/* Empty state — no incidents yet */}
        {!isLoading && incidents.length === 0 && (
          <div className="space-y-6">
            <div className="flex items-start gap-4 rounded-xl border border-primary/20 bg-primary/5 p-6">
              <Brain className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">No alerts yet</p>
                <p className="mt-1 text-sm text-foreground-muted">
                  The correlation engine is waiting for telemetry. When Mist, VeloCloud SD-WAN, DNAC,
                  or Arista WLC events arrive, they will be automatically correlated into alerts
                  grouped by root cause with confidence scores and blast radius.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              {[
                { icon: <Activity className="h-5 w-5 text-violet-400" />, title: "Site grouping", desc: "Events at the same site within 5 minutes become one incident" },
                { icon: <Shield className="h-5 w-5 text-emerald-400" />, title: "Confidence scoring", desc: "Each incident scored by event count, severity distribution, and device diversity" },
                { icon: <Clock className="h-5 w-5 text-amber-400" />, title: "Root-cause dedup", desc: "Incidents are grouped by root cause — one alert per root device, not one per symptom" },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3 rounded-lg border border-border/40 p-4">
                  {icon}
                  <div>
                    <p className="font-medium text-foreground">{title}</p>
                    <p className="text-foreground-muted mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alert list */}
        {(isLoading || incidents.length > 0) && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
                <input
                  type="text"
                  placeholder="Search alerts, sites, devices..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30"
                />
              </div>
              <div className="flex items-center gap-2">
                {(["all", "critical", "major", "minor"] as const).map((s) => {
                  const filterLabels: Record<string, string> = { critical: "Outage", major: "Degraded", minor: "Attention", all: "All" };
                  return (
                    <button
                      key={s}
                      onClick={() => setSeverityFilter(s)}
                      className={`px-2.5 py-1 rounded text-sm font-medium transition-colors ${
                        severityFilter === s
                          ? s === "all"
                            ? "bg-surface text-foreground"
                            : "bg-critical/10 text-critical border border-critical/30"
                          : "text-foreground-muted hover:text-foreground"
                      }`}
                    >
                      {filterLabels[s]}
                    </button>
                  );
                })}
                {(search || severityFilter !== "all") && (
                  <button onClick={() => { setSearch(""); setSeverityFilter("all"); }} className="ml-1 inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="divide-y divide-border/60 border-t border-border/60">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 items-center gap-4 px-2 py-4">
                    <div className="col-span-5 space-y-2">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <div className="col-span-4 flex gap-4">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="col-span-2">
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="col-span-1 text-right">
                      <Skeleton className="h-4 w-12 ml-auto" />
                    </div>
                  </div>
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
                <Shield className="h-6 w-6 text-foreground-subtle" />
                <div>
                  <p className="font-semibold text-foreground">No matching alerts</p>
                  <p className="mt-1 text-sm text-foreground-muted">Try clearing filters or broadening your search.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {groups.map((group) => (
                  <section key={group.key} className="border-t border-border/60 pt-5">
                    {/* Root cause header */}
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{group.rootDevice}</h2>
                      <span className="flex items-center gap-1 text-xs text-foreground-muted">
                        <MapPin className="h-3 w-3" />
                        {group.siteName}
                      </span>
                      {group.incidents.length > 1 && (
                        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] text-foreground-subtle">
                          {group.incidents.length} issues
                        </span>
                      )}
                    </div>

                    <div className="divide-y divide-border/60 rounded-lg border border-border/40">
                      {group.incidents.map((incident) => (
                        <AlertRow key={incident.incident_id} incident={incident} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {filteredIncidents.length > 0 && (
              <p className="text-xs text-foreground-subtle text-center pt-2">
                Showing {filteredIncidents.length} of {totalIncidents} alerts
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function AlertRow({ incident }: { incident: IncidentSummary }) {
  const isActive = ["open", "investigating", "mitigated"].includes(incident.status);

  return (
    <a
      href={`/incidents/${incident.incident_id}`}
      className="group grid grid-cols-12 items-center gap-4 px-4 py-3 transition-colors hover:bg-surface"
    >
      <div className="col-span-12 lg:col-span-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} label={incident.severity_label} showDot={false} />
          <StatusBadge status={incident.status} />
        </div>
        <h3 className="mt-1 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
          {incident.title}
        </h3>
      </div>

      <div className="col-span-12 flex items-center gap-5 pl-0 text-sm lg:col-span-4">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-foreground-subtle" />
          <span className="text-foreground-muted">
            {isActive ? `ongoing for ${formatElapsed(incident.created_at)}` : `resolved ${formatElapsed(incident.updated_at)} ago`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5 text-foreground-subtle" />
          <span className="text-foreground-muted">{incident.affected_devices_count} devices</span>
        </div>
      </div>

      <div className="col-span-6 pl-0 text-sm lg:col-span-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Confidence</div>
        <div className="mt-0.5 font-semibold text-foreground">
          {formatConfidence(incident.confidence_score)}
        </div>
      </div>

      <div className="col-span-6 text-right text-xs text-foreground-subtle lg:col-span-1">
        {incident.event_count} events
      </div>
    </a>
  );
}
