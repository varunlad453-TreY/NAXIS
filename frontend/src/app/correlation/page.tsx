"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Brain,
  Clock,
  Info,
  Search,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { IncidentCard } from "@/components/incidents/incident-card";
import type { IncidentSeverity, IncidentSummary } from "@/types/incident";

const severityOrder: Record<IncidentSeverity, number> = { critical: 4, major: 3, minor: 2, info: 1 };

export default function CorrelationEnginePage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["correlation-incidents"],
    queryFn: () => api.listIncidents({ limit: 500 }),
    refetchInterval: 15000,
  });

  const { data: engineStats } = useQuery({
    queryKey: ["correlation-stats"],
    queryFn: () => api.getCorrelationStats(),
    refetchInterval: 30000,
  });

  const engineHealth = engineStats as { status?: string; stats?: Record<string, unknown> } | undefined;

  const incidents = data?.incidents ?? [];

  const stats = useMemo(() => ({
    critical: incidents.filter((i) => i.severity === "critical").length,
    major: incidents.filter((i) => i.severity === "major").length,
    minor: incidents.filter((i) => i.severity === "minor").length,
    total: incidents.length,
    active: incidents.filter((i) => ["open", "investigating", "mitigated"].includes(i.status)).length,
  }), [incidents]);

  const filteredIncidents = useMemo(() => {
    const term = search.toLowerCase();
    return incidents
      .filter((inc) => {
        if (severityFilter !== "all" && inc.severity !== severityFilter) return false;
        if (!term) return true;
        return (
          inc.title.toLowerCase().includes(term) ||
          inc.incident_id.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity] || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [incidents, severityFilter, search]);

  const totalConfidence = incidents.reduce((sum, i) => sum + i.confidence_score, 0);
  const avgConfidence = incidents.length > 0 ? totalConfidence / incidents.length : 0;

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-10">

        {/* Header */}
        <div className="border-b border-border/60 pb-8">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-3 w-3" />
            Naxis Intelligence
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Correlation Engine</h1>
          <p className="mt-1 text-sm text-foreground-muted max-w-2xl">
            Correlated incidents generated from raw telemetry across all vendors. Events are grouped by
            site, time, and severity to produce actionable operational incidents with confidence scores
            and blast radius.
          </p>

          {/* KPIs */}
          <div className="mt-8 flex flex-wrap gap-8">
            <div>
              <div className="text-3xl font-semibold text-critical">{stats.critical}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">
                <span className="text-critical">Outage</span>
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-major">{stats.major}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">
                <span className="text-major">Degraded</span>
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-minor">{stats.minor}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">
                <span className="text-minor">Attention</span>
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-foreground">{stats.active}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Active</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-foreground">{stats.total}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Total incidents</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-foreground">{(avgConfidence * 100).toFixed(0)}%</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Avg confidence</div>
            </div>
          </div>
        </div>

        {/* Engine Health */}
        {engineHealth && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/40 bg-surface/30 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground">Engine</span>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              engineHealth.status === "active" ? "bg-emerald-500/10 text-emerald-400" :
              engineHealth.status === "no_data" ? "bg-amber-500/10 text-amber-400" :
              "bg-foreground/5 text-foreground-muted"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                engineHealth.status === "active" ? "bg-emerald-400" :
                engineHealth.status === "no_data" ? "bg-amber-400" :
                "bg-foreground-muted"
              }`} />
              {engineHealth.status ?? "unknown"}
            </span>
            {engineHealth.stats && (
              <>
                <span className="text-foreground-muted">|</span>
                <span className="text-foreground-muted">
                  {engineHealth.stats.lastCycleIncidents as number ?? 0} incidents
                </span>
                <span className="text-foreground-muted">·</span>
                <span className="text-foreground-muted">
                  {(engineHealth.stats.lastCycleEvents as number ?? 0).toLocaleString()} events
                </span>
                {engineHealth.stats.lastDurationMs != null && (
                  <>
                    <span className="text-foreground-muted">·</span>
                    <span className="text-foreground-muted">
                      {(engineHealth.stats.lastDurationMs as number).toFixed(0)}ms
                    </span>
                  </>
                )}
                {engineHealth.stats.cascadeEnabled != null && (
                  <>
                    <span className="text-foreground-muted">·</span>
                    <span className="text-foreground-muted">
                      Cascade: {engineHealth.stats.cascadeEnabled ? "on" : "off"}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Empty state — no incidents yet */}
        {!isLoading && incidents.length === 0 && (
          <div className="space-y-6">
            <div className="flex items-start gap-4 rounded-xl border border-primary/20 bg-primary/5 p-6">
              <Brain className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">No incidents yet</p>
                <p className="mt-1 text-sm text-foreground-muted">
                  The correlation engine is waiting for telemetry. When Mist, VeloCloud SD-WAN, DNAC,
                  or Arista WLC events arrive, they will be automatically correlated into incidents
                  grouped by site, time window, and severity.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              {[
                { icon: <Activity className="h-5 w-5 text-violet-400" />, title: "Site grouping", desc: "Events at the same site within 5 minutes become one incident" },
                { icon: <AlertTriangle className="h-5 w-5 text-amber-400" />, title: "Severity filtering", desc: "Only MAJOR+ events trigger correlation; single CRITICAL events create incidents" },
                { icon: <Shield className="h-5 w-5 text-emerald-400" />, title: "Confidence scoring", desc: "Each incident scored by event count, severity distribution, and device diversity" },
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

        {/* Incident list */}
        {(isLoading || incidents.length > 0) && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
                <input
                  type="text"
                  placeholder="Search incidents..."
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
            ) : filteredIncidents.length === 0 ? (
              <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
                <Shield className="h-6 w-6 text-foreground-subtle" />
                <div>
                  <p className="font-semibold text-foreground">No matching incidents</p>
                  <p className="mt-1 text-sm text-foreground-muted">Try clearing filters or broadening your search.</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/60 border-t border-border/60">
                <div className="hidden grid-cols-12 gap-4 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
                  <div className="col-span-5">Incident</div>
                  <div className="col-span-4">Impact</div>
                  <div className="col-span-2">Confidence</div>
                  <div className="col-span-1 text-right">Updated</div>
                </div>
                {filteredIncidents.map((incident) => (
                  <IncidentCard key={incident.incident_id} incident={incident} />
                ))}
              </div>
            )}

            {filteredIncidents.length > 0 && (
              <p className="text-xs text-foreground-subtle text-center pt-2">
                Showing {filteredIncidents.length} of {incidents.length} incidents
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
