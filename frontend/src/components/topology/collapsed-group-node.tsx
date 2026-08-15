"use client";

/**
 * Collapsed Group Node
 *
 * Synthetic reactflow node representing a bundle of leaf siblings
 * (e.g. 24 APs under one switch) collapsed into a single readable badge.
 * Shows aggregate health and the worst child; clicking expands the branch.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Layers } from "lucide-react";
import { HEALTH_STATUS_META, NODE_TYPE_META } from "@/types/topology";
import type { CollapsedLeafGroup } from "@/lib/large-site-utils";

export const COLLAPSED_GROUP_WIDTH = 170;
export const COLLAPSED_GROUP_HEIGHT = 40;

function CollapsedGroupNodeComponent({ data }: NodeProps) {
  const group = data.collapsedGroup as CollapsedLeafGroup;
  const { health } = group;

  const dominant =
    health.critical_count > 0
      ? HEALTH_STATUS_META.critical
      : health.warning_count > 0
        ? HEALTH_STATUS_META.warning
        : health.healthy_count > 0
          ? HEALTH_STATUS_META.healthy
          : HEALTH_STATUS_META.unknown;

  const typeLabel =
    NODE_TYPE_META[group.children[0]?.node_type ?? ""]?.label ?? "Devices";

  return (
    <div
      className="flex cursor-pointer items-center gap-2 border border-dashed border-slate-600 bg-slate-900 px-2 py-1.5"
      style={{ width: COLLAPSED_GROUP_WIDTH }}
      title={`${group.children.length} ${typeLabel}s under ${group.parentName} — click to expand`}
    >
      <Handle type="target" position={Position.Top} className="!border-slate-600 !bg-slate-800" />
      <Layers className="h-3 w-3 shrink-0 text-slate-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-slate-300">
          ▸ {group.children.length} {typeLabel}s
        </div>
        <div className="flex items-center gap-1.5 text-[9px]">
          {health.critical_count > 0 && (
            <span className="font-semibold" style={{ color: HEALTH_STATUS_META.critical.color }}>
              {health.critical_count} crit
            </span>
          )}
          {health.warning_count > 0 && (
            <span className="font-semibold" style={{ color: HEALTH_STATUS_META.warning.color }}>
              {health.warning_count} warn
            </span>
          )}
          {health.critical_count === 0 && health.warning_count === 0 && (
            <span className="text-slate-500">all ok</span>
          )}
          {group.worstChildName && (
            <span className="truncate text-slate-500">· {group.worstChildName}</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!border-slate-600 !bg-slate-800" />
    </div>
  );
}

export const CollapsedGroupNode = memo(CollapsedGroupNodeComponent);
