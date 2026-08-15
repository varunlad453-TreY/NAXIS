/**
 * Large-site topology utilities
 *
 * Pure, testable logic powering the readable large-site experience:
 * alert-scoped subgraphs, worst-offender ranking, downstream blast
 * counts, and per-parent leaf collapsing.
 *
 * Edge direction model (matches topology-layout-engine):
 *   edge.src_id = child / downstream node
 *   edge.dst_id = parent / upstream node
 */

import type { TopologyNode, TopologyEdge, SiteHealthCounts } from "@/types/topology";

export const ALERTING_STATUSES: ReadonlySet<string> = new Set(["critical", "warning"]);

export function isAlerting(node: TopologyNode): boolean {
  return ALERTING_STATUSES.has(node.health_status);
}

// ---------------------------------------------------------------------------
// Adjacency maps
// ---------------------------------------------------------------------------

/** Build adjacency: direction="up" → childId→parentIds; "down" → parentId→childIds. */
export function buildAdjacencyMap(
  edges: TopologyEdge[],
  direction: "up" | "down"
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const key = direction === "up" ? "src_id" : "dst_id";
  const val = direction === "up" ? "dst_id" : "src_id";
  for (const e of edges) {
    if (e.src_id === e.dst_id) continue;
    const list = map.get(e[key]);
    if (list) list.push(e[val]);
    else map.set(e[key], [e[val]]);
  }
  return map;
}

/** childId → parentIds (upstream). */
export function buildParentMap(edges: TopologyEdge[]): Map<string, string[]> {
  return buildAdjacencyMap(edges, "up");
}

/** parentId → childIds (downstream). */
export function buildChildrenMap(edges: TopologyEdge[]): Map<string, string[]> {
  return buildAdjacencyMap(edges, "down");
}

// ---------------------------------------------------------------------------
// Alert scope — alerting nodes plus their upstream ancestors for context
// ---------------------------------------------------------------------------

/**
 * Returns the set of node ids that are alerting (critical/warning) plus
 * every ancestor on an upstream path from them, so a layered layout keeps
 * enough parents to explain *where* the pain sits. Site nodes are kept too.
 */
export function computeAlertScope(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): Set<string> {
  const parents = buildParentMap(edges);
  const scope = new Set<string>();

  for (const n of nodes) {
    if (n.node_type === "site") scope.add(n.node_id);
  }

  const stack: string[] = [];
  for (const n of nodes) {
    if (isAlerting(n) && !scope.has(n.node_id)) stack.push(n.node_id);
  }

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (scope.has(id)) continue;
    scope.add(id);
    for (const p of parents.get(id) ?? []) {
      if (!scope.has(p)) stack.push(p);
    }
  }
  return scope;
}

// ---------------------------------------------------------------------------
// Downstream blast counts
// ---------------------------------------------------------------------------

