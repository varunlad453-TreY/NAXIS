/**
 * Topology Node Types — Compact, device-specific visual language.
 *
 * Nodes look like network devices, not dashboard cards.
 */

import { memo } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";
import {
  Globe,
  Shield,
  Router,
  Server,
  Network,
  Wifi,
  Radio,
  Monitor,
  Smartphone,
  Camera,
  Cpu,
  Printer,
  HardDrive,
} from "lucide-react";

import { HEALTH_STATUS_META, NODE_TYPE_META } from "@/types/topology";
import type { GraphNodeData } from "./topology-graph-model";
import { CollapsedGroupNode } from "./collapsed-group-node";

// Lucide icon component type
type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: string | number }>;

// ---------------------------------------------------------------------------
// Icon mapping by device type — uses real node_type values from the data model
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, IconComponent> = {
  internet: Globe,
  wan: Globe,
  cloud: Globe,
  site: Server,
  firewall: Shield,
  router: Router,
  gateway: Router,
  wan_edge: Router,
  vpn_gateway: Shield,
  load_balancer: Network,
  core_switch: Network,
  controller: Server,
  edge: Server, // velo edge
  server: Server,
  distribution_switch: Network,
  access_switch: Network,
  switch: Network,
  ap: Wifi,
  access_point: Wifi,
  wireless_controller: Radio,
  client: Monitor,
  endpoint: Smartphone,
  sensor: Cpu,
  camera: Camera,
  iot: Cpu,
  printer: Printer,
};

function getDeviceIcon(nodeType: string): IconComponent {
  return TYPE_ICONS[nodeType] ?? HardDrive;
}

function getHealthDotColor(status: string): string {
  return HEALTH_STATUS_META[status]?.color ?? "#6b7280";
}

// ---------------------------------------------------------------------------
// Compact Infrastructure Node
// ---------------------------------------------------------------------------

const INFRA_WIDTH = 170;
const INFRA_HEIGHT = 42;

