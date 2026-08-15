import type {
  TopologyNode,
  DeviceCategory,
  DeviceCategoryCluster,
  SiteHealthCounts,
  HealthStatus,
} from "@/types/topology";
import { NODE_TYPE_META, CATEGORY_META } from "@/types/topology";

export const CATEGORY_ORDER: DeviceCategory[] = ["core_network", "edge_security", "wireless", "leaf"];

export function getDeviceCategory(node: TopologyNode): DeviceCategory {
  return NODE_TYPE_META[node.node_type]?.category ?? "leaf";
}

export function computeHealthDistribution(nodes: TopologyNode[]): SiteHealthCounts {
  const d: SiteHealthCounts = { healthy_count: 0, warning_count: 0, critical_count: 0, unknown_count: 0 };
  for (const n of nodes) {
    const s = n.health_status;
    if (s === "healthy") d.healthy_count++;
    else if (s === "warning") d.warning_count++;
    else if (s === "critical") d.critical_count++;
    else d.unknown_count++;
  }
  return d;
}

export function aggregateHealth(distribution: SiteHealthCounts): HealthStatus {
  if (distribution.critical_count > 0) return "critical";
  if (distribution.warning_count > 0) return "warning";
  if (distribution.healthy_count > 0) return "healthy";
  return "unknown";
}

export function aggregateByCategory(nodes: TopologyNode[]): DeviceCategoryCluster[] {
  const byCategory = new Map<DeviceCategory, TopologyNode[]>();
  for (const n of nodes) {
    const cat = getDeviceCategory(n);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(n);
  }

  const clusters: DeviceCategoryCluster[] = [];
  for (const [cat, catNodes] of byCategory) {
    const meta = CATEGORY_META[cat];
    const distribution = computeHealthDistribution(catNodes);
    const typeCounts = new Map<string, number>();
    for (const n of catNodes) {
      typeCounts.set(n.node_type, (typeCounts.get(n.node_type) || 0) + 1);
    }
    // Worst device: critical beats warning, then alphabetical for stability
    const alerting = catNodes
      .filter((n) => n.health_status === "critical" || n.health_status === "warning")
      .sort((a, b) => {
        if (a.health_status !== b.health_status) return a.health_status === "critical" ? -1 : 1;
        return (a.name || a.node_id).localeCompare(b.name || b.node_id);
      });
    clusters.push({
      category: cat,
      label: meta.label,
      count: catNodes.length,
      nodeIds: catNodes.map((n) => n.node_id),
      healthDistribution: distribution,
      aggregatedHealth: aggregateHealth(distribution),
      deviceTypes: Array.from(typeCounts.entries())
        .map(([type, count]) => ({
          type,
          label: NODE_TYPE_META[type]?.label ?? type,
          count,
        }))
        .sort((a, b) => b.count - a.count),
      worstDevice: alerting[0]
        ? { node_id: alerting[0].node_id, name: alerting[0].name || alerting[0].node_id, health_status: alerting[0].health_status }
        : undefined,
    });
  }

  // Pain-first ordering: most critical devices first, then most warnings,
  // then architectural category order as the tiebreak.
  return clusters.sort((a, b) => {
    const crit = b.healthDistribution.critical_count - a.healthDistribution.critical_count;
    if (crit !== 0) return crit;
    const warn = b.healthDistribution.warning_count - a.healthDistribution.warning_count;
    if (warn !== 0) return warn;
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });
}

export function deriveAggregatedHealth(node: TopologyNode): {
  status: string;
  label: string;
  color: string;
} {
  const dc = node.device_count ?? 0;
  const cc = node.critical_count ?? 0;
  const wc = node.warning_count ?? 0;
  if (dc === 0) return { status: "unknown", label: "No devices", color: "#6b7280" };
  if (cc > 0) return { status: "critical", label: `${cc} critical`, color: "#ef4444" };
  if (wc > 0) return { status: "warning", label: `${wc} warning`, color: "#eab308" };
  return { status: "healthy", label: "All healthy", color: "#22c55e" };
}
