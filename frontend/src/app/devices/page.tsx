"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  HardDrive,
  MapPin,
  Network,
  Radio,
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

function fmt(n: number) { return new Intl.NumberFormat("en-US").format(n); }
function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const PLATFORM_STYLE: Record<string, { color: string; label: string; Icon: React.ElementType }> = {
  mist:       { color: "text-violet-400 bg-violet-400/10 border-violet-400/25", label: "Mist",       Icon: Wifi },
  velocloud:  { color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25", label: "VeloCloud", Icon: Radio },
  dnac:       { color: "text-blue-400 bg-blue-400/10 border-blue-400/25", label: "DNAC",       Icon: Network },
};

function PlatformBadge({ platform }: { platform: string }) {
  const s = PLATFORM_STYLE[platform] ?? { color: "text-foreground-muted bg-surface-subtle/30 border-border/70", label: platform, Icon: Server };
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider ${s.color}`}>
      {s.label}
    </span>
  );
}

function DeviceIcon({ platform, reachability }: { platform: string; reachability: DeviceReachability }) {
  const s = PLATFORM_STYLE[platform] ?? { color: "text-foreground-muted", Icon: Server };
  const dot = { reachable: "bg-success", unreachable: "bg-critical", degraded: "bg-major", unknown: "bg-foreground-subtle" }[reachability];
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle/40">
      <s.Icon className={`h-4 w-4 ${s.color.split(" ")[0]}`} />
      <span className={`absolute -right-0.5 -top-0.5 inline-block h-2 w-2 rounded-full ${dot}`} />
    </div>
  );
}

function DeviceRow({ device }: { device: DeviceSummary }) {
  const isEdge = device.platform === "velocloud";
  const score = device.props?.velobrain_score;

  return (
    <div className="group grid grid-cols-12 items-center gap-3 px-3 py-3 transition-colors hover:bg-surface text-sm">
      <div className="col-span-12 flex items-center gap-3 lg:col-span-4">
        <DeviceIcon platform={device.platform} reachability={device.reachability} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground group-hover:text-primary">
            {device.hostname || device.device_id}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <PlatformBadge platform={device.platform} />
            <span className="font-mono text-[10px] text-foreground-subtle">
              {isEdge ? (device.serial || device.device_id) : (device.mac || device.device_id)}
            </span>
            {device.model && (
              <span className="rounded border border-border/40 bg-surface-subtle/40 px-1 text-[9px] font-semibold uppercase tracking-wider text-foreground-subtle">
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
        <div className="truncate text-foreground text-xs">{device.site_name || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
          <Network className="h-3 w-3" /> {isEdge ? "WAN IP" : "IP"}
        </div>
        <div className="font-mono text-xs text-foreground">{device.ip_address || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        {isEdge ? (
          score !== undefined && score !== null ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">VeloBrain</div>
              <ScoreBar score={score} />
            </div>
          ) : (
            <div className="text-[10px] text-foreground-subtle">No metrics yet</div>
          )
        ) : (
          <div className="flex gap-4">
            <div>
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
                <Users className="h-3 w-3" /> Clients
              </div>
              <div className="text-foreground text-xs">{device.num_clients}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">
                <Clock className="h-3 w-3" /> Uptime
              </div>
              <div className="text-foreground text-xs">{formatUptime(device.uptime_seconds)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="col-span-6 lg:col-span-2 text-right">
        <StateChip reachability={device.reachability} />
        {device.firmware_version && (
          <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-foreground-subtle">
            <Zap className="h-3 w-3" />{device.firmware_version}
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, (score / 5) * 100);
  const color = score >= 4 ? "bg-success" : score >= 3 ? "bg-major" : "bg-critical";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-surface-subtle overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold ${score >= 4 ? "text-success" : score >= 3 ? "text-major" : "text-critical"}`}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function StateChip({ reachability }: { reachability: DeviceReachability }) {
  if (reachability === "reachable") return <span className="text-[10px] font-bold text-success">Connected</span>;
  if (reachability === "degraded") return <span className="text-[10px] font-bold text-major">Degraded</span>;
  if (reachability === "unreachable") return <span className="text-[10px] font-bold text-critical">Offline</span>;
  return <span className="text-[10px] font-bold text-foreground-subtle">Unknown</span>;
}

function SiteGroup({ siteName, devices }: { siteName: string; devices: DeviceSummary[] }) {
  const [open, setOpen] = useState(true);
  const reachable = devices.filter((d) => d.reachability === "reachable").length;
  const degraded = devices.filter((d) => d.reachability === "degraded").length;
  const offline = devices.filter((d) => d.reachability === "unreachable").length;
  const platforms = Array.from(new Set(devices.map((d) => d.platform)));

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-foreground-subtle" /> : <ChevronRight className="h-4 w-4 text-foreground-subtle" />}
          <MapPin className="h-4 w-4 text-foreground-subtle" />
          <span className="font-medium text-foreground">{siteName}</span>
          <Badge variant="outline" className="text-[10px]">{devices.length} devices</Badge>
          <div className="flex gap-1">
            {platforms.map((p) => <PlatformBadge key={p} platform={p} />)}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-success text-xs">{reachable} up</span>
          {degraded > 0 && <span className="flex items-center gap-1.5 text-major text-xs">{degraded} degraded</span>}
          {offline > 0 && <span className="flex items-center gap-1.5 text-critical text-xs">{offline} down</span>}
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

export default function DevicesPage() {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [reachabilityFilter, setReachabilityFilter] = useState<DeviceReachability | "all">("all");
  const [groupBySite, setGroupBySite] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["devices-all"],
    queryFn: () => api.listDevices({ limit: 2000 }),
    refetchInterval: 60000,
  });

  const devices = data?.devices ?? [];

  const platforms = useMemo(
    () => Array.from(new Set(devices.map((d) => d.platform))).sort(),
    [devices]
  );

  const filteredDevices = useMemo(() => {
    const term = search.toLowerCase();
    return devices.filter((d) => {
      if (platformFilter !== "all" && d.platform !== platformFilter) return false;
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
  }, [devices, platformFilter, reachabilityFilter, search]);

  const stats = useMemo(() => {
    const byPlatform: Record<string, number> = {};
    for (const d of devices) byPlatform[d.platform] = (byPlatform[d.platform] ?? 0) + 1;
    return {
      total: devices.length,
      reachable: devices.filter((d) => d.reachability === "reachable").length,
      offline: devices.filter((d) => d.reachability !== "reachable").length,
      byPlatform,
    };
  }, [devices]);

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
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-6 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Multi-vendor inventory
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">All Devices</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              {stats.total} devices across {siteGroups.length} sites
              {Object.entries(stats.byPlatform).map(([p, c]) => (
                <span key={p} className="ml-2">·&nbsp;<span className="text-foreground">{fmt(c)}</span>&nbsp;{p}</span>
              ))}
            </p>
          </div>
          <div className="flex gap-8">
            <div className="text-right">
              <div className="text-2xl font-semibold text-foreground">{fmt(stats.total)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Total</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-success">{fmt(stats.reachable)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Online</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-critical">{fmt(stats.offline)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Offline</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search hostname, MAC, serial, model, site, IP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30"
            />
          </div>
          <div className="flex items-center gap-3">
            <Filter className="h-4 w-4 text-foreground-subtle" />
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
            >
              <option value="all">All Platforms</option>
              {platforms.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              value={reachabilityFilter}
              onChange={(e) => setReachabilityFilter(e.target.value as DeviceReachability | "all")}
              className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
            >
              <option value="all">All Status</option>
              <option value="reachable">Online</option>
              <option value="unreachable">Offline</option>
              <option value="degraded">Degraded</option>
            </select>
            <button
              onClick={() => setGroupBySite((g) => !g)}
              className={`text-sm px-2 py-1 rounded border transition-colors ${
                groupBySite ? "border-primary/40 text-primary bg-primary/5" : "border-border/60 text-foreground-muted hover:text-foreground"
              }`}
            >
              Group by site
            </button>
            {(search || platformFilter !== "all" || reachabilityFilter !== "all") && (
              <button
                onClick={() => { setSearch(""); setPlatformFilter("all"); setReachabilityFilter("all"); }}
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
            <p className="font-medium">Failed to load devices</p>
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
              <div className="col-span-2">IP</div>
              <div className="col-span-2">Metrics</div>
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
