"use client";

import { useState } from "react";
import type { TopologyNodeDetail, TopologyNode } from "@/types/topology";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "@/types/topology";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, ArrowUp, ArrowDown, Network, Building, Cable, Zap, Route, ExternalLink } from "lucide-react";
import { HealthHistoryChart } from "./health-history-chart";

interface NodeDetailPanelProps {
  nodeDetail?: TopologyNodeDetail | null;
  loading?: boolean;
  onPathTrace?: () => void;
  onBlastRadius?: () => void;
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
  const [expanded, setExpanded] = useState(false);
  if (parents.length === 0) return null;
  const visibleParents = expanded ? parents : parents.slice(0, 10);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        {icon}
        <span>{label}</span>
      </div>
      <div className="space-y-1">
        {visibleParents.map((parent) => {
          const pMeta = deviceTypeMeta(parent.node_type);
          return (
            <div key={parent.node_id} className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-surface/50 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: pMeta.color }}
                />
                <span className="truncate font-mono text-xs text-foreground-muted">
                  {parent.name || parent.node_id}
                </span>
              </div>
              <span className="shrink-0 text-[10px] font-mono text-foreground-subtle">
                {pMeta.label}
              </span>
            </div>
          );
        })}
        {parents.length > 10 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="pt-1 text-xs font-medium text-primary hover:underline focus:outline-none cursor-pointer"
          >
            {expanded ? "Show less" : `+${parents.length - 10} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function ChildrenSection({
  children,
}: {
  children: TopologyNode[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (children.length === 0) return null;
  const visibleChildren = expanded ? children : children.slice(0, 10);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        <ArrowDown className="h-3.5 w-3.5 text-primary" />
        <span>Children ({children.length})</span>
      </div>
      <div className="space-y-1">
        {visibleChildren.map((child) => {
          const cMeta = deviceTypeMeta(child.node_type);
          return (
            <div key={child.node_id} className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-surface/50 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: cMeta.color }}
                />
                <span className="truncate font-mono text-xs text-foreground-muted">
                  {child.name || child.node_id}
                </span>
              </div>
              <span className="shrink-0 text-[10px] font-mono text-foreground-subtle">
                {cMeta.label}
              </span>
            </div>
          );
        })}
        {children.length > 10 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="pt-1 text-xs font-medium text-primary hover:underline focus:outline-none cursor-pointer"
          >
            {expanded ? "Show less" : `+${children.length - 10} more`}
          </button>
        )}
      </div>
    </div>
  );
}

export function NodeDetailPanel({
  nodeDetail,
  loading,
  onPathTrace,
  onBlastRadius,
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
    <div className="space-y-6 p-6">
      {/* Operational Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold tracking-tight text-foreground">
              {node.name || node.node_id}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted">
              <span className="font-semibold text-foreground">{meta.label}</span>
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
          <a
            href={`/topology/context/${encodeURIComponent(node.node_id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-surface/80 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface hover:border-primary/50 transition-colors cursor-pointer shrink-0"
            title="Open Full Device Page in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5 text-primary" />
            Full Page
          </a>
        </div>

        {/* Health Status — clean typography, zero card box */}
        <div className="flex items-center gap-2 pt-1">
          <span
            className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full animate-pulse"
            style={{ backgroundColor: hMeta.color }}
          />
          <span className="text-sm font-semibold" style={{ color: hMeta.color }}>
            {hMeta.label}
          </span>
          <span className="text-xs text-foreground-subtle">·</span>
          <span className="text-xs text-foreground-muted">Current health status</span>
        </div>
      </div>

      <div className="h-px bg-border/40" />

      {/* Details - Clean Key-Value Layout */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          Attributes
        </div>
        <div className="grid grid-cols-[100px_1fr] gap-x-4 gap-y-2 text-xs">
          <span className="text-foreground-subtle">Node ID</span>
          <span className="truncate font-mono text-foreground select-all">{node.node_id}</span>

          <span className="text-foreground-subtle">IP Address</span>
          <span className="truncate font-mono text-foreground select-all">{node.ip_address || "—"}</span>

          <span className="text-foreground-subtle">Site ID</span>
          <span className="truncate font-mono text-foreground select-all">{node.site_id}</span>

          <span className="text-foreground-subtle">Site Name</span>
          <span className="truncate text-foreground select-all">{node.site_name ?? "—"}</span>
        </div>
      </div>

      <div className="h-px bg-border/40" />

      {/* Health History Timeline */}
      <HealthHistoryChart nodeId={node.node_id} />

      {/* Parents — split by type */}
      {(siteParents.length > 0 || switchParents.length > 0 || otherParents.length > 0) && (
        <div className="space-y-4">
          <ParentSection
            label={`Site (${siteParents.length})`}
            icon={<Building className="h-3.5 w-3.5 text-violet-400" />}
            parents={siteParents}
          />
          <ParentSection
            label={`Connected Switch (${switchParents.length})`}
            icon={<Cable className="h-3.5 w-3.5 text-blue-400" />}
            parents={switchParents}
          />
          <ParentSection
            label={`Other Parents (${otherParents.length})`}
            icon={<ArrowUp className="h-3.5 w-3.5 text-primary" />}
            parents={otherParents}
          />
        </div>
      )}

      {/* Children */}
      <ChildrenSection children={nodeDetail.children} />

      {/* Downstream Impact */}
      {nodeDetail.children.length > 0 && (
        <DownstreamImpactSection children={nodeDetail.children} />
      )}

      {/* Quick Actions */}
      {(onPathTrace || onBlastRadius) && (
        <div className="space-y-2 pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Quick Actions
          </div>
          <div className="flex flex-wrap gap-2">
            {onPathTrace && (
              <button
                onClick={onPathTrace}
                className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-surface/80 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-surface hover:border-primary/50 cursor-pointer"
              >
                <Route className="h-3.5 w-3.5 text-primary" />
                Path to Internet
              </button>
            )}
            {onBlastRadius && (
              <button
                onClick={onBlastRadius}
                className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-surface/80 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-surface hover:border-rose-500/50 cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5 text-rose-500" />
                Blast Radius
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty neighbor state */}
      {nodeDetail.parents.length === 0 && nodeDetail.children.length === 0 && (
        <div className="flex items-center gap-2 py-3 text-xs text-foreground-muted">
          <Server className="h-4 w-4 shrink-0 text-foreground-subtle" />
          No topology neighbors — this node is isolated or a leaf device
        </div>
      )}
    </div>
  );
}

function DownstreamImpactSection({ children }: { children: TopologyNode[] }) {
  const distribution = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
  for (const c of children) {
    if (c.health_status === "healthy") distribution.healthy++;
    else if (c.health_status === "warning") distribution.warning++;
    else if (c.health_status === "critical") distribution.critical++;
    else distribution.unknown++;
  }
  const total = children.length;
  const alerting = distribution.critical + distribution.warning;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        <ArrowDown className="h-3.5 w-3.5 text-primary" />
        <span>Downstream Impact</span>
      </div>
      <div className="text-xs space-y-1">
        <div className="flex items-baseline gap-1.5 text-foreground">
          <span className="font-semibold">{total}</span>
          <span className="text-foreground-muted">direct downstream devices</span>
        </div>
        {alerting > 0 ? (
          <div className="flex flex-wrap gap-2 pt-0.5">
            {distribution.critical > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-400">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                {distribution.critical} critical
              </span>
            )}
            {distribution.warning > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {distribution.warning} warning
              </span>
            )}
            {distribution.healthy > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {distribution.healthy} healthy
              </span>
            )}
          </div>
        ) : (
          <div className="text-emerald-400 font-medium">All downstream devices healthy</div>
        )}
      </div>
    </div>
  );
}
