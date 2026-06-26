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
  dnac: <Network className="h-4 w-4" />,
  mist: <Wifi className="h-4 w-4" />,
  arista_sdwan: <Activity className="h-4 w-4" />,
  arista_wlc: <Wifi className="h-4 w-4" />,
};

const platformColors: Record<string, string> = {
  dnac: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  mist: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  arista_sdwan: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  arista_wlc: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

function ReachabilityDot({ status }: { status: DeviceReachability }) {
  const colors = {
    reachable: "bg-success shadow-[0_0_12px_rgba(34,197,94,0.6)]",
    unreachable: "bg-critical shadow-[0_0_12px_rgba(239,68,68,0.6)]",
    unknown: "bg-foreground-subtle",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[status]}`}
      title={status}
    />
  );
}

function DeviceCard({ device }: { device: DeviceSummary }) {
  const platformClass = platformColors[device.platform] ?? "text-foreground-muted bg-white/[0.04] border-white/10";

  return (
    <div className="group flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all hover:border-white/10 hover:bg-white/[0.04] sm:flex-row sm:items-center">
      <div className="flex items-start gap-4 sm:flex-1">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-foreground-subtle">
          <HardDrive className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground">
              {device.hostname || device.device_id}
            </h3>
            <ReachabilityDot status={device.reachability} />
          </div>
          <p className="font-mono text-xs text-foreground-subtle">{device.device_id}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${platformClass}`}
            >
              {platformIcons[device.platform] ?? <Server className="h-3 w-3" />}
              {device.platform}
            </div>
            {device.device_type && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {device.device_type}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {device.management_state}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <MapPin className="h-3 w-3" />
            Site
          </div>
          <div className="text-sm text-foreground">
            {device.site_name || device.site_id || "—"}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <Network className="h-3 w-3" />
            IP Address
          </div>
          <div className="font-mono text-sm text-foreground">
            {device.ip_address || "—"}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <Activity className="h-3 w-3" />
            Reachability
          </div>
          <div className="text-sm capitalize text-foreground">{device.reachability}</div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <Calendar className="h-3 w-3" />
            Last Seen
          </div>
          <div className="text-sm text-foreground">
            {device.last_seen ? formatTimestamp(device.last_seen) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function DevicesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-36 rounded-2xl" />
      ))}
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
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Devices</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Network inventory discovered from events and collectors
            </p>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <div className="text-2xl font-semibold text-foreground">{stats.total}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">Total</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-success">{stats.reachable}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">Reachable</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-critical">{stats.unreachable}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">Unreachable</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search devices, hostnames, sites, IPs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground-subtle focus:border-primary/50 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-foreground-subtle" />
            <select
              aria-label="Filter by platform"
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
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
              className="rounded-xl border border-white/10 bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="reachable">Reachable</option>
              <option value="unreachable">Unreachable</option>
              <option value="unknown">Unknown</option>
            </select>

            {(search || platformFilter !== "all" || reachabilityFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setPlatformFilter("all");
                  setReachabilityFilter("all");
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
          <DevicesSkeleton />
        ) : error ? (
          <div className="rounded-2xl border border-critical/20 bg-critical/10 p-8 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-critical" />
            <h3 className="mt-3 font-medium text-critical">Failed to load devices</h3>
            <p className="mt-1 text-sm text-foreground-muted">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
            <Server className="mx-auto h-10 w-10 text-foreground-subtle" />
            <h3 className="mt-4 font-medium text-foreground">No devices found</h3>
            <p className="mt-1 text-sm text-foreground-muted">
              {devices.length === 0
                ? "Devices will appear here once the worker starts processing telemetry."
                : "No devices match your current filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDevices.map((device) => (
              <DeviceCard key={device.device_id} device={device} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
