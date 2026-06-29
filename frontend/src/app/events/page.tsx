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

const severityConfig: Record<
  EventSeverity,
  { icon: React.ReactNode; color: string; bg: string; border: string; dot: string }
> = {
  critical: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    color: "text-critical",
    bg: "bg-critical/10",
    border: "border-critical/20",
    dot: "bg-critical",
  },
  major: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: "text-major",
    bg: "bg-major/10",
    border: "border-major/20",
    dot: "bg-major",
  },
  minor: {
    icon: <Info className="h-3.5 w-3.5" />,
    color: "text-minor",
    bg: "bg-minor/10",
    border: "border-minor/20",
    dot: "bg-minor",
  },
  info: {
    icon: <Activity className="h-3.5 w-3.5" />,
    color: "text-info",
    bg: "bg-info/10",
    border: "border-info/20",
    dot: "bg-info",
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
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${config.color} ${config.bg} ${config.border}`}
    >
      {config.icon}
      {severity}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface-subtle/30 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
      {sourceIcons[source] ?? <Activity className="h-3 w-3" />}
      {source}
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const config = severityConfig[event.severity] ?? severityConfig.info;

  return (
    <div className="group grid grid-cols-12 items-center gap-4 px-2 py-4 transition-colors hover:bg-surface">
      <div className="col-span-12 flex items-center gap-3 sm:col-span-3 lg:col-span-2">
        <span className={`h-2 w-2 rounded-full ${config.dot}`} />
        <div>
          <div className="text-xs text-foreground-subtle">{formatTimestamp(event.timestamp)}</div>
          <div className="mt-1">
            <SeverityBadge severity={event.severity} />
          </div>
        </div>
      </div>

      <div className="col-span-12 space-y-1.5 sm:col-span-9 lg:col-span-5">
        <h3 className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
          {event.title}
        </h3>
        <p className="line-clamp-2 text-sm text-foreground-muted">{event.description}</p>
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
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Server className="h-3.5 w-3.5 text-foreground-subtle" />
            <span className="font-mono text-foreground">{event.device_id}</span>
          </div>
        )}
        {event.site_id && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Wifi className="h-3.5 w-3.5 text-foreground-subtle" />
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

      <div className="col-span-12 flex items-center justify-start lg:col-span-2 lg:justify-end">
        <span className="font-mono text-xs text-foreground-subtle">
          {event.event_id.slice(0, 12)}...
        </span>
      </div>
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div className="border-t border-border/60">
      <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 lg:grid">
        <div className="col-span-2"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-5"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-3"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-2"><Skeleton className="ml-auto h-3 w-10" /></div>
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-4 px-2 py-4">
            <div className="col-span-12 space-y-2 sm:col-span-3 lg:col-span-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="col-span-12 space-y-2 sm:col-span-9 lg:col-span-5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="col-span-12 space-y-1 lg:col-span-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="col-span-12 lg:col-span-2">
              <Skeleton className="h-3 w-24 lg:ml-auto" />
            </div>
          </div>
        ))}
      </div>
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
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Telemetry stream
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Events</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Normalised telemetry across all vendors and collectors
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold text-foreground">{filteredEvents.length}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              {severityFilter === "all" ? "Total" : severityFilter} events
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search events, devices, sites, IDs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-primary/30"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-foreground-subtle" />
              <select
                aria-label="Filter by severity"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as EventSeverity | "all")}
                className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/30"
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
                className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/30"
              >
                <option value="all">All Sources</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>

            {(search || severityFilter !== "all" || sourceFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setSeverityFilter("all");
                  setSourceFilter("all");
                }}
                className="inline-flex items-center gap-1 text-sm text-foreground-muted transition-colors hover:text-foreground"
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
          <div className="border-l-2 border-l-critical-border pl-4 py-3 text-critical">
            <AlertCircle className="mb-2 h-6 w-6" />
            <h3 className="font-medium">Failed to load events</h3>
            <p className="text-sm text-foreground-muted">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground-subtle">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">No events found</h3>
              <p className="mt-1 max-w-md text-sm text-foreground-muted">
                {events.length === 0
                  ? "Events will appear here once the worker starts processing telemetry."
                  : "No events match your current filters."}
              </p>
            </div>
          </div>
        ) : (
          <div className="border-t border-border/60">
            <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
              <div className="col-span-2">Time / Severity</div>
              <div className="col-span-5">Event</div>
              <div className="col-span-3">Scope</div>
              <div className="col-span-2 text-right">ID</div>
            </div>
            <div className="divide-y divide-border/60">
              {filteredEvents.map((event) => (
                <EventRow key={event.event_id} event={event} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