/** Number of unique downstream descendants reachable from each given node. */
export function computeDownstreamCounts(
  nodeIds: string[],
  edges: TopologyEdge[],
): Map<string, number> {
  const children = buildChildrenMap(edges);
  const counts = new Map<string, number>();
  for (const id of nodeIds) {
    const seen = new Set<string>([id]); // seed excluded from its own blast count
    const stack = [...(children.get(id) ?? [])];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of children.get(cur) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }
    counts.set(id, seen.size - 1); // exclude the seed itself
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Worst offenders
// ---------------------------------------------------------------------------

export interface WorstOffender {
  node: TopologyNode;
  downstreamCount: number;
}

export function severityWeight(status: string): number {
  if (status === "critical") return 3;
  if (status === "warning") return 2;
  if (status === "unknown") return 1;
  return 0;
}

/**
 * Ranks alerting devices by operational impact:
 * critical before warning, then larger downstream blast radius, then name.
 */
export function rankWorstOffenders(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  limit = 8,
): WorstOffender[] {
  const alerting = nodes.filter((n) => n.node_type !== "site" && isAlerting(n));
  if (alerting.length === 0) return [];

  const counts = computeDownstreamCounts(alerting.map((n) => n.node_id), edges);
  return alerting
    .map((node) => ({ node, downstreamCount: counts.get(node.node_id) ?? 0 }))
    .sort((a, b) => {
      const sev = severityWeight(b.node.health_status) - severityWeight(a.node.health_status);
      if (sev !== 0) return sev;
      if (b.downstreamCount !== a.downstreamCount) return b.downstreamCount - a.downstreamCount;
      return (a.node.name || a.node.node_id).localeCompare(b.node.name || b.node.node_id);
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Per-parent leaf collapsing
// ---------------------------------------------------------------------------

export interface CollapsedLeafGroup {
  /** Synthetic node id: `collapsed:{parentId}:{rank}` */
  id: string;
  parentId: string;
  parentName: string;
  rank: number;
  children: TopologyNode[];
  health: SiteHealthCounts;
  worstChildName: string | null;
}

export interface LeafCollapseResult {
  /** Nodes still rendered as themselves (excludes hidden children). */
  keptNodes: TopologyNode[];
  groups: CollapsedLeafGroup[];
  /** hiddenChildId → synthetic group id, for edge remapping. */
  hiddenToGroup: Map<string, string>;
}

const COLLAPSIBLE_MIN_RANK = 5; // wireless + endpoints only

/**
 * Collapses leaf children (rank >= 5: APs, clients, endpoints…) under a
 * shared parent into one synthetic group node when the parent has at least
 * `minGroupSize` such siblings. Expanded groups (ids in `expandedGroups`)
 * are left untouched.
 */
export function collapseLeafSiblings(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  options: { minGroupSize?: number; expandedGroups?: Set<string>; getRank?: (nodeType: string) => number } = {},
): LeafCollapseResult {
  const { minGroupSize = 4, expandedGroups = new Set<string>(), getRank } = options;
  const rankOf = getRank ?? (() => COLLAPSIBLE_MIN_RANK);

  const nodeById = new Map(nodes.map((n) => [n.node_id, n]));
  const parents = buildParentMap(edges);

  // Bucket collapsible children by (parentId, rank)
  const buckets = new Map<string, { parentId: string; rank: number; children: TopologyNode[] }>();
  for (const n of nodes) {
    if (n.node_type === "site") continue;
    const rank = rankOf(n.node_type);
    if (rank < COLLAPSIBLE_MIN_RANK) continue;
    for (const parentId of parents.get(n.node_id) ?? []) {
      if (!nodeById.has(parentId)) continue;
      const key = `${parentId}::${rank}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.children.push(n);
      else buckets.set(key, { parentId, rank, children: [n] });
    }
  }

  const groups: CollapsedLeafGroup[] = [];
  const hiddenToGroup = new Map<string, string>();

  for (const bucket of buckets.values()) {
    if (bucket.children.length < minGroupSize) continue;
    const groupId = `collapsed:${bucket.parentId}:${bucket.rank}`;
    if (expandedGroups.has(groupId)) continue;

    const parent = nodeById.get(bucket.parentId)!;
    const health: SiteHealthCounts = { healthy_count: 0, warning_count: 0, critical_count: 0, unknown_count: 0 };
    let worstChildName: string | null = null;
    let worstSev = -1;
    for (const c of bucket.children) {
      if (c.health_status === "healthy") health.healthy_count++;
      else if (c.health_status === "warning") health.warning_count++;
      else if (c.health_status === "critical") health.critical_count++;
      else health.unknown_count++;
      const sev = severityWeight(c.health_status);
      if (sev > worstSev) {
        worstSev = sev;
        worstChildName = c.name || c.node_id;
      }
      hiddenToGroup.set(c.node_id, groupId);
    }

    groups.push({
      id: groupId,
      parentId: bucket.parentId,
      parentName: parent.name || parent.node_id,
      rank: bucket.rank,
      children: [...bucket.children].sort((a, b) => {
        const sev = severityWeight(b.health_status) - severityWeight(a.health_status);
        return sev !== 0 ? sev : (a.name || a.node_id).localeCompare(b.name || b.node_id);
      }),
      health,
      worstChildName: worstSev > 0 ? worstChildName : null,
    });
  }

  if (groups.length === 0) {
    return { keptNodes: nodes, groups, hiddenToGroup };
  }

  const keptNodes = nodes.filter((n) => !hiddenToGroup.has(n.node_id));
  return { keptNodes, groups, hiddenToGroup };
}

/**
 * Remaps edges so endpoints hidden inside a collapsed group are replaced by
 * the synthetic group id, drops edges that no longer connect two rendered
 * nodes, and dedupes the result.
 */
export function remapEdgesForCollapsedGroups(
  edges: TopologyEdge[],
  hiddenToGroup: Map<string, string>,
  keptNodeIds: Set<string>,
): TopologyEdge[] {
  if (hiddenToGroup.size === 0) return edges;
  const isRendered = (id: string) => keptNodeIds.has(id) || id.startsWith("collapsed:");
  const seen = new Set<string>();
  const out: TopologyEdge[] = [];
  for (const e of edges) {
    const src = hiddenToGroup.get(e.src_id) ?? e.src_id;
    const dst = hiddenToGroup.get(e.dst_id) ?? e.dst_id;
    if (src === dst) continue;
    if (!isRendered(src) || !isRendered(dst)) continue;
    const key = `${src}→${dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, src_id: src, dst_id: dst });
  }
  return out;
}
