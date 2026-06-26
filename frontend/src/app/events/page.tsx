"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Calendar,
  Filter,
  Info,
  Search,
  Server,
  Wifi,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { EventSeverity, EventSummary } from "@/types/event";
import { formatTimestamp } from "@/lib/utils";

const severityConfig: Record<EventSeverity, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
  critical: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    color: "text-critical",
    bg: "bg-critical/10",
    border: "border-critical/20",
  },
  major: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: "text-major",
    bg: "bg-major/10",
    border: "border-major/20",
  },
  minor: {
    icon: <Info className="h-3.5 w-3.5" />,
    color: "text-minor",
    bg: "bg-minor/10",
    border: "border-minor/20",
  },
  info: {
    icon: <Activity className="h-3.5 w-3.5" />,
    color: "text-info",
    bg: "bg-info/10",
    border: "border-info/20",
  },
};

const sourceIcons: Record<string, React.ReactNode> = {
  dnac: <Server className="h-3.5 w-3.5" />,
  mist: <Wifi className="h-3.5 w-3.5" />,
  arista_sdwan: <Activity className="h-3.5 w-3.5" />,
  arista_wlc: <Wifi className="h-3.5 w-3.5" />,
};

function SeverityBadge({ severity }: { severity: EventSeverity }) {
  const config = severityConfig[severity] ?? severityConfig.info;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${config.color} ${config.bg} ${config.border}`}
    >
      {config.icon}
      {severity}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-foreground-muted">
      {sourceIcons[source] ?? <Activity className="h-3.5 w-3.5" />}
      {source}
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  return (
    <div className="group grid grid-cols-12 items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04]">
      <div className="col-span-12 flex items-start justify-between gap-4 sm:col-span-3 lg:col-span-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-foreground-subtle">
            <Calendar className="h-3 w-3" />
            {formatTimestamp(event.timestamp)}
          </div>
          <SeverityBadge severity={event.severity} />
        </div>
      </div>

      <div className="col-span-12 space-y-2 sm:col-span-9 lg:col-span-5">
        <h3 className="font-medium text-foreground">{event.title}</h3>
        <p className="text-sm text-foreground-muted line-clamp-2">{event.description}</p>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={event.source} />
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {event.event_type}
          </Badge>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {event.category}
          </Badge>
        </div>
      </div>

      <div className="col-span-12 space-y-1 lg:col-span-3">
        {event.device_id && (
          <div className="flex items-center gap-2 text-sm text-foreground-subtle">
            <Server className="h-3.5 w-3.5 text-foreground-muted" />
            <span className="font-mono text-foreground">{event.device_id}</span>
          </div>
        )}
        {event.site_id && (
          <div className="flex items-center gap-2 text-sm text-foreground-subtle">
            <Wifi className="h-3.5 w-3.5 text-foreground-muted" />
            <span>{event.site_name || event.site_id}</span>
          </div>
        )}
        {event.incident_id && (
          <div className="flex items-center gap-2 text-xs text-primary">
            <AlertCircle className="h-3 w-3" />
            Linked to {event.incident_id.slice(0, 16)}...
          </div>
        )}
      </div>

      <div className="col-span-12 flex items-center justify-end lg:col-span-2">
        <span className="font-mono text-xs text-foreground-subtle">{event.event_id.slice(0, 12)}...</span>
      </div>
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}

export default function EventsPage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<EventSeverity | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["events"],
    queryFn: () => api.listEvents({ limit: 500 }),
    refetchInterval: 10000,
  });

  const events = data?.events ?? [];

  const sources = useMemo(
    () => Array.from(new Set(events.map((e) => e.source))).sort(),
    [events]
  );

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => {
        if (severityFilter !== "all" && event.severity !== severityFilter) return false;
        if (sourceFilter !== "all" && event.source !== sourceFilter) return false;
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          event.title.toLowerCase().includes(term) ||
          event.description.toLowerCase().includes(term) ||
          event.device_id.toLowerCase().includes(term) ||
          event.site_id.toLowerCase().includes(term) ||
          event.event_id.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [events, severityFilter, sourceFilter, search]);

  const severityOptions: { value: EventSeverity | "all"; label: string }[] = [
    { value: "all", label: "All Severities" },
    { value: "critical", label: "Critical" },
    { value: "major", label: "Major" },
    { value: "minor", label: "Minor" },
    { value: "info", label: "Info" },
  ];

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Events</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Normalized telemetry stream across all vendors
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold text-foreground">{filteredEvents.length}</div>
            <div className="text-xs uppercase tracking-[0.2em] text-foreground-subtle">
              {severityFilter === "all" ? "Total" : severityFilter} events
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search events, devices, sites, IDs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground-subtle focus:border-primary/50 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-foreground-subtle" />
            <select
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as EventSeverity | "all")}
              className="rounded-xl border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
            >
              {severityOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
            >
              <option value="all">All Sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>

            {(search || severityFilter !== "all" || sourceFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setSeverityFilter("all");
                  setSourceFilter("all");
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-foreground-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <EventsSkeleton />
        ) : error ? (
          <div className="rounded-2xl border border-critical/20 bg-critical/10 p-8 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-critical" />
            <h3 className="mt-3 font-medium text-critical">Failed to load events</h3>
            <p className="mt-1 text-sm text-foreground-muted">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
            <Activity className="mx-auto h-10 w-10 text-foreground-subtle" />
            <h3 className="mt-4 font-medium text-foreground">No events found</h3>
            <p className="mt-1 text-sm text-foreground-muted">
              {events.length === 0
                ? "Events will appear here once the worker starts processing telemetry."
                : "No events match your current filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map((event) => (
              <EventRow key={event.event_id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
