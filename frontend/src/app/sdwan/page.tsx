"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Filter,
  MapPin,
  Network,
  Radio,
  Search,
  Server,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DeviceReachability, DeviceSummary } from "@/types/device";

function ReachabilityDot({ status }: { status: DeviceReachability }) {
  const colors: Record<DeviceReachability, string> = {
    reachable: "bg-success",
    unreachable: "bg-critical",
    degraded: "bg-major",
    unknown: "bg-foreground-subtle",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] ?? "bg-foreground-subtle"}`} title={status} />;
}

function StateChip({ reachability }: { reachability: string }) {
  if (reachability === "reachable")
    return <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">Connected</span>;
  if (reachability === "degraded")
    return <span className="inline-flex items-center gap-1 rounded-full border border-major/25 bg-major/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-major">Degraded</span>;
  return <span className="inline-flex items-center gap-1 rounded-full border border-critical/25 bg-critical/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-critical">Offline</span>;
}

function EdgeRow({ device }: { device: DeviceSummary }) {
  return (
    <div className="group grid grid-cols-12 items-center gap-3 px-3 py-3 transition-colors hover:bg-surface text-sm">
      <div className="col-span-12 flex items-center gap-3 lg:col-span-4">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle/40 text-foreground-subtle">
          <Radio className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5">
            <ReachabilityDot status={device.reachability} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground group-hover:text-primary">
            {device.hostname || device.device_id}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {device.serial && (
              <span className="font-mono text-[11px] text-foreground-subtle">{device.serial}</span>
            )}
            {device.model && (
              <span className="inline-flex items-center rounded border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                {device.model}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="col-span-6 lg:col-span-3">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
          <MapPin className="h-3 w-3" /> Site
        </div>
        <div className="truncate text-foreground">{device.site_name || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
          <Network className="h-3 w-3" /> WAN IP
        </div>
        <div className="font-mono text-foreground">{device.ip_address || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
          <Zap className="h-3 w-3" /> Firmware
        </div>
        <div className="text-foreground text-[11px]">{device.firmware_version || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-1 text-right">
        <StateChip reachability={device.reachability} />
      </div>
    </div>
  );
}

function SiteGroup({ siteName, devices }: { siteName: string; devices: DeviceSummary[] }) {
  const [open, setOpen] = useState(true);
  const reachable = devices.filter((d) => d.reachability === "reachable").length;
  const degraded = devices.filter((d) => d.reachability === "degraded").length;
  const offline = devices.filter((d) => d.reachability === "unreachable").length;

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-foreground-subtle" /> : <ChevronRight className="h-4 w-4 text-foreground-subtle" />}
          <MapPin className="h-4 w-4 text-emerald-400" />
          <span className="font-medium text-foreground">{siteName}</span>
          <Badge variant="outline" className="text-[10px]">{devices.length} edges</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />{reachable} up
          </span>
          {degraded > 0 && (
            <span className="flex items-center gap-1.5 text-major">
              <span className="h-1.5 w-1.5 rounded-full bg-major" />{degraded} degraded
            </span>
          )}
          {offline > 0 && (
            <span className="flex items-center gap-1.5 text-critical">
              <span className="h-1.5 w-1.5 rounded-full bg-critical" />{offline} down
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="divide-y divide-border/40">
          {devices.map((d) => <EdgeRow key={d.device_id} device={d} />)}
        </div>
      )}
    </div>
  );
}

export default function SdwanObserverPage() {
  const [search, setSearch] = useState("");
  const [reachabilityFilter, setReachabilityFilter] = useState<DeviceReachability | "all">("all");
  const [groupBySite, setGroupBySite] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sdwan-devices"],
    queryFn: () => api.listDevices({ platform: "velocloud", limit: 2000 }),
    refetchInterval: 60000,
  });

  const devices = data?.devices ?? [];

  const filteredDevices = useMemo(() => {
    const term = search.toLowerCase();
    return devices.filter((d) => {
      if (reachabilityFilter !== "all" && d.reachability !== reachabilityFilter) return false;
      if (!term) return true;
      return (
        d.hostname.toLowerCase().includes(term) ||
        d.serial.toLowerCase().includes(term) ||
        d.model.toLowerCase().includes(term) ||
        d.site_name.toLowerCase().includes(term) ||
        d.ip_address.toLowerCase().includes(term)
      );
    });
  }, [devices, reachabilityFilter, search]);

  const stats = useMemo(() => ({
    total: devices.length,
    reachable: devices.filter((d) => d.reachability === "reachable").length,
    degraded: devices.filter((d) => d.reachability === "degraded").length,
    offline: devices.filter((d) => d.reachability === "unreachable").length,
  }), [devices]);

  const siteGroups = useMemo(() => {
    const map = new Map<string, DeviceSummary[]>();
    for (const d of filteredDevices) {
      const key = d.site_name || d.site_id || "Unknown Site";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredDevices]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* Header */}
        <div className="border-b border-border/60 pb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
                <Radio className="h-3.5 w-3.5" />
                Platform Observer
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">VeloCloud SD-WAN</h1>
              <p className="mt-1 text-sm text-foreground-muted">
                SD-WAN edge inventory — {stats.total} edges across {siteGroups.length} sites
              </p>
            </div>
            <div className="flex gap-8">
              <div className="text-right">
                <div className="text-2xl font-semibold text-foreground">{stats.total}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Total Edges</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-success">{stats.reachable}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Connected</div>
              </div>
              {stats.degraded > 0 && (
                <div className="text-right">
                  <div className="text-2xl font-semibold text-major">{stats.degraded}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Degraded</div>
                </div>
              )}
              <div className="text-right">
                <div className="text-2xl font-semibold text-critical">{stats.offline}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Offline</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search edge name, serial, model, site, WAN IP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30"
            />
          </div>
          <div className="flex items-center gap-3">
            <Filter className="h-4 w-4 text-foreground-subtle" />
            <select
              value={reachabilityFilter}
              onChange={(e) => setReachabilityFilter(e.target.value as DeviceReachability | "all")}
              className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
            >
              <option value="all">All Status</option>
              <option value="reachable">Connected</option>
              <option value="unreachable">Offline</option>
            </select>
            <button
              onClick={() => setGroupBySite((g) => !g)}
              className={`text-sm px-2 py-1 rounded border transition-colors ${
                groupBySite ? "border-primary/40 text-primary bg-primary/5" : "border-border/60 text-foreground-muted hover:text-foreground"
              }`}
            >
              Group by site
            </button>
            {(search || reachabilityFilter !== "all") && (
              <button
                onClick={() => { setSearch(""); setReachabilityFilter("all"); }}
                className="inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border border-border/50 rounded-lg p-4 space-y-3">
                <Skeleton className="h-5 w-48" />
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="border-l-2 border-l-critical-border pl-4 py-3 text-critical">
            <AlertCircle className="mb-2 h-6 w-6" />
            <p className="font-medium">Failed to load inventory</p>
            <p className="text-sm text-foreground-muted">{error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
            <Server className="h-6 w-6 text-foreground-subtle" />
            <div>
              <p className="font-semibold text-foreground">No edges found</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {devices.length === 0
                  ? "SD-WAN edge inventory will appear after the first collection cycle completes."
                  : "No edges match your current filters."}
              </p>
            </div>
          </div>
        ) : groupBySite ? (
          <div className="space-y-3">
            {siteGroups.map(([siteName, siteDevices]) => (
              <SiteGroup key={siteName} siteName={siteName} devices={siteDevices} />
            ))}
          </div>
        ) : (
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <div className="hidden grid-cols-12 gap-3 border-b border-border/60 bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
              <div className="col-span-4">Edge Device</div>
              <div className="col-span-3">Site</div>
              <div className="col-span-2">WAN IP</div>
              <div className="col-span-2">Firmware</div>
              <div className="col-span-1 text-right">Status</div>
            </div>
            <div className="divide-y divide-border/40">
              {filteredDevices.map((d) => <EdgeRow key={d.device_id} device={d} />)}
            </div>
          </div>
        )}

        {filteredDevices.length > 0 && (
          <div className="text-center text-xs text-foreground-subtle pt-2">
            Showing {filteredDevices.length} of {data?.total ?? devices.length} edges
          </div>
        )}

      </div>
    </div>
  );
}
