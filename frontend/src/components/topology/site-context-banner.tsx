"use client";

import { useMemo } from "react";
import type { TopologyNode, SiteHealthCounts } from "@/types/topology";
import { getNodeRank } from "./topology-graph-model";

interface SiteContextBannerProps {
  siteName?: string;
  nodes: TopologyNode[];
  totalDevices?: number;
  health?: SiteHealthCounts;
}

function computeChildHealthDistribution(nodes: TopologyNode[]): SiteHealthCounts {
  const d: SiteHealthCounts = { healthy_count: 0, warning_count: 0, critical_count: 0, unknown_count: 0 };
  for (const n of nodes) {
    if (n.node_type === "site") continue;
    const s = n.health_status;
    if (s === "healthy") d.healthy_count++;
    else if (s === "warning") d.warning_count++;
    else if (s === "critical") d.critical_count++;
    else d.unknown_count++;
  }
  return d;
}

function topAlertSentence(nodes: TopologyNode[]): string | null {
  const critical = nodes.filter((n) => n.health_status === "critical" && n.node_type !== "site");
  const warning = nodes.filter((n) => n.health_status === "warning" && n.node_type !== "site");
  if (critical.length === 0 && warning.length === 0) return null;

  const allAlerts = [...critical, ...warning];
  allAlerts.sort((a, b) => getNodeRank(a.node_type) - getNodeRank(b.node_type));
  const top = allAlerts[0];
  const alertCount = critical.length + warning.length;
  const label = top.health_status === "critical" ? "critical" : "degraded";
  return `${alertCount} of ${nodes.filter((n) => n.node_type !== "site").length} devices alerting — ${top.name || top.node_id} ${label}`;
}

export function SiteContextBanner({ siteName, nodes, totalDevices, health }: SiteContextBannerProps) {
  const deviceNodes = useMemo(() => nodes.filter((n) => n.node_type !== "site"), [nodes]);
  const distribution = useMemo(() => health ?? computeChildHealthDistribution(nodes), [health, nodes]);
  const alertText = useMemo(() => topAlertSentence(nodes), [nodes]);
  const total = totalDevices ?? deviceNodes.length;

  const healthParts: string[] = [];
  if (distribution.critical_count > 0) healthParts.push(`${distribution.critical_count} critical`);
  if (distribution.warning_count > 0) healthParts.push(`${distribution.warning_count} warning`);
  if (distribution.healthy_count > 0) healthParts.push(`${distribution.healthy_count} healthy`);
  if (distribution.unknown_count > 0) healthParts.push(`${distribution.unknown_count} unknown`);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-bold text-white">{siteName || "Site Topology"}</h2>
        <span className="text-xs text-slate-500">
          {total} devices{healthParts.length > 0 && ` · ${healthParts.join(" · ")}`}
        </span>
      </div>
      {alertText ? (
        <p className="text-xs text-rose-400">{alertText}</p>
      ) : (
        <p className="text-xs text-emerald-500">All devices healthy</p>
      )}
    </div>
  );
}
