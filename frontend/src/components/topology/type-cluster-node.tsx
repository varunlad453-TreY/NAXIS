import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  Server, Wifi, Globe, Monitor, ChevronRight,
} from "lucide-react";
import type { DeviceCategoryCluster } from "@/types/topology";
import { CATEGORY_META, HEALTH_STATUS_META } from "@/types/topology";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  infrastructure: <Server className="h-5 w-5" />,
  wireless: <Wifi className="h-5 w-5" />,
  edge: <Globe className="h-5 w-5" />,
  leaf: <Monitor className="h-5 w-5" />,
};

export const CLUSTER_NODE_WIDTH = 270;
export const CLUSTER_NODE_HEIGHT = 165;

function TypeClusterNodeComponent({ data }: NodeProps) {
  const cluster = data.cluster as DeviceCategoryCluster;
  const meta = CATEGORY_META[cluster.category];
  const hMeta = HEALTH_STATUS_META[cluster.aggregatedHealth];
  const { healthDistribution: hd } = cluster;
  const total = cluster.count || 1;

  const segments = useMemo(() => [
    { count: hd.critical_count, color: HEALTH_STATUS_META.critical.color, label: "Critical" },
    { count: hd.warning_count, color: HEALTH_STATUS_META.warning.color, label: "Warning" },
    { count: hd.healthy_count, color: HEALTH_STATUS_META.healthy.color, label: "Healthy" },
    { count: hd.unknown_count, color: HEALTH_STATUS_META.unknown.color, label: "Unknown" },
  ], [hd]);

  const healthItems = segments.filter((s) => s.count > 0);

  return (
    <div
      className="group cursor-pointer rounded-xl border-2 bg-surface shadow-surface transition-all duration-200 hover:shadow-surface-lg hover:-translate-y-0.5"
      style={{ width: CLUSTER_NODE_WIDTH, borderColor: meta.color }}
    >
      <Handle type="target" position={Position.Top} className="!border-border !bg-border" />
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
            style={{ backgroundColor: meta.color }}
          >
            {CATEGORY_ICONS[cluster.category] ?? <Monitor className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {meta.label}
              </span>
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
                style={{ backgroundColor: hMeta.color }}
                title={hMeta.label}
              />
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <div className="mt-0.5 text-3xl font-bold tracking-tight text-foreground">
              {cluster.count}
            </div>
          </div>
        </div>

        {/* Proportional health bar */}
        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-surface-elevated/50">
          {segments.map((s) =>
            s.count > 0 ? (
              <div
                key={s.label}
                className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(s.count / total) * 100}%`,
                  backgroundColor: s.color,
                }}
              />
            ) : null
          )}
        </div>

        {/* Health badges — clickable */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {healthItems.map((item) => (
            <span
              key={item.label}
              data-health-filter={item.label.toLowerCase()}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-all hover:opacity-80 active:scale-95"
              style={{ backgroundColor: item.color + "16", color: item.color }}
              title={`Filter by ${item.label}`}
            >
              {item.count}
              <span className="opacity-70 font-normal">{item.label}</span>
            </span>
          ))}
        </div>

        {/* Device type breakdown */}
        {cluster.deviceTypes.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-border/20 pt-2 text-[9px] text-foreground-muted">
            {cluster.deviceTypes.map((dt) => (
              <span key={dt.type} className="truncate">
                {dt.label} {dt.count}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!border-border !bg-border" />
    </div>
  );
}

export const TypeClusterNode = memo(TypeClusterNodeComponent);