function TopologyNodeComponent({ data, selected }: NodeProps<GraphNodeData>) {
  const {
    label,
    nodeType,
    healthStatus,
    deviceColor,
    deviceLabel,
    isHighlighted,
    isDimmed,
    isRootCause,
    isSelected,
  } = data;

  const Icon = getDeviceIcon(nodeType);
  const healthColor = getHealthDotColor(healthStatus);
  const dimmed = isDimmed && !isHighlighted && !isSelected;

  return (
    <div
      className={[
        "group relative cursor-pointer transition-all",
        "rounded-md border bg-surface",
        isRootCause ? "animate-pulse" : "",
        selected || isSelected ? "ring-2 ring-primary/50" : "",
        "hover:shadow-md hover:border-primary/30",
      ].join(" ")}
      style={{
        width: INFRA_WIDTH,
        height: INFRA_HEIGHT,
        borderColor: isHighlighted ? healthColor : "hsl(var(--border) / 0.5)",
        opacity: dimmed ? 0.3 : 1,
        boxShadow: isHighlighted
          ? `0 0 0 2px ${healthColor}30, 0 2px 8px ${healthColor}20`
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !border-border !bg-border" />

      <div className="flex h-full items-center gap-2 px-2.5">
        {/* Device icon */}
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm"
          style={{ backgroundColor: deviceColor + "18", color: deviceColor }}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>

        {/* Labels */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[11px] font-semibold leading-tight text-foreground">
            {label}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-foreground-subtle leading-tight">
            <span>{deviceLabel}</span>
          </div>
        </div>

        {/* Health indicator */}
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <span
            className="block h-2 w-2 rounded-full"
            style={{
              backgroundColor: healthColor,
              boxShadow: healthStatus === "critical" || healthStatus === "warning"
                ? `0 0 4px ${healthColor}`
                : undefined,
            }}
            title={healthStatus}
          />
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-border !bg-border" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact Leaf Node (smaller, for clients/APs)
// ---------------------------------------------------------------------------

const LEAF_WIDTH = 150;
const LEAF_HEIGHT = 34;

function LeafNodeComponent({ data, selected }: NodeProps<GraphNodeData>) {
  const {
    label,
    nodeType,
    healthStatus,
    deviceColor,
    deviceLabel,
    isHighlighted,
    isDimmed,
    isSelected,
  } = data;

  const Icon = getDeviceIcon(nodeType);
  const healthColor = getHealthDotColor(healthStatus);
  const dimmed = isDimmed && !isHighlighted && !isSelected;

  return (
    <div
      className={[
        "group relative cursor-pointer transition-all",
        "rounded-md border bg-surface",
        selected || isSelected ? "ring-2 ring-primary/50" : "",
        "hover:shadow-md hover:border-primary/30",
      ].join(" ")}
      style={{
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
        borderColor: isHighlighted ? healthColor : "hsl(var(--border) / 0.4)",
        opacity: dimmed ? 0.3 : 1,
        boxShadow: isHighlighted
          ? `0 0 0 2px ${healthColor}30`
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !border-border !bg-border" />

      <div className="flex h-full items-center gap-1.5 px-2">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: deviceColor }} strokeWidth={2} />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[10px] font-medium leading-tight text-foreground">
            {label}
          </div>
        </div>
        <span
          className="block h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: healthColor }}
          title={healthStatus}
        />
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !border-border !bg-border" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site Group Node
// ---------------------------------------------------------------------------

const SITE_WIDTH = 260;
const SITE_HEIGHT = 52;

function SiteGroupNode({ data, selected }: NodeProps<GraphNodeData>) {
  const {
    label,
    healthStatus,
    healthColor,
    deviceColor,
    childCount,
    isHighlighted,
    isSelected,
  } = data;

  const hColor = getHealthDotColor(healthStatus);

  return (
    <div
      className={[
        "relative cursor-pointer transition-all",
        "rounded-lg border-2 bg-surface/60",
        selected || isSelected ? "ring-2 ring-primary/50" : "",
        "hover:border-primary/40",
      ].join(" ")}
      style={{
        width: SITE_WIDTH,
        height: SITE_HEIGHT,
        borderColor: isHighlighted ? hColor : deviceColor + "40",
        boxShadow: isHighlighted
          ? `0 0 0 3px ${hColor}25`
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !border-border !bg-border" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-border !bg-border" />

      <div className="flex h-full items-center gap-2.5 px-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: deviceColor }}
        >
          <Server className="h-4 w-4" strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[12px] font-semibold leading-tight text-foreground">
            {label}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-foreground-subtle leading-tight">
            <span>Site</span>
            {childCount !== undefined && childCount > 0 && (
              <>
                <span>·</span>
                <span>{childCount} devices</span>
              </>
            )}
          </div>
        </div>

        <span
          className="block h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: hColor }}
          title={healthStatus}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regional Hub Custom Node — High-Impact Regional Card
// ---------------------------------------------------------------------------

const HUB_WIDTH = 320;
const HUB_HEIGHT = 110;

function RegionalHubNodeComponent({ data, selected }: NodeProps<GraphNodeData>) {
  const { label, healthStatus, childCount, isSelected } = data;
  const topoNode = data.topoNode as any;
  const criticalCount = topoNode?.critical_count ?? 0;
  const warningCount = topoNode?.warning_count ?? 0;
  const deviceCount = topoNode?.device_count ?? 0;
  const hColor = getHealthDotColor(healthStatus);
  const degraded = criticalCount + warningCount;

  return (
    <div
      className={[
        "relative cursor-pointer overflow-hidden rounded-sm border bg-slate-900",
        selected || isSelected ? "border-indigo-400" : "border-slate-700 hover:border-slate-500",
      ].join(" ")}
      style={{ width: HUB_WIDTH, height: HUB_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !border-slate-600 !bg-slate-800" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-slate-600 !bg-slate-800" />

      <div className="flex flex-col justify-between h-full p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-white">{label}</div>
            <div className="text-[10px] text-slate-500">{childCount ?? 0} sites · {deviceCount} devices</div>
          </div>
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: hColor }} />
        </div>
        {degraded > 0 && (
          <div className="text-[10px] text-rose-400">{degraded} degraded</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Banner Node — Zero Incident Banner Card
// ---------------------------------------------------------------------------

const BANNER_WIDTH = 460;
const BANNER_HEIGHT = 130;

function StatusBannerNodeComponent({ data }: NodeProps<GraphNodeData>) {
  const topoNode = data.topoNode as any;
  return (
    <div
      className="relative cursor-default rounded-sm border border-emerald-800 bg-slate-900 p-3"
      style={{ width: BANNER_WIDTH, height: BANNER_HEIGHT }}
    >
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-emerald-500" />
        <span className="text-xs font-bold text-emerald-400">{topoNode?.name || "All sites operational"}</span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        {topoNode?.health_label || "Zero active alerts"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReactFlow nodeTypes map
// ---------------------------------------------------------------------------

export const topologyNodeTypes = {
  topologyNode: memo(TopologyNodeComponent),
  leafNode: memo(LeafNodeComponent),
  siteGroup: memo(SiteGroupNode),
  regionalHub: memo(RegionalHubNodeComponent),
  statusBanner: memo(StatusBannerNodeComponent),
  collapsedGroup: CollapsedGroupNode,
};

export { TopologyNodeComponent, LeafNodeComponent, SiteGroupNode, RegionalHubNodeComponent, StatusBannerNodeComponent };

