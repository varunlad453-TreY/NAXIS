"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DeviceFilterBar, DeviceListView } from "@/components/devices";
import type { DeviceReachability, DeviceSummary } from "@/types/device";

export default function DevicesPage() {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [reachabilityFilter, setReachabilityFilter] = useState<DeviceReachability | "all">("all");
  const [groupBySite, setGroupBySite] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["devices"],
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

  const stats = useMemo(
    () => ({
      total: devices.length,
      reachable: devices.filter((d) => d.reachability === "reachable").length,
      unreachable: devices.filter((d) => d.reachability === "unreachable").length,
      totalClients: devices.reduce((s, d) => s + (d.num_clients || 0), 0),
    }),
    [devices]
  );

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
        <div className="flex flex-col gap-6 border-b border-border/60 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Network inventory
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              Devices
            </h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Live AP inventory from Juniper Mist — {stats.total} access points across{" "}
              {siteGroups.length} sites
            </p>
          </div>
          <div className="flex gap-8">
            <Stat value={stats.total} label="Total APs" tone="neutral" />
            <Stat value={stats.reachable} label="Online" tone="success" />
            <Stat value={stats.unreachable} label="Offline" tone="critical" />
            <Stat value={stats.totalClients} label="Clients" tone="neutral" />
          </div>
        </div>

        <DeviceFilterBar
          search={search}
          onSearchChange={setSearch}
          platformFilter={platformFilter}
          onPlatformChange={setPlatformFilter}
          reachabilityFilter={reachabilityFilter}
          onReachabilityChange={setReachabilityFilter}
          groupBySite={groupBySite}
          onGroupToggle={() => setGroupBySite((g) => !g)}
          platforms={platforms}
        />

        <DeviceListView
          isLoading={isLoading}
          error={error as Error | null}
          devices={devices}
          filteredDevices={filteredDevices}
          siteGroups={siteGroups}
          groupBySite={groupBySite}
          total={data?.total}
        />
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "neutral" | "success" | "critical";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "critical" ? "text-critical" : "text-foreground";

  return (
    <div className="text-right">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
        {label}
      </div>
    </div>
  );
}
