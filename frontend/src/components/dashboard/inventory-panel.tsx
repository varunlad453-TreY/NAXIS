"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clock, MapPin, Search, Server, Users, Wifi, X, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DeviceReachability, DeviceSummary } from "@/types/device";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatUptime(s: number) {
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

function ReachDot({ status }: { status: DeviceReachability }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        status === "reachable"
          ? "bg-success"
          : status === "unreachable"
          ? "bg-critical"
          : "bg-foreground-subtle"
      }`}
    />
  );
}

function DeviceRow({ device }: { device: DeviceSummary }) {
  return (
    <div className="group grid grid-cols-12 items-center gap-3 border-b border-border/20 px-3 py-2.5 text-sm transition-colors hover:bg-primary/4 last:border-0">
      <div className="col-span-12 flex items-center gap-3 lg:col-span-4">
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface/60 text-foreground-subtle">
          <Wifi className="h-3 w-3" />
          <span className="absolute -right-0.5 -top-0.5">
            <ReachDot status={device.reachability} />
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">
            {device.hostname || device.device_id}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-foreground-subtle">{device.mac}</span>
            {device.model && (
              <span className="rounded border border-violet-400/20 bg-violet-400/10 px-1 text-[8px] font-bold uppercase text-violet-400">
                {device.model}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="col-span-6 lg:col-span-3 text-xs">
        <div className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-foreground-subtle">
          <MapPin className="h-2 w-2" /> Site
        </div>
        <div className="truncate text-foreground">{device.site_name || "—"}</div>
      </div>
      <div className="col-span-6 lg:col-span-2 text-xs">
        <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-subtle">
          IP
        </div>
        <div className="font-mono text-foreground">{device.ip_address || "—"}</div>
      </div>
      <div className="col-span-6 flex gap-3 text-xs lg:col-span-2">
        <div>
          <div className="mb-0.5 flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-subtle">
            <Users className="h-2 w-2" /> Clients
          </div>
          <div className="text-foreground">{device.num_clients}</div>
        </div>
        <div>
          <div className="mb-0.5 flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-subtle">
            <Clock className="h-2 w-2" /> Up
          </div>
          <div className="text-foreground">{formatUptime(device.uptime_seconds)}</div>
        </div>
      </div>
      <div className="col-span-6 text-right text-xs lg:col-span-1">
        <div className="flex items-center justify-end gap-1">
          <ReachDot status={device.reachability} />
          <span className=" capitalize text-foreground-muted">{device.reachability}</span>
        </div>
        {device.firmware_version && (
          <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[9px] text-foreground-subtle">
            <Zap className="h-2 w-2" />
            {device.firmware_version}
          </div>
        )}
      </div>
    </div>
  );
}

function SiteGroup({ siteName, devices }: { siteName: string; devices: DeviceSummary[] }) {
  const [open, setOpen] = useState(false);
  const up = devices.filter((d) => d.reachability === "reachable").length;
  const down = devices.filter((d) => d.reachability === "unreachable").length;

  return (
    <div className="overflow-hidden rounded-lg border border-border/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-surface/40 px-3 py-2 transition-colors hover:bg-surface/70"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3 w-3 text-foreground-subtle" />
          ) : (
            <ChevronRight className="h-3 w-3 text-foreground-subtle" />
          )}
          <MapPin className="h-3 w-3 text-violet-400" />
          <span className="text-xs font-medium text-foreground">{siteName}</span>
          <Badge variant="outline" className="h-4 py-0 text-[9px]">
            {devices.length}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-success">{up} up</span>
          {down > 0 && <span className="text-critical">{down} down</span>}
        </div>
      </button>
      {open && devices.map((d) => <DeviceRow key={d.device_id} device={d} />)}
    </div>
  );
}

export function InventoryPanel() {
  const [search, setSearch] = useState("");
  const [rf, setRf] = useState<DeviceReachability | "all">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["home-devices"],
    queryFn: () => api.listDevices({ limit: 2000 }),
    refetchInterval: 60000,
  });

  const devices = data?.devices ?? [];

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return devices.filter((d) => {
      if (rf !== "all" && d.reachability !== rf) return false;
      if (!term) return true;
      return (
        d.hostname.toLowerCase().includes(term) ||
        d.mac.toLowerCase().includes(term) ||
        d.model.toLowerCase().includes(term) ||
        d.site_name.toLowerCase().includes(term) ||
        d.ip_address.toLowerCase().includes(term)
      );
    });
  }, [devices, rf, search]);

  const groups = useMemo(() => {
    const map = new Map<string, DeviceSummary[]>();
    for (const d of filtered) {
      const k = d.site_name || "Unknown";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const stats = useMemo(
    () => ({
      online: devices.filter((d) => d.reachability === "reachable").length,
      offline: devices.filter((d) => d.reachability === "unreachable").length,
      clients: devices.reduce((s, d) => s + (d.num_clients || 0), 0),
    }),
    [devices]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
        <span className="text-foreground-subtle">
          <span className="font-bold text-foreground">{fmt(devices.length)}</span> total
        </span>
        <span className="text-success">
          <span className="font-bold">{fmt(stats.online)}</span> online
        </span>
        <span className="text-critical">
          <span className="font-bold">{fmt(stats.offline)}</span> offline
        </span>
        <span className="text-foreground-subtle">
          <span className="font-bold text-foreground">{fmt(stats.clients)}</span> clients
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            placeholder="Search hostname, MAC, model, site, IP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-b border-border/40 bg-transparent py-1.5 pl-5 pr-4 text-xs text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/40"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rf}
            onChange={(e) => setRf(e.target.value as DeviceReachability | "all")}
            className="border-b border-border/40 bg-transparent px-1 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
          >
            <option value="all">All</option>
            <option value="reachable">Online</option>
            <option value="unreachable">Offline</option>
          </select>
          {(search || rf !== "all") && (
            <button onClick={() => { setSearch(""); setRf("all"); }}>
              <X className="h-3 w-3 text-foreground-muted hover:text-foreground" />
            </button>
          )}
          <span className="font-mono text-[10px] text-foreground-subtle">
            {filtered.length} devices
          </span>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex items-start gap-3 border-t border-border/30 py-8">
          <Server className="mt-0.5 h-4 w-4 text-foreground-subtle" />
          <p className="text-xs text-foreground-muted">
            {devices.length === 0
              ? "Inventory will appear after the first collection cycle."
              : "No devices match."}
          </p>
        </div>
      ) : (
        <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
          {groups.map(([site, devs]) => (
            <SiteGroup key={site} siteName={site} devices={devs} />
          ))}
        </div>
      )}
    </div>
  );
}
