"use client";

import Link from "next/link";
import { Clock, Server, Wifi } from "lucide-react";
import type { DeviceSummary } from "@/types/device";
import { DeviceReachabilityBadge } from "./device-reachability-badge";
import { formatAbsoluteTimestamp, cn } from "@/lib/utils";

interface DeviceRowProps {
  device: DeviceSummary;
}

export function DeviceRow({ device }: DeviceRowProps) {
  return (
    <Link href={`#`}>
      <div
        className={cn(
          "group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-elevated"
        )}
      >
        <div className="flex items-center gap-2 flex-1 min-w-fit">
          <Server className="h-4 w-4 flex-shrink-0 text-foreground-subtle" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
              {device.hostname || device.device_id}
            </div>
            {device.ip_address && (
              <div className="truncate font-mono text-xs text-foreground-subtle">
                {device.ip_address}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border/70 bg-surface-subtle/50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-foreground min-w-fit">
          {device.platform.toUpperCase()}
        </div>

        <div className="min-w-fit text-sm text-foreground-muted">{device.device_type || "Unknown"}</div>

        <div className="flex items-center gap-2 min-w-fit">
          <Wifi className="h-4 w-4 flex-shrink-0 text-foreground-subtle" />
          <span className="truncate text-sm text-foreground">
            {device.site_name || device.site_id}
          </span>
        </div>

        <div className="flex-shrink-0">
          <DeviceReachabilityBadge reachability={device.reachability} />
        </div>

        {device.last_seen && (
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-surface-subtle/50 px-2 py-1 text-xs text-foreground-muted min-w-fit">
            <Clock className="h-3 w-3" />
            <time title={formatAbsoluteTimestamp(device.last_seen)}>
              {new Date(device.last_seen).toLocaleDateString("en-US")}
            </time>
          </div>
        )}
      </div>
    </Link>
  );
}
