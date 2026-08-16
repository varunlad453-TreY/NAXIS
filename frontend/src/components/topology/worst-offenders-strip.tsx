"use client";

/**
 * Worst Offenders Strip
 *
 * Compact inline list of the most impactful alerting devices.
 * No cards, no borders — just typography and color.
 */

import { useState, useMemo } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { HEALTH_STATUS_META } from "@/types/topology";
import { rankWorstOffenders, getHumanReadableDeviceRole, getHumanReadableDiagnosticIssue } from "@/lib/large-site-utils";

interface WorstOffendersStripProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onSelect: (nodeId: string, nodeName: string) => void;
  limit?: number;
}

export function WorstOffendersStrip({ nodes, edges, onSelect, limit = 8 }: WorstOffendersStripProps) {
  const [expanded, setExpanded] = useState(false);

  const offenders = useMemo(
    () => rankWorstOffenders(nodes, edges, limit),
    [nodes, edges, limit],
  );

  if (offenders.length === 0) return null;

  const topOffender = offenders[0];
  const topMeta = HEALTH_STATUS_META[topOffender.node.health_status] ?? HEALTH_STATUS_META.unknown;
  const topRole = getHumanReadableDeviceRole(topOffender.node.node_type);
  const topVendorModel = [topOffender.node.vendor?.toUpperCase(), topOffender.node.model].filter(Boolean).join(" ");
  const topIssue = getHumanReadableDiagnosticIssue(topOffender.node);

  return (
    <div className="py-1" data-testid="worst-offenders-strip">
      {/* Header / 1-Line Compact NOC Incident Bar */}
      <div className="flex items-center justify-between gap-3 text-xs py-1 px-1.5 rounded bg-slate-900/60 border border-rose-500/20">
        <button
          data-testid={`offender-${topOffender.node.node_id}`}
          onClick={() => onSelect(topOffender.node.node_id, topOffender.node.name || topOffender.node.node_id)}
          className="group flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
          title={`Top Incident: ${topRole} ${topOffender.node.name || topOffender.node.node_id}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 shrink-0">
            Critical Offender:
          </span>
          <span className="h-1.5 w-1.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: topMeta.color }} />
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 shrink-0">
            {topRole}
          </span>
          <span className="font-bold text-slate-200 group-hover:text-white truncate">
            {topOffender.node.name || topOffender.node.node_id}
          </span>
          {topVendorModel && (
            <span className="text-[10px] font-mono text-slate-500 truncate hidden sm:inline">
              ({topVendorModel})
            </span>
          )}
          <span className="text-[11px] font-medium text-rose-400/90 truncate min-w-0 hidden md:inline">
            — {topIssue}
          </span>
          {topOffender.downstreamCount > 0 && (
            <span className="text-[10px] font-semibold text-rose-400 shrink-0 font-mono">
              → {topOffender.downstreamCount} affected
            </span>
          )}
        </button>

        {/* Expand / Collapse Control */}
        {offenders.length > 1 && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white shrink-0 cursor-pointer px-1.5 py-0.5 rounded hover:bg-slate-800/60 transition-colors"
          >
            <span>{expanded ? "Collapse ▲" : `+${offenders.length - 1} more ▾`}</span>
          </button>
        )}
      </div>

      {/* Expanded Table — Cardless dense operational rows */}
      {expanded && (
        <div className="mt-2 divide-y divide-slate-800/40 text-xs border-t border-slate-800/60 pt-1">
          {offenders.map(({ node, downstreamCount }, idx) => {
            const meta = HEALTH_STATUS_META[node.health_status] ?? HEALTH_STATUS_META.unknown;
            const roleLabel = getHumanReadableDeviceRole(node.node_type);
            const vendorModel = [node.vendor?.toUpperCase(), node.model].filter(Boolean).join(" ");
            const issue = getHumanReadableDiagnosticIssue(node);

            return (
              <button
                key={node.node_id}
                data-testid={`offender-${node.node_id}`}
                onClick={() => onSelect(node.node_id, node.name || node.node_id)}
                className="group flex w-full items-center gap-3 py-1.5 text-left transition-colors hover:bg-slate-900/50 px-1 cursor-pointer"
                title={`${roleLabel} ${node.name || node.node_id} — ${issue}`}
              >
                {/* Column 1: Index & Pulse Status */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] text-slate-600 font-bold w-4">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="h-2 w-2 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: meta.color }} />
                </div>

                {/* Column 2: Monospace Device Role */}
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 shrink-0 min-w-[110px]">
                  {roleLabel}
                </span>

                {/* Column 3: Name & Model */}
                <div className="flex items-baseline gap-1.5 min-w-0 shrink-0 max-w-[240px]">
                  <span className="font-bold text-slate-200 group-hover:text-white truncate">
                    {node.name || node.node_id}
                  </span>
                  {vendorModel && (
                    <span className="text-[10px] font-mono text-slate-500 truncate">
                      ({vendorModel})
                    </span>
                  )}
                </div>

                {/* Column 4: Operational Diagnostic Issue */}
                <span className="text-[11px] font-medium text-rose-400/90 truncate min-w-0 flex-1">
                  — {issue}
                </span>

                {/* Column 5: Downstream Blast Radius Impact */}
                {downstreamCount > 0 && (
                  <span className="text-[10px] font-semibold text-rose-400 shrink-0 ml-auto font-mono">
                    → {downstreamCount} affected
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
