"use client";

import { AlertCircle, Server } from "lucide-react";
import { InventoryRow, InventorySkeleton, SiteGroup } from "@/components/devices";
import type { DeviceSummary } from "@/types/device";

interface DeviceListViewProps {
  isLoading: boolean;
  error: Error | null;
  devices: DeviceSummary[];
  filteredDevices: DeviceSummary[];
  siteGroups: [string, DeviceSummary[]][];
  groupBySite: boolean;
  total?: number;
}

export function DeviceListView({
  isLoading,
  error,
  devices,
  filteredDevices,
  siteGroups,
  groupBySite,
  total,
}: DeviceListViewProps) {
  if (isLoading) {
    return <InventorySkeleton />;
  }

  if (error) {
    return (
      <div className="border-l-2 border-l-critical-border py-3 pl-4 text-critical">
        <AlertCircle className="mb-2 h-6 w-6" />
        <h3 className="font-medium">Failed to load devices</h3>
        <p className="text-sm text-foreground-muted">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (filteredDevices.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-foreground-subtle">
          <Server className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">No devices found</h3>
          <p className="mt-1 max-w-md text-sm text-foreground-muted">
            {devices.length === 0
              ? "Inventory will appear here once the worker finishes the first collection cycle."
              : "No devices match your current filters."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {groupBySite ? (
        <div className="space-y-3">
          {siteGroups.map(([siteName, siteDevices]) => (
            <SiteGroup key={siteName} siteName={siteName} devices={siteDevices} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/50">
          <div className="hidden grid-cols-12 gap-3 border-b border-border/60 bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
            <div className="col-span-4">Device</div>
            <div className="col-span-2">Site</div>
            <div className="col-span-2">IP Address</div>
            <div className="col-span-2">Clients / Uptime</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          <div className="divide-y divide-border/40">
            {filteredDevices.map((d) => (
              <InventoryRow key={d.device_id} device={d} />
            ))}
          </div>
        </div>
      )}

      <div className="pt-2 text-center text-xs text-foreground-subtle">
        Showing {filteredDevices.length} of {total ?? devices.length} devices
      </div>
    </>
  );
}
