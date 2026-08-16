"use client";

/**
 * Worst Offenders Strip
 *
 * Compact inline list of the most impactful alerting devices.
 * No cards, no borders — just typography and color.
 */

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { HEALTH_STATUS_META, NODE_TYPE_META } from "@/types/topology";
import { rankWorstOffenders } from "@/lib/large-site-utils";

import { getHumanReadableDeviceRole, getHumanReadableDiagnosticIssue } from "@/lib/large-site-utils";

interface WorstOffendersStripProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onSelect: (nodeId: string, nodeName: string) => void;
  limit?: number;
}

export function WorstOffendersStrip({ nodes, edges, onSelect, limit = 8 }: WorstOffendersStripProps) {
  const offenders = useMemo(
    () => rankWorstOffenders(nodes, edges, limit),
    [nodes, edges, limit],
  );

  if (offenders.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="worst-offenders-strip">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
        Critical worst offenders
      </div>
      <div className="flex flex-col gap-1.5 text-xs">
        {offenders.map(({ node, downstreamCount }) => {
          const meta = HEALTH_STATUS_META[node.health_status] ?? HEALTH_STATUS_META.unknown;
          const roleLabel = getHumanReadableDeviceRole(node.node_type);
          const vendorModel = [node.vendor?.toUpperCase(), node.model].filter(Boolean).join(" ");
          const issue = getHumanReadableDiagnosticIssue(node);

          return (
            <button
              key={node.node_id}
              data-testid={`offender-${node.node_id}`}
              onClick={() => onSelect(node.node_id, node.name || node.node_id)}
              className="group flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-border/40 bg-surface/50 px-3 py-1.5 text-left transition-colors hover:bg-surface hover:border-rose-500/40 cursor-pointer"
              title={`${roleLabel} ${node.name || node.node_id} — ${issue}`}
            >
              <span className="h-2 w-2 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: meta.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle">
                {roleLabel}
              </span>
              <span className="font-bold text-foreground group-hover:text-primary">
                {node.name || node.node_id}
              </span>
              {vendorModel && (
                <span className="text-[10px] font-mono text-foreground-muted">
                  ({vendorModel})
                </span>
              )}
              <span className="text-[11px] font-medium" style={{ color: meta.color }}>
                — {issue}
              </span>
              {downstreamCount > 0 && (
                <span className="text-[10px] font-semibold text-rose-400 ml-auto">
                  → {downstreamCount} downstream {downstreamCount === 1 ? "device" : "devices"} impacted
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
