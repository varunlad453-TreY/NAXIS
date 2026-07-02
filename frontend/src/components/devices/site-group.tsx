"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DeviceSummary } from "@/types/device";
import { InventoryRow } from "./inventory-row";

export function SiteGroup({ siteName, devices }: { siteName: string; devices: DeviceSummary[] }) {
  const [open, setOpen] = useState(true);
  const reachable = devices.filter((d) => d.reachability === "reachable").length;
  const unreachable = devices.filter((d) => d.reachability === "unreachable").length;
  const totalClients = devices.reduce((s, d) => s + (d.num_clients || 0), 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-surface px-4 py-3 transition-colors hover:bg-surface/80"
      >
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 text-foreground-subtle" />
          ) : (
            <ChevronRight className="h-4 w-4 text-foreground-subtle" />
          )}
          <MapPin className="h-4 w-4 text-violet-400" />
          <span className="font-medium text-foreground">{siteName}</span>
          <Badge variant="outline" className="text-[10px]">
            {devices.length} APs
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {reachable} up
          </span>
          {unreachable > 0 && (
            <span className="flex items-center gap-1.5 text-critical">
              <span className="h-1.5 w-1.5 rounded-full bg-critical" />
              {unreachable} down
            </span>
          )}
          <span className="flex items-center gap-1 text-[12px] text-foreground-subtle">
            <Users className="h-3.5 w-3.5" />
            {totalClients} clients
          </span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-border/40">
          {devices.map((d) => (
            <InventoryRow key={d.device_id} device={d} />
          ))}
        </div>
      )}
    </div>
  );
}
