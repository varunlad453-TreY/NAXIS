"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  MapPin,
  Network,
  Search,
  Server,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DeviceReachability, DeviceSummary } from "@/types/device";

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function ReachabilityDot({ status }: { status: DeviceReachability }) {
  const colors = {
    reachable: "bg-success",
    unreachable: "bg-critical",
    unknown: "bg-foreground-subtle",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} title={status} />;
}

function DeviceRow({ device }: { device: DeviceSummary }) {
  return (
    <div className="group grid grid-cols-12 items-center gap-3 px-3 py-3 transition-colors hover:bg-surface text-sm">
      <div className="col-span-12 flex items-center gap-3 lg:col-span-4">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle/40 text-foreground-subtle">
          <Wifi className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5">
            <ReachabilityDot status={device.reachability} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground group-hover:text-primary">
            {device.hostname || device.device_id}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-[11px] text-foreground-subtle">{device.mac || device.device_id}</span>
            {device.model && (
              <span className="inline-flex items-center rounded border border-violet-400/20 bg-violet-400/10 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                {device.model}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
          <MapPin className="h-3 w-3" /> Site
        </div>
        <div className="truncate text-foreground">{device.site_name || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
          <Network className="h-3 w-3" /> IP
        </div>
        <div className="font-mono text-foreground">{device.ip_address || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex gap-4">
          <div>
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
              <Users className="h-3 w-3" /> Clients
            </div>
            <div className="text-foreground">{device.num_clients}</div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
              <Clock className="h-3 w-3" /> Uptime
            </div>
            <div className="text-foreground">{formatUptime(device.uptime_seconds)}</div>
          </div>
        </div>
      </div>

      <div className="col-span-6 lg:col-span-2 text-right">
        <div className="flex items-center justify-end gap-1.5 mb-1">
          <ReachabilityDot status={device.reachability} />
          <span className="capitalize text-foreground">{device.reachability}</span>
        </div>
        {device.firmware_version && (
          <div className="flex items-center justify-end gap-1 text-[11px] text-foreground-subtle">
            <Zap className="h-3 w-3" />
            {device.firmware_version}
          </div>
        )}
      </div>
    </div>
  );
}

function SiteGroup({ siteName, devices }: { siteName: string; devices: DeviceSummary[] }) {
  const [open, setOpen] = useState(true);
  const reachable = devices.filter((d) => d.reachability === "reachable").length;
  const unreachable = devices.filter((d) => d.reachability === "unreachable").length;
  const totalClients = devices.reduce((s, d) => s + (d.num_clients || 0), 0);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-foreground-subtle" /> : <ChevronRight className="h-4 w-4 text-foreground-subtle" />}
          <MapPin className="h-4 w-4 text-violet-400" />
          <span className="font-medium text-foreground">{siteName}</span>
          <Badge variant="outline" className="text-[10px]">{devices.length} APs</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />{reachable} up
          </span>
          {unreachable > 0 && (
            <span className="flex items-center gap-1.5 text-critical">
              <span className="h-1.5 w-1.5 rounded-full bg-critical" />{unreachable} down
            </span>
          )}
          <span className="flex items-center gap-1 text-foreground-subtle text-[12px]">
            <Users className="h-3.5 w-3.5" />{totalClients} clients
          </span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-border/40">
          {devices.map((d) => <DeviceRow key={d.device_id} device={d} />)}
        </div>
      )}
    </div>
  );
}

export default function MistObserverPage() {
  const [search, setSearch] = useState("");
  const [reachabilityFilter, setReachabilityFilter] = useState<DeviceReachability | "all">("all");
  const [groupBySite, setGroupBySite] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["mist-devices"],
    queryFn: () => api.listDevices({ platform: "mist", limit: 2000 }),
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
        d.mac.toLowerCase().includes(term) ||
        d.model.toLowerCase().includes(term) ||
        d.site_name.toLowerCase().includes(term) ||
        d.ip_address.toLowerCase().includes(term) ||
        d.serial.toLowerCase().includes(term)
      );
    });
  }, [devices, reachabilityFilter, search]);

  const stats = useMemo(() => ({
    total: devices.length,
    reachable: devices.filter((d) => d.reachability === "reachable").length,
    unreachable: devices.filter((d) => d.reachability === "unreachable").length,
    totalClients: devices.reduce((s, d) => s + (d.num_clients || 0), 0),
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
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-violet-400">
                <Wifi className="h-3.5 w-3.5" />
                Platform Observer
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Juniper Mist</h1>
              <p className="mt-1 text-sm text-foreground-muted">
                Wireless access point inventory for Tata Motors — {stats.total} APs across {siteGroups.length} sites
              </p>
            </div>
            <div className="flex gap-8">
              <div className="text-right">
                <div className="text-2xl font-semibold text-foreground">{stats.total}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Total APs</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-success">{stats.reachable}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Online</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-critical">{stats.unreachable}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Offline</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-foreground">{stats.totalClients}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Clients</div>
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
              placeholder="Search hostname, MAC, model, site, IP, serial..."
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
              <option value="reachable">Online</option>
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
              <p className="font-semibold text-foreground">No devices found</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {devices.length === 0 ? "Inventory will appear after the first collection cycle." : "No devices match your filters."}
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
              <div className="col-span-4">Device</div>
              <div className="col-span-2">Site</div>
              <div className="col-span-2">IP Address</div>
              <div className="col-span-2">Clients / Uptime</div>
              <div className="col-span-2 text-right">Status</div>
            </div>
            <div className="divide-y divide-border/40">
              {filteredDevices.map((d) => <DeviceRow key={d.device_id} device={d} />)}
            </div>
          </div>
        )}

        {filteredDevices.length > 0 && (
          <div className="text-center text-xs text-foreground-subtle pt-2">
            Showing {filteredDevices.length} of {data?.total ?? devices.length} devices
          </div>
        )}

      </div>
    </div>
  );
}
