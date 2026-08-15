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
    <div className="space-y-1" data-testid="worst-offenders-strip">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
        <AlertTriangle className="h-3 w-3 text-rose-400" />
        Worst offenders
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {offenders.map(({ node, downstreamCount }) => {
          const meta = HEALTH_STATUS_META[node.health_status] ?? HEALTH_STATUS_META.unknown;
          const typeLabel = NODE_TYPE_META[node.node_type]?.label ?? node.node_type;
          return (
            <button
              key={node.node_id}
              data-testid={`offender-${node.node_id}`}
              onClick={() => onSelect(node.node_id, node.name || node.node_id)}
              className="group inline-flex items-center gap-2 py-1 text-left transition-colors hover:text-slate-300"
              title={node.health_label || meta.label}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
              <span className="font-semibold text-slate-300 group-hover:text-white">
                {node.name || node.node_id}
              </span>
              <span className="text-[10px] uppercase font-bold" style={{ color: meta.color }}>
                {node.health_status}
              </span>
              <span className="text-slate-600">{typeLabel}</span>
              {downstreamCount > 0 && (
                <span className="text-slate-600">
                  → {downstreamCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
