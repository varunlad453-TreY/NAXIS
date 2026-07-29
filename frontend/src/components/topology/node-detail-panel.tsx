"use client";

import type { TopologyNodeDetail, TopologyNode } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, ArrowUp, ArrowDown, Network, Building, Cable } from "lucide-react";
import { HealthHistoryChart } from "./health-history-chart";

interface NodeDetailPanelProps {
  nodeDetail?: TopologyNodeDetail | null;
  loading?: boolean;
}

function deviceTypeMeta(nodeType: string) {
  return NODE_TYPE_META[nodeType] ?? {
    label: nodeType,
    category: "leaf" as const,
    color: "#6b7280",
  };
}

function healthMeta(status: string) {
  return HEALTH_STATUS_META[status] ?? HEALTH_STATUS_META.unknown;
}

function isSiteType(node: TopologyNode): boolean {
  return node.node_type === "site";
}

function isSwitchType(node: TopologyNode): boolean {
  return node.node_type === "switch" || node.node_type === "core_switch"
    || node.node_type === "distribution_switch" || node.node_type === "access_switch";
}

function ParentSection({
  label,
  icon,
  parents,
}: {
  label: string;
  icon: React.ReactNode;
  parents: TopologyNode[];
}) {
  if (parents.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        {icon}
        {label}
      </div>
      <div className="space-y-1.5">
        {parents.map((parent) => {
          const pMeta = deviceTypeMeta(parent.node_type);
          return (
            <div key={parent.node_id} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: pMeta.color }}
              />
              <span className="truncate font-mono text-xs text-foreground-muted">
                {parent.name || parent.node_id}
              </span>
              <span className="shrink-0 text-[10px] text-foreground-subtle">
                {pMeta.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChildrenSection({
  children,
}: {
  children: TopologyNode[];
}) {
  if (children.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        <ArrowDown className="h-3.5 w-3.5 text-primary" />
        Children ({children.length})
      </div>
      <div className="space-y-1.5">
        {children.slice(0, 10).map((child) => {
          const cMeta = deviceTypeMeta(child.node_type);
          return (
            <div key={child.node_id} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: cMeta.color }}
              />
              <span className="truncate font-mono text-xs text-foreground-muted">
                {child.name || child.node_id}
              </span>
              <span className="shrink-0 text-[10px] text-foreground-subtle">
                {cMeta.label}
              </span>
            </div>
          );
        })}
        {children.length > 10 && (
          <div className="text-xs text-foreground-subtle">
            +{children.length - 10} more
          </div>
        )}
      </div>
    </div>
  );
}

export function NodeDetailPanel({
  nodeDetail,
  loading,
}: NodeDetailPanelProps) {
  if (loading) {
    return (
      <div className="space-y-5 p-5">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!nodeDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Network className="mb-3 h-10 w-10 text-foreground-muted" />
        <p className="text-sm text-foreground-muted">Select a node to view details</p>
      </div>
    );
  }

  const node = nodeDetail.node;
  const meta = deviceTypeMeta(node.node_type);
  const hMeta = healthMeta(node.health_status);

  // Split parents into logical categories
  const siteParents = nodeDetail.parents.filter(isSiteType);
  const switchParents = nodeDetail.parents.filter(isSwitchType);
  const otherParents = nodeDetail.parents.filter(
    (p) => !isSiteType(p) && !isSwitchType(p),
  );

  return (
    <div className="space-y-5 p-5">
      {/* Node Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">
            {node.name || node.node_id}
          </h3>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted">
            <span>{meta.label}</span>
            {node.vendor && (
              <>
                <span>·</span>
                <span>{node.vendor}</span>
              </>
            )}
            {node.model && (
              <>
                <span>·</span>
                <span>{node.model}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Health Status */}
      <div
        className="flex items-center gap-3 rounded-lg border p-4"
        style={{
          borderColor: `${hMeta.color}40`,
          backgroundColor: hMeta.bgColor,
        }}
      >
        <span className="relative inline-flex h-3 w-3 shrink-0">
          <span
            className="relative inline-flex h-3 w-3 rounded-full"
            style={{ backgroundColor: hMeta.color }}
          />
        </span>
        <div>
          <div className="text-sm font-semibold" style={{ color: hMeta.color }}>
            {hMeta.label}
          </div>
          <div className="text-xs text-foreground-muted">Current health status</div>
        </div>
      </div>

      {/* Health History Timeline */}
      <div className="rounded-lg border border-border/40 bg-surface/50 p-4">
        <HealthHistoryChart nodeId={node.node_id} />
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-3">
        <DetailField label="Node ID" value={node.node_id} mono />
        <DetailField label="IP Address" value={node.ip_address} mono />
        <DetailField label="Site ID" value={node.site_id} mono />
        <DetailField label="Site Name" value={node.site_name ?? "—"} />
      </div>

      {/* Parents — split by type */}
      <ParentSection
        label={`Site (${siteParents.length})`}
        icon={<Building className="h-3.5 w-3.5 text-violet-500" />}
        parents={siteParents}
      />
      <ParentSection
        label={`Connected Switch (${switchParents.length})`}
        icon={<Cable className="h-3.5 w-3.5 text-blue-500" />}
        parents={switchParents}
      />
      <ParentSection
        label={`Other Parents (${otherParents.length})`}
        icon={<ArrowUp className="h-3.5 w-3.5 text-primary" />}
        parents={otherParents}
      />

      {/* Children */}
      <ChildrenSection children={nodeDetail.children} />

      {/* Empty neighbor state */}
      {nodeDetail.parents.length === 0 && nodeDetail.children.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 p-4 text-sm text-foreground-muted">
          <Server className="h-4 w-4 shrink-0" />
          No topology neighbors — this node is isolated or a leaf device
        </div>
      )}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-surface/50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-sm text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
