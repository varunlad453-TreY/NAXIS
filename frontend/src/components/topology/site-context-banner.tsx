"use client";

import { useMemo } from "react";
import type { TopologyNode, SiteHealthCounts } from "@/types/topology";
import { getNodeRank } from "./topology-graph-model";
import { getHumanReadableAlertMessage } from "@/lib/large-site-utils";

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
  const nonSiteNodes = nodes.filter((n) => n.node_type !== "site");

  const alertDetail = getHumanReadableAlertMessage(top);
  return `${alertCount} of ${nonSiteNodes.length} devices alerting — ${alertDetail}`;
}

export function SiteContextBanner({ nodes }: SiteContextBannerProps) {
  const alertText = useMemo(() => topAlertSentence(nodes), [nodes]);
  if (!alertText) return null;

  return (
    <div className="relative border-l-2 border-rose-500 pl-3 py-1 my-2" data-testid="site-context-banner">
      <p className="text-xs font-semibold tracking-tight text-rose-400">
        {alertText}
      </p>
    </div>
  );
}
