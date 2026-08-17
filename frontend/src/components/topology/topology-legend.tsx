/**
 * Topology Legend
 *
 * Premium executive-grade legend for device types, link states, and health states.
 */

import { X } from "lucide-react";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";

interface TopologyLegendProps {
  visible: boolean;
  onClose?: () => void;
}

export function TopologyLegend({ visible, onClose }: TopologyLegendProps) {
  if (!visible) return null;

  const types = Object.entries(NODE_TYPE_META);

  return (
    <div className="w-[340px] rounded-xl border border-border/80 bg-surface-elevated/95 p-4 shadow-2xl backdrop-blur-md transition-all">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Topology Legend
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1 text-foreground-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            title="Close Legend"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Device types */}
      <div className="mb-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-subtle">
          Devices
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {types.map(([type, meta]) => (
            <div key={type} className="flex items-center gap-2 min-w-0">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm shadow-sm"
                style={{ backgroundColor: meta.color }}
              />
              <span className="text-[11px] font-medium text-foreground-muted whitespace-nowrap truncate">
                {meta.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Link states */}
      <div className="mb-3 border-t border-border/40 pt-2.5">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-subtle">
          Links
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-5 bg-foreground-subtle shrink-0" />
            <span className="text-[11px] text-foreground-muted whitespace-nowrap">Physical / Healthy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-5 border-t border-dashed border-foreground-subtle shrink-0" />
            <span className="text-[11px] text-foreground-muted whitespace-nowrap">Logical / WAN</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-5 bg-warning shrink-0" />
            <span className="text-[11px] text-foreground-muted whitespace-nowrap">Degraded</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-5 bg-critical shrink-0" />
            <span className="text-[11px] text-foreground-muted whitespace-nowrap">Down</span>
          </div>
        </div>
      </div>

      {/* Health states */}
      <div className="border-t border-border/40 pt-2.5">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-subtle">
          Health Status
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {Object.entries(HEALTH_STATUS_META).map(([status, meta]) => (
            <div key={status} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm"
                style={{ backgroundColor: meta.color }}
              />
              <span className="text-[11px] font-medium text-foreground-muted whitespace-nowrap capitalize">
                {meta.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

