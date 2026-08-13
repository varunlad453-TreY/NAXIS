/**
 * Topology Legend
 *
 * Concise, subtle legend for device types, link states, and health states.
 * Does not dominate the canvas.
 */

import {
  Globe,
  Shield,
  Router,
  Network,
  Wifi,
  Monitor,
  Cpu,
  Server,
  HardDrive,
} from "lucide-react";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";

interface TopologyLegendProps {
  visible: boolean;
}

const ICON_SIZE = "h-3.5 w-3.5";

export function TopologyLegend({ visible }: TopologyLegendProps) {
  if (!visible) return null;

  // Group types by category for cleaner display
  const types = Object.entries(NODE_TYPE_META);

  return (
    <div className="absolute bottom-3 left-3 z-20 rounded-lg border border-border/50 bg-surface/90 p-3 shadow-lg backdrop-blur-sm max-w-[280px]">
      {/* Device types */}
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
        Devices
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {types.map(([type, meta]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: meta.color }} />
            <span className="text-[10px] text-foreground-muted">{meta.label}</span>
          </div>
        ))}
      </div>

      {/* Link states */}
      <div className="mt-2.5 border-t border-border/30 pt-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          Links
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-px w-6 bg-foreground-subtle" />
            <span className="text-[10px] text-foreground-muted">Physical / Healthy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px w-6 border-t border-dashed border-foreground-subtle" />
            <span className="text-[10px] text-foreground-muted">Logical / WAN</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px w-6 bg-warning" />
            <span className="text-[10px] text-foreground-muted">Degraded</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px w-6 bg-critical" />
            <span className="text-[10px] text-foreground-muted">Down</span>
          </div>
        </div>
      </div>

      {/* Health states */}
      <div className="mt-2.5 border-t border-border/30 pt-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          Health
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(HEALTH_STATUS_META).map(([status, meta]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
              <span className="text-[10px] text-foreground-muted">{meta.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
