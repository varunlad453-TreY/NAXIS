"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
  MapPin,
  Search,
  Server,
  Shield,
  Sparkles,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import type { EventSeverity, EventSummary } from "@/types/event";
import type { DeviceSummary } from "@/types/device";
import { formatTimestamp } from "@/lib/utils";

// ─── helpers ──────────────────────────────────────────────────────────────────

const severityWeight: Record<EventSeverity, number> = { critical: 4, major: 3, minor: 2, info: 1 };
const severityDot: Record<EventSeverity, string> = {
  critical: "bg-critical",
  major: "bg-major",
  minor: "bg-minor",
  info: "bg-info",
};
const severityText: Record<EventSeverity, string> = {
  critical: "text-critical",
  major: "text-major",
  minor: "text-minor",
  info: "text-info",
};
const severityBorder: Record<EventSeverity, string> = {
  critical: "border-critical/30",
  major: "border-major/30",
  minor: "border-minor/30",
  info: "border-info/30",
};
const severityBg: Record<EventSeverity, string> = {
  critical: "bg-critical/8",
  major: "bg-major/8",
  minor: "bg-minor/8",
  info: "bg-info/8",
};

function topSeverity(events: EventSummary[]): EventSeverity {
  if (!events.length) return "info";
  return events.reduce((best, e) =>
    severityWeight[e.severity] > severityWeight[best] ? e.severity : best
  , "info" as EventSeverity);
}

function SeverityPill({ severity }: { severity: EventSeverity }) {
  const icons: Record<EventSeverity, React.ReactNode> = {
    critical: <AlertCircle className="h-3 w-3" />,
    major: <AlertTriangle className="h-3 w-3" />,
    minor: <Info className="h-3 w-3" />,
    info: <Activity className="h-3 w-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${severityText[severity]} ${severityBg[severity]} ${severityBorder[severity]}`}>
      {icons[severity]}{severity}
    </span>
  );
}

// ─── FaultyDevice card ─────────────────────────────────────────────────────────

interface DeviceSignals {
  device: DeviceSummary;
  events: EventSummary[];
  severity: EventSeverity;
}

