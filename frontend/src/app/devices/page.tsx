"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Calendar,
  Filter,
  HardDrive,
  MapPin,
  Network,
  Search,
  Server,
  Wifi,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DeviceReachability, DeviceSummary } from "@/types/device";
import { formatTimestamp } from "@/lib/utils";

const platformIcons: Record<string, React.ReactNode> = {
  dnac: <Network className="h-3.5 w-3.5" />,
  mist: <Wifi className="h-3.5 w-3.5" />,
  arista_sdwan: <Activity className="h-3.5 w-3.5" />,
  arista_wlc: <Wifi className="h-3.5 w-3.5" />,
};

const platformColors: Record<string, string> = {
  dnac: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  mist: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  arista_sdwan: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  arista_wlc: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

function ReachabilityDot({ status }: { status: DeviceReachability }) {
  const colors = {
    reachable: "bg-success",
    unreachable: "bg-critical",
    unknown: "bg-foreground-subtle",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} title={status} />;
}

function DeviceCard({ device }: { device: DeviceSummary }) {
  const platformClass =
    platformColors[device.platform] ??
    "text-foreground-muted bg-surface-subtle/30 border-border/70";

  return (
    <div className="group grid grid-cols-12 items-center gap-4 px-2 py-4 transition-colors hover:bg-surface">
      <div className="col-span-12 flex items-start gap-3 sm:col-span-5 lg:col-span-4">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle/30 text-foreground-subtle">
          <HardDrive className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5">
            <ReachabilityDot status={device.reachability} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {device.hostname || device.device_id}
          </h3>
          <p className="font-mono text-xs text-foreground-subtle">{device.device_id}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${platformClass}`}
            >
              {platformIcons[device.platform] ?? <Server className="h-3 w-3" />}
              {device.platform}
            </div>
            {device.device_type && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {device.device_type}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="col-span-12 grid grid-cols-2 gap-4 sm:col-span-4 lg:col-span-4">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <MapPin className="h-3 w-3" />
            Site
          </div>
          <div className="mt-0.5 text-sm text-foreground">{device.site_name || device.site_id || "—"}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Network className="h-3 w-3" />
            IP Address
          </div>
          <div className="mt-0.5 font-mono text-sm text-foreground">{device.ip_address || "—"}</div>
        </div>
      </div>

      <div className="col-span-6 sm:col-span-2 lg:col-span-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          <Activity className="h-3 w-3" />
          Status
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm capitalize text-foreground">
          <ReachabilityDot status={device.reachability} />
          {device.reachability}
        </div>
      </div>

      <div className="col-span-6 text-right sm:col-span-1 lg:col-span-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          Last seen
        </div>
        <div className="mt-0.5 text-sm text-foreground">
          {device.last_seen ? formatTimestamp(device.last_seen) : "—"}
        </div>
      </div>
    </div>
  );
}

function DevicesSkeleton() {
  return (
    <div className="border-t border-border/60">
      <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 lg:grid">
        <div className="col-span-4"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-4"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-2"><Skeleton className="h-3 w-16" /></div>
        <div className="col-span-2"><Skeleton className="ml-auto h-3 w-16" /></div>
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-4 px-2 py-4">
            <div className="col-span-12 flex items-start gap-3 sm:col-span-5 lg:col-span-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
            <div className="col-span-12 grid grid-cols-2 gap-4 sm:col-span-4 lg:col-span-4">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-28" />
            </div>
            <div className="col-span-6 sm:col-span-2 lg:col-span-2">
              <Skeleton className="h-8 w-20" />
            </div>
            <div className="col-span-6 sm:col-span-1 lg:col-span-2">
              <Skeleton className="ml-auto h-8 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [reachabilityFilter, setReachabilityFilter] = useState<DeviceReachability | "all">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.listDevices({ limit: 500 }),
    refetchInterval: 30000,
  });

  const devices = data?.devices ?? [];

  const platforms = useMemo(
    () => Array.from(new Set(devices.map((d) => d.platform))).sort(),
    [devices]
  );

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      if (platformFilter !== "all" && device.platform !== platformFilter) return false;
      if (reachabilityFilter !== "all" && device.reachability !== reachabilityFilter) return false;
      if (!search) return true;
      const term = search.toLowerCase();
      return (
        device.device_id.toLowerCase().includes(term) ||
        (device.hostname && device.hostname.toLowerCase().includes(term)) ||
        device.site_id.toLowerCase().includes(term) ||
        (device.site_name && device.site_name.toLowerCase().includes(term)) ||
        device.ip_address.toLowerCase().includes(term)
      );
    });
  }, [devices, platformFilter, reachabilityFilter, search]);

  const stats = useMemo(() => {
    return {
      total: devices.length,
      reachable: devices.filter((d) => d.reachability === "reachable").length,
      unreachable: devices.filter((d) => d.reachability === "unreachable").length,
      unknown: devices.filter((d) => d.reachability === "unknown").length,
    };
  }, [devices]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-6 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Network inventory
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Devices</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Discovered from events, collectors, and telemetry
            </p>
          </div>
          <div className="flex gap-8">
            <div className="text-right">
              <div className="text-2xl font-semibold text-foreground">{stats.total}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Total</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-success">{stats.reachable}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Reachable</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-critical">{stats.unreachable}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Unreachable</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search devices, hostnames, sites, IPs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-primary/30"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-foreground-subtle" />
              <select
                aria-label="Filter by platform"
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/30"
              >
                <option value="all">All Platforms</option>
                {platforms.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by reachability"
                value={reachabilityFilter}
                onChange={(e) => setReachabilityFilter(e.target.value as DeviceReachability | "all")}
                className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/30"
              >
                <option value="all">All Status</option>
                <option value="reachable">Reachable</option>
                <option value="unreachable">Unreachable</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            {(search || platformFilter !== "all" || reachabilityFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setPlatformFilter("all");
                  setReachabilityFilter("all");
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
          <DevicesSkeleton />
        ) : error ? (
          <div className="border-l-2 border-l-critical-border pl-4 py-3 text-critical">
            <AlertCircle className="mb-2 h-6 w-6" />
            <h3 className="font-medium">Failed to load devices</h3>
            <p className="text-sm text-foreground-muted">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground-subtle">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">No devices found</h3>
              <p className="mt-1 max-w-md text-sm text-foreground-muted">
                {devices.length === 0
                  ? "Devices will appear here once the worker starts processing telemetry."
                  : "No devices match your current filters."}
              </p>
            </div>
          </div>
        ) : (
          <div className="border-t border-border/60">
            <div className="hidden grid-cols-12 gap-4 border-b border-border/60 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
              <div className="col-span-4">Device</div>
              <div className="col-span-4">Location / Network</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Last seen</div>
            </div>
            <div className="divide-y divide-border/60">
              {filteredDevices.map((device) => (
                <DeviceCard key={device.device_id} device={device} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
