import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  Server, Wifi, Globe, Monitor, Shield, ChevronRight,
} from "lucide-react";
import type { DeviceCategoryCluster } from "@/types/topology";
import { CATEGORY_META, HEALTH_STATUS_META } from "@/types/topology";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  core_network: <Server className="h-5 w-5" />,
  edge_security: <Shield className="h-5 w-5" />,
  wireless: <Wifi className="h-5 w-5" />,
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
      className="group cursor-pointer border bg-slate-900"
      style={{ width: CLUSTER_NODE_WIDTH, borderColor: meta.color }}
    >
      <Handle type="target" position={Position.Top} className="!border-slate-700 !bg-slate-800" />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">{CATEGORY_ICONS[cluster.category] ?? <Monitor className="h-4 w-4" />}</span>
          <span className="truncate text-xs font-semibold text-white">{meta.label}</span>
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: hMeta.color }} title={hMeta.label} />
          <ChevronRight className="ml-auto h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          {hd.critical_count > 0 ? (
            <>
              <span className="text-lg font-bold" style={{ color: HEALTH_STATUS_META.critical.color }}>{hd.critical_count}</span>
              <span className="text-[10px] font-medium" style={{ color: HEALTH_STATUS_META.critical.color }}>critical</span>
              <span className="text-[10px] text-slate-500">of {cluster.count}</span>
            </>
          ) : (
            <>
              <span className="text-lg font-bold text-white">{cluster.count}</span>
              {hd.warning_count > 0 && (
                <span className="text-[10px] font-medium" style={{ color: HEALTH_STATUS_META.warning.color }}>{hd.warning_count} warning</span>
              )}
            </>
          )}
        </div>
        {cluster.worstDevice && (
          <div className="mt-0.5 truncate text-[10px] text-slate-500">
            worst: <span className="font-medium" style={{ color: HEALTH_STATUS_META[cluster.worstDevice.health_status]?.color ?? hMeta.color }}>{cluster.worstDevice.name}</span>
          </div>
        )}

        {/* Health bar */}
        <div className="mt-2 flex h-1.5 w-full bg-slate-800">
          {segments.map((s) => s.count > 0 ? (
            <div key={s.label} className="h-full" style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }} />
          ) : null)}
        </div>

        {/* Health counts */}
        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
          {healthItems.map((item) => (
            <span key={item.label} className="font-semibold" style={{ color: item.color }}>
              {item.count} <span className="font-normal opacity-70">{item.label}</span>
            </span>
          ))}
        </div>

        {/* Device types */}
        {cluster.deviceTypes.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-slate-800 pt-1.5 text-[9px] text-slate-500">
            {cluster.deviceTypes.map((dt) => (
              <span key={dt.type} className="truncate">{dt.label} {dt.count}</span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!border-slate-700 !bg-slate-800" />
    </div>
  );
}

export const TypeClusterNode = memo(TypeClusterNodeComponent);