function DeviceSignalCard({ item }: { item: DeviceSignals }) {
  const [expanded, setExpanded] = useState(false);
  const { device, events, severity } = item;

  const criticalEvents = events.filter((e) => e.severity === "critical");
  const majorEvents = events.filter((e) => e.severity === "major");

  return (
    <div className={`rounded-xl border ${severityBorder[severity]} ${severityBg[severity]} overflow-hidden transition-all`}>
      {/* Card header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground-subtle`}>
            <Wifi className="h-5 w-5" />
            <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background ${severityDot[severity]}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground truncate">{device.hostname || device.device_id}</span>
              <SeverityPill severity={severity} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-foreground-muted">
              {device.site_name && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{device.site_name}
                </span>
              )}
              {device.model && (
                <span className="flex items-center gap-1">
                  <Server className="h-3 w-3" />{device.model}
                </span>
              )}
              {device.ip_address && (
                <span className="font-mono">{device.ip_address}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {criticalEvents.length > 0 && (
                <span className="text-[11px] font-semibold text-critical">{criticalEvents.length} critical signal{criticalEvents.length > 1 ? "s" : ""}</span>
              )}
              {majorEvents.length > 0 && (
                <span className="text-[11px] font-semibold text-major">{majorEvents.length} major signal{majorEvents.length > 1 ? "s" : ""}</span>
              )}
              <span className="text-[11px] text-foreground-subtle">{events.length} total event{events.length > 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <span className="text-xs text-foreground-subtle hidden sm:block">
            {formatTimestamp(events[0]?.timestamp ?? "")}
          </span>
          {expanded
            ? <ChevronDown className="h-4 w-4 text-foreground-subtle" />
            : <ChevronRight className="h-4 w-4 text-foreground-subtle" />
          }
        </div>
      </button>

      {/* Expanded signals */}
      {expanded && (
        <div className="border-t border-border/30 divide-y divide-border/20">
          <div className="px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle bg-background/30">
            Correlated signals
          </div>
          {events.map((e) => (
            <div key={e.event_id} className="flex items-start gap-3 px-5 py-3 hover:bg-background/20">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${severityDot[e.severity]}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{e.title}</span>
                  <span className={`text-[10px] font-semibold uppercase ${severityText[e.severity]}`}>{e.severity}</span>
                </div>
                {e.description && <p className="text-xs text-foreground-muted mt-0.5 line-clamp-2">{e.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-[11px] text-foreground-subtle">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />{formatTimestamp(e.timestamp)}
                  </span>
                  <span className="uppercase font-medium">{e.source}</span>
                  <span>{e.event_type}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CorrelationEnginePage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<EventSeverity | "all">("all");

  // fetch all events (faults/alarms)
  const { data: eventData, isLoading: eventsLoading } = useQuery({
    queryKey: ["correlation-events"],
    queryFn: () => api.listEvents({ limit: 5000 }),
    refetchInterval: 15000,
  });

  // fetch inventory to enrich device info
  const { data: deviceData } = useQuery({
    queryKey: ["correlation-devices"],
    queryFn: () => api.listDevices({ limit: 2000 }),
    refetchInterval: 60000,
  });

  const events = eventData?.events ?? [];
  const devices = deviceData?.devices ?? [];

  // build device_id → inventory map
  const deviceMap = useMemo(() => {
    const map = new Map<string, DeviceSummary>();
    for (const d of devices) {
      map.set(d.device_id, d);
      if (d.hostname) map.set(d.hostname, d);
    }
    return map;
  }, [devices]);

  // group events by device, exclude info-only devices
  const faultyDevices = useMemo((): DeviceSignals[] => {
    const byDevice = new Map<string, EventSummary[]>();
    for (const e of events) {
      if (!e.device_id) continue;
      if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
      byDevice.get(e.device_id)!.push(e);
    }

    const items: DeviceSignals[] = [];
    for (const [deviceId, devEvents] of byDevice) {
      const severity = topSeverity(devEvents);
      if (severity === "info" && devEvents.length < 3) continue; // skip low-noise info-only

      const device: DeviceSummary = deviceMap.get(deviceId) ?? {
        device_id: deviceId,
        platform: devEvents[0]?.source ?? "unknown",
        hostname: devEvents[0]?.device_name || deviceId,
        mac: "",
        serial: "",
        model: "",
        ip_address: "",
        device_type: "ap",
        site_id: devEvents[0]?.site_id ?? "",
        site_name: devEvents[0]?.site_name ?? "",
        connected: false,
        reachability: "unknown",
        num_clients: 0,
        uptime_seconds: 0,
        firmware_version: "",
        management_state: "",
        last_seen: null,
      };

      const sorted = [...devEvents].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      items.push({ device, events: sorted, severity });
    }

    // sort: critical → major → minor, then by event count
    return items.sort((a, b) => {
      const d = severityWeight[b.severity] - severityWeight[a.severity];
      if (d !== 0) return d;
      return b.events.length - a.events.length;
    });
  }, [events, deviceMap]);

  const filteredItems = useMemo(() => {
    const term = search.toLowerCase();
    return faultyDevices.filter((item) => {
      if (severityFilter !== "all" && item.severity !== severityFilter) return false;
      if (!term) return true;
      return (
        item.device.hostname.toLowerCase().includes(term) ||
        item.device.device_id.toLowerCase().includes(term) ||
        item.device.site_name.toLowerCase().includes(term) ||
        item.device.model.toLowerCase().includes(term) ||
        item.events.some((e) => e.title.toLowerCase().includes(term))
      );
    });
  }, [faultyDevices, severityFilter, search]);

  const stats = useMemo(() => ({
    critical: faultyDevices.filter((d) => d.severity === "critical").length,
    major: faultyDevices.filter((d) => d.severity === "major").length,
    minor: faultyDevices.filter((d) => d.severity === "minor").length,
    total: faultyDevices.length,
  }), [faultyDevices]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-10">

        {/* Header */}
        <div className="border-b border-border/60 pb-8">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-3 w-3" />
            Naxis Intelligence
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Correlation Engine</h1>
          <p className="mt-1 text-sm text-foreground-muted max-w-2xl">
            When a device has problems, signals from all connected platforms are correlated here — showing you exactly what is wrong and from which source, so you can pinpoint the root cause.
          </p>

          {/* KPIs */}
          <div className="mt-8 flex flex-wrap gap-8">
            <div>
              <div className="text-3xl font-semibold text-critical">{stats.critical}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Critical devices</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-major">{stats.major}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Major faults</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-minor">{stats.minor}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Minor issues</div>
            </div>
            <div>
              <div className="text-3xl font-semibold text-foreground">{events.length.toLocaleString()}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle mt-0.5">Signals ingested</div>
            </div>
          </div>
        </div>

        {/* How it works — shown when no faults */}
        {!eventsLoading && faultyDevices.length === 0 && (
          <div className="space-y-6">
            <div className="flex items-start gap-4 rounded-xl border border-primary/20 bg-primary/5 p-6">
              <Brain className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">No device faults detected</p>
                <p className="mt-1 text-sm text-foreground-muted">
                  When a device reports problems — from Mist, DNAC, Arista SD-WAN, or any other source — all its signals are grouped here with full cross-platform context. You&apos;ll see exactly which platform raised the alarm, what happened, and when.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              {[
                { icon: <Wifi className="h-5 w-5 text-violet-400" />, title: "Mist signals", desc: "AP down, RF degradation, client disconnects" },
                { icon: <Server className="h-5 w-5 text-blue-400" />, title: "DNAC signals", desc: "Switch reachability, interface errors, fabric health" },
                { icon: <Zap className="h-5 w-5 text-emerald-400" />, title: "SD-WAN signals", desc: "Tunnel failures, path quality, WAN link events" },
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

        {/* Fault list */}
        {(eventsLoading || faultyDevices.length > 0) && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
                <input
                  type="text"
                  placeholder="Search device, site, model, fault..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30"
                />
              </div>
              <div className="flex items-center gap-2">
                {(["all", "critical", "major", "minor"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={`px-2.5 py-1 rounded text-sm font-medium transition-colors capitalize ${
                      severityFilter === s
                        ? s === "all" ? "bg-surface text-foreground" : `${severityBg[s as EventSeverity]} ${severityText[s as EventSeverity]} border ${severityBorder[s as EventSeverity]}`
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                {(search || severityFilter !== "all") && (
                  <button onClick={() => { setSearch(""); setSeverityFilter("all"); }} className="ml-1 inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {eventsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border/40 p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-lg" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
                <Shield className="h-6 w-6 text-foreground-subtle" />
                <div>
                  <p className="font-semibold text-foreground">No matching devices</p>
                  <p className="mt-1 text-sm text-foreground-muted">Try clearing filters or broadening your search.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <DeviceSignalCard key={item.device.device_id} item={item} />
                ))}
              </div>
            )}

            {filteredItems.length > 0 && (
              <p className="text-xs text-foreground-subtle text-center pt-2">
                Showing {filteredItems.length} affected device{filteredItems.length > 1 ? "s" : ""} of {faultyDevices.length} total
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
