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
      <div className={cn(
        "flex items-center gap-4 px-5 py-4 transition-colors cursor-pointer",
        "hover:bg-white/[0.04]"
      )}>
        {/* Hostname / Device ID */}
        <div className="flex items-center gap-2 flex-1 min-w-fit">
          <Server className="h-4 w-4 flex-shrink-0 text-foreground-muted" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">
              {device.hostname || device.device_id}
            </div>
            {device.ip_address && (
              <div className="text-xs text-foreground-muted truncate font-mono">
                {device.ip_address}
              </div>
            )}
          </div>
        </div>

        {/* Platform */}
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm font-medium text-foreground min-w-fit uppercase">
          {device.platform.toUpperCase()}
        </div>

        {/* Device Type */}
        <div className="text-sm text-foreground-muted min-w-fit">
          {device.device_type || "Unknown"}
        </div>

        {/* Site */}
        <div className="flex items-center gap-2 min-w-fit">
          <Wifi className="h-4 w-4 flex-shrink-0 text-foreground-muted" />
          <span className="text-sm text-foreground truncate">
            {device.site_name || device.site_id}
          </span>
        </div>

        {/* Reachability */}
        <div className="flex-shrink-0">
          <DeviceReachabilityBadge reachability={device.reachability} />
        </div>

        {/* Last Seen */}
        {device.last_seen && (
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-foreground-muted min-w-fit">
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
