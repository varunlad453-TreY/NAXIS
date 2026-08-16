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
// ---------------------------------------------------------------------------
// Context-Style Node Card (matches Screenshot 2 boxes)
// ---------------------------------------------------------------------------

const CARD_WIDTH = 220;

function StandardNodeCard({ data, selected }: NodeProps<GraphNodeData>) {
  const {
    label,
    nodeType,
    healthStatus,
    isHighlighted,
    isDimmed,
    isRootCause,
    isSymptom,
    isSelected,
    childCount,
  } = data;

  const topoNode = data.topoNode as any;
  const meta = NODE_TYPE_META[nodeType] ?? { label: nodeType, color: "#6b7280" };
  const hMeta = HEALTH_STATUS_META[healthStatus] ?? HEALTH_STATUS_META.unknown;
  const Icon = getDeviceIcon(nodeType);

  const dimmed = isDimmed && !isHighlighted && !isSelected;
  const isFocus = isHighlighted || isSelected;
  const isAlerting = healthStatus === "critical" || healthStatus === "warning";
  const activeColor = isRootCause
    ? "#ef4444"
    : isSymptom
      ? "#f43f5e"
      : isFocus || isAlerting
        ? hMeta.color
        : undefined;

  const displayLabel = label || topoNode?.name || topoNode?.node_id || "Unknown";
  const ipAddress = topoNode?.ip_address;
  const vendorModel = [topoNode?.vendor, topoNode?.model].filter(Boolean).join(" · ");

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: "hsl(var(--border))", border: "none" }} />
      <div
        style={{
          width: CARD_WIDTH,
          borderColor: activeColor ? activeColor : "hsl(var(--border) / 0.6)",
          boxShadow: activeColor
            ? `0 0 0 2px ${activeColor}40`
            : "0 2px 8px rgba(0,0,0,0.3)",
          borderWidth: activeColor ? 2 : 1,
          opacity: dimmed ? 0.3 : 1,
        }}
        className={[
          "rounded bg-surface p-3 border overflow-hidden transition-all hover:border-primary/50 cursor-pointer",
          isRootCause ? "animate-pulse" : "",
        ].join(" ")}
      >
        <div className="space-y-1.5">
          {/* Type + health badge */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle truncate">
                {meta.label}
              </span>
            </div>
            <span
              className="shrink-0 text-[10px] font-semibold"
              style={{ color: isRootCause ? "#ef4444" : hMeta.color }}
            >
              {hMeta.label}
            </span>
          </div>

          {/* Name */}
          <div
            className="text-xs font-bold text-foreground leading-tight truncate"
            title={displayLabel}
          >
            {displayLabel}
          </div>

          {/* IP / Vendor / Model or child count */}
          <div className="flex flex-wrap items-center gap-x-2 text-[10px] font-mono text-foreground-muted">
            {ipAddress && <span>{ipAddress}</span>}
            {vendorModel && <span>{vendorModel}</span>}
            {!ipAddress && !vendorModel && childCount !== undefined && childCount > 0 && (
              <span>{childCount} devices</span>
            )}
          </div>

          {/* Status badge */}
          {isRootCause && (
            <div className="text-[9px] font-bold uppercase tracking-widest text-rose-500 pt-0.5">
              ⚡ Root Cause
            </div>
          )}
          {isSymptom && !isRootCause && (
            <div className="text-[9px] font-bold uppercase tracking-widest text-rose-400 pt-0.5">
              ← Impacted Device
            </div>
          )}
          {isFocus && !isRootCause && !isSymptom && (
            <div className="text-[9px] font-bold uppercase tracking-widest text-primary pt-0.5">
              ← Focus Device
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "hsl(var(--border))", border: "none" }} />
    </>
  );
}

function TopologyNodeComponent(props: NodeProps<GraphNodeData>) {
  return <StandardNodeCard {...props} />;
}

function LeafNodeComponent(props: NodeProps<GraphNodeData>) {
  return <StandardNodeCard {...props} />;
}

function SiteGroupNode(props: NodeProps<GraphNodeData>) {
  return <StandardNodeCard {...props} />;
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

function SiteViewNodeCard(props: NodeProps<GraphNodeData>) {
  return <StandardNodeCard {...props} />;
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
  siteViewNode: memo(SiteViewNodeCard),
};

export { TopologyNodeComponent, LeafNodeComponent, SiteGroupNode, RegionalHubNodeComponent, StatusBannerNodeComponent };

