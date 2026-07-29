import type { TopologyNode, DeviceCategory, DeviceCategoryCluster, HealthStatus, SiteHealthCounts } from "@/types/topology";
import { HEALTH_STATUS_META, NODE_TYPE_META } from "@/types/topology";

export function deriveAggregatedHealth(site: TopologyNode): { color: string; label: string } {
  const cc = site.critical_count ?? 0;
  const wc = site.warning_count ?? 0;

  if (cc > 0) return HEALTH_STATUS_META.critical;
  if (wc > 0) return HEALTH_STATUS_META.warning;

  const status = site.health_status ?? "unknown";
  return HEALTH_STATUS_META[status] ?? HEALTH_STATUS_META.unknown;
}

export function getDeviceCategory(nodeType: string): DeviceCategory {
  const meta = NODE_TYPE_META[nodeType];
  return meta?.category ?? "leaf";
}

export function aggregateByCategory(nodes: TopologyNode[]): DeviceCategoryCluster[] {
  const map = new Map<DeviceCategory, { nodeIds: string[]; types: Map<string, number>; health: SiteHealthCounts }>();

  for (const n of nodes) {
    const cat = getDeviceCategory(n.node_type);
    if (!map.has(cat)) {
      map.set(cat, { nodeIds: [], types: new Map(), health: { healthy_count: 0, warning_count: 0, critical_count: 0, unknown_count: 0 } });
    }
    const entry = map.get(cat)!;
    entry.nodeIds.push(n.node_id);
    entry.types.set(n.node_type, (entry.types.get(n.node_type) ?? 0) + 1);

    const hs = (n.health_status ?? "unknown").toLowerCase();
    if (hs === "critical") entry.health.critical_count++;
    else if (hs === "warning") entry.health.warning_count++;
    else if (hs === "healthy") entry.health.healthy_count++;
    else entry.health.unknown_count++;
  }

  const clusters: DeviceCategoryCluster[] = [];
  for (const [cat, entry] of map) {
    const meta = NODE_TYPE_META[cat] ?? { label: cat, category: cat, color: "#6b7280" };
    let aggHealth: HealthStatus = "healthy";
    if (entry.health.critical_count > 0) aggHealth = "critical";
    else if (entry.health.warning_count > 0) aggHealth = "warning";
    else if (entry.health.unknown_count > 0 && entry.health.healthy_count === 0) aggHealth = "unknown";

    const deviceTypes = [...entry.types.entries()]
      .map(([type, count]) => ({ type, label: NODE_TYPE_META[type]?.label ?? type, count }))
      .sort((a, b) => b.count - a.count);

    clusters.push({
      category: cat,
      label: meta.label ?? cat,
      count: entry.nodeIds.length,
      nodeIds: entry.nodeIds,
      healthDistribution: entry.health,
      aggregatedHealth: aggHealth,
      deviceTypes,
    });
  }

  return clusters.sort((a, b) => b.count - a.count);
}
