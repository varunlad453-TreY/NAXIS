"use client";

import { Clock, MapPin, Network, Users, Wifi, Zap } from "lucide-react";
import type { DeviceReachability, DeviceSummary } from "@/types/device";

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

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function InventoryRow({ device }: { device: DeviceSummary }) {
  const platformClass =
    platformColors[device.platform] ??
    "text-foreground-muted bg-surface-subtle/30 border-border/70";

  return (
    <div className="group grid grid-cols-12 items-center gap-3 px-3 py-3 text-sm transition-colors hover:bg-surface">
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
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-[11px] text-foreground-subtle">
              {device.mac || device.device_id}
            </span>
            {device.model && (
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider ${platformClass}`}
              >
                {device.model}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          <MapPin className="h-3 w-3" /> Site
        </div>
        <div className="truncate text-foreground">{device.site_name || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          <Network className="h-3 w-3" /> IP
        </div>
        <div className="font-mono text-foreground">{device.ip_address || "—"}</div>
      </div>

      <div className="col-span-6 lg:col-span-2">
        <div className="flex gap-4">
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              <Users className="h-3 w-3" /> Clients
            </div>
            <div className="text-foreground">{device.num_clients}</div>
          </div>
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              <Clock className="h-3 w-3" /> Uptime
            </div>
            <div className="text-foreground">{formatUptime(device.uptime_seconds)}</div>
          </div>
        </div>
      </div>

      <div className="col-span-6 text-right lg:col-span-2">
        <div className="mb-1 flex items-center justify-end gap-1.5">
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
