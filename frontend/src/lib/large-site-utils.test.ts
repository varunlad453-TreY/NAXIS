import { describe, it, expect } from "vitest";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import {
  isAlerting,
  buildParentMap,
  buildChildrenMap,
  computeAlertScope,
  computeDownstreamCounts,
  rankWorstOffenders,
  collapseLeafSiblings,
  remapEdgesForCollapsedGroups,
} from "./large-site-utils";
import { getNodeRank } from "@/components/topology/topology-graph-model";

function makeNode(overrides: Partial<TopologyNode>): TopologyNode {
  return {
    node_id: "n",
    node_type: "ap",
    name: "n",
    ip_address: "",
    vendor: "",
    model: "",
    site_id: "s1",
    site_name: null,
    health_status: "healthy",
    health_label: "Healthy",
    ...overrides,
  };
}

function edge(child: string, parent: string): TopologyEdge {
  return { src_id: child, dst_id: parent, edge_type: "uplink" };
}

describe("isAlerting", () => {
  it("treats critical and warning as alerting", () => {
    expect(isAlerting(makeNode({ health_status: "critical" }))).toBe(true);
    expect(isAlerting(makeNode({ health_status: "warning" }))).toBe(true);
  });
  it("treats healthy and unknown as not alerting", () => {
    expect(isAlerting(makeNode({ health_status: "healthy" }))).toBe(false);
    expect(isAlerting(makeNode({ health_status: "unknown" }))).toBe(false);
  });
});

describe("adjacency maps", () => {
  it("buildParentMap maps child → parents", () => {
    const m = buildParentMap([edge("ap1", "sw1"), edge("sw1", "core1")]);
    expect(m.get("ap1")).toEqual(["sw1"]);
    expect(m.get("sw1")).toEqual(["core1"]);
  });
  it("buildChildrenMap maps parent → children", () => {
    const m = buildChildrenMap([edge("ap1", "sw1"), edge("ap2", "sw1")]);
    expect(m.get("sw1")).toEqual(["ap1", "ap2"]);
  });
  it("ignores self-loops", () => {
    expect(buildParentMap([edge("a", "a")]).size).toBe(0);
    expect(buildChildrenMap([edge("a", "a")]).size).toBe(0);
  });
});

describe("computeAlertScope", () => {
  const nodes = [
    makeNode({ node_id: "site1", node_type: "site" }),
    makeNode({ node_id: "core1", node_type: "core_switch" }),
    makeNode({ node_id: "sw1", node_type: "switch" }),
    makeNode({ node_id: "sw2", node_type: "switch" }),
    makeNode({ node_id: "ap1", health_status: "critical" }),
    makeNode({ node_id: "ap2", health_status: "healthy" }),
    makeNode({ node_id: "ap3", health_status: "warning" }),
  ];
  const edges = [
    edge("sw1", "core1"),
    edge("sw2", "core1"),
    edge("ap1", "sw1"),
    edge("ap2", "sw1"),
    edge("ap3", "sw2"),
  ];

  it("includes alerting nodes and all their upstream ancestors", () => {
    const scope = computeAlertScope(nodes, edges);
    expect(scope.has("ap1")).toBe(true);
    expect(scope.has("ap3")).toBe(true);
    expect(scope.has("sw1")).toBe(true); // parent of ap1
    expect(scope.has("sw2")).toBe(true); // parent of ap3
    expect(scope.has("core1")).toBe(true); // grandparent
    expect(scope.has("site1")).toBe(true); // site always kept
  });

  it("excludes healthy siblings with no alerting descendants", () => {
    const scope = computeAlertScope(nodes, edges);
    expect(scope.has("ap2")).toBe(false);
  });

  it("returns only site nodes when nothing is alerting", () => {
    const healthy = nodes.map((n) => ({ ...n, health_status: "healthy" }));
    const scope = computeAlertScope(healthy, edges);
    expect([...scope]).toEqual(["site1"]);
  });
});

describe("computeDownstreamCounts", () => {
  const edges = [
    edge("sw1", "core1"),
    edge("ap1", "sw1"),
    edge("ap2", "sw1"),
    edge("c1", "ap1"),
  ];

  it("counts transitive downstream descendants", () => {
    const counts = computeDownstreamCounts(["core1"], edges);
    expect(counts.get("core1")).toBe(4); // sw1, ap1, ap2, c1
  });

  it("returns 0 for leaf nodes", () => {
    const counts = computeDownstreamCounts(["c1"], edges);
    expect(counts.get("c1")).toBe(0);
  });

  it("handles cycles without infinite loops", () => {
    const cyclic = [edge("a", "b"), edge("b", "a")];
    const counts = computeDownstreamCounts(["a"], cyclic);
    expect(counts.get("a")).toBe(1);
  });
});

describe("rankWorstOffenders", () => {
  const nodes = [
    makeNode({ node_id: "site1", node_type: "site", health_status: "critical" }), // excluded: site
    makeNode({ node_id: "sw-big", node_type: "switch", name: "B Switch", health_status: "critical" }),
    makeNode({ node_id: "ap-small", name: "A AP", health_status: "critical" }),
    makeNode({ node_id: "ap-warn", name: "C WarnAP", health_status: "warning" }),
    makeNode({ node_id: "ap-ok", name: "D OkAP", health_status: "healthy" }),
  ];
  const edges = [edge("x1", "sw-big"), edge("x2", "sw-big"), edge("x3", "sw-big")];

  it("excludes sites and healthy devices", () => {
    const result = rankWorstOffenders(nodes, edges);
    const ids = result.map((r) => r.node.node_id);
    expect(ids).not.toContain("site1");
    expect(ids).not.toContain("ap-ok");
  });

  it("ranks critical before warning, then by downstream count", () => {
    const result = rankWorstOffenders(nodes, edges);
    expect(result[0].node.node_id).toBe("sw-big"); // critical + 3 downstream
    expect(result[0].downstreamCount).toBe(3);
    expect(result[1].node.node_id).toBe("ap-small"); // critical, 0 downstream
    expect(result[2].node.node_id).toBe("ap-warn"); // warning last
  });

  it("respects the limit", () => {
    const result = rankWorstOffenders(nodes, edges, 1);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when nothing is alerting", () => {
    const healthy = nodes.map((n) => ({ ...n, health_status: "healthy" }));
    expect(rankWorstOffenders(healthy, edges)).toEqual([]);
  });
});

describe("collapseLeafSiblings", () => {
  function buildSite(apCount: number) {
    const nodes: TopologyNode[] = [
      makeNode({ node_id: "sw1", node_type: "switch", name: "Switch 1" }),
    ];
    const edges: TopologyEdge[] = [];
    for (let i = 0; i < apCount; i++) {
      nodes.push(makeNode({ node_id: `ap${i}`, name: `AP ${i}`, health_status: i === 0 ? "critical" : "healthy" }));
      edges.push(edge(`ap${i}`, "sw1"));
    }
    return { nodes, edges };
  }

  it("collapses leaf siblings at or above minGroupSize", () => {
    const { nodes, edges } = buildSite(5);
    const result = collapseLeafSiblings(nodes, edges, { minGroupSize: 4, getRank: getNodeRank });
    expect(result.groups).toHaveLength(1);
    const g = result.groups[0];
    expect(g.id).toBe("collapsed:sw1:5");
    expect(g.parentId).toBe("sw1");
    expect(g.parentName).toBe("Switch 1");
    expect(g.children).toHaveLength(5);
    expect(g.health.critical_count).toBe(1);
    expect(g.health.healthy_count).toBe(4);
    expect(g.worstChildName).toBe("AP 0");
    // kept nodes = switch only
    expect(result.keptNodes.map((n) => n.node_id)).toEqual(["sw1"]);
    expect(result.hiddenToGroup.size).toBe(5);
  });

  it("leaves small sibling groups untouched", () => {
    const { nodes, edges } = buildSite(3);
    const result = collapseLeafSiblings(nodes, edges, { minGroupSize: 4, getRank: getNodeRank });
    expect(result.groups).toHaveLength(0);
    expect(result.keptNodes).toHaveLength(4);
  });

  it("does not collapse infrastructure ranks (switches stay visible)", () => {
    const nodes = [
      makeNode({ node_id: "core", node_type: "core_switch" }),
      ...[0, 1, 2, 3, 4].map((i) => makeNode({ node_id: `sw${i}`, node_type: "switch" })),
    ];
    const edges = [0, 1, 2, 3, 4].map((i) => edge(`sw${i}`, "core"));
    const result = collapseLeafSiblings(nodes, edges, { minGroupSize: 4, getRank: getNodeRank });
    expect(result.groups).toHaveLength(0);
    expect(result.keptNodes).toHaveLength(6);
  });

  it("skips groups the user has expanded", () => {
    const { nodes, edges } = buildSite(5);
    const result = collapseLeafSiblings(nodes, edges, {
      minGroupSize: 4,
      expandedGroups: new Set(["collapsed:sw1:5"]),
      getRank: getNodeRank,
    });
    expect(result.groups).toHaveLength(0);
    expect(result.keptNodes).toHaveLength(6);
  });

  it("sorts collapsed children worst-first", () => {
    const { nodes, edges } = buildSite(5);
    const result = collapseLeafSiblings(nodes, edges, { minGroupSize: 4, getRank: getNodeRank });
    expect(result.groups[0].children[0].health_status).toBe("critical");
  });
});

describe("remapEdgesForCollapsedGroups", () => {
  it("rewrites hidden endpoints to the group id and dedupes", () => {
    const edges = [edge("ap0", "sw1"), edge("ap1", "sw1"), edge("ap2", "sw1")];
    const hidden = new Map([
      ["ap0", "collapsed:sw1:5"],
      ["ap1", "collapsed:sw1:5"],
      ["ap2", "collapsed:sw1:5"],
    ]);
    const kept = new Set(["sw1"]);
    const out = remapEdgesForCollapsedGroups(edges, hidden, kept);
    expect(out).toHaveLength(1);
    expect(out[0].src_id).toBe("collapsed:sw1:5");
    expect(out[0].dst_id).toBe("sw1");
  });

  it("drops edges whose endpoints are not rendered", () => {
    const edges = [edge("ap0", "ghost")];
    const hidden = new Map([["ap0", "collapsed:sw1:5"]]);
    const out = remapEdgesForCollapsedGroups(edges, hidden, new Set(["sw1"]));
    expect(out).toHaveLength(0);
  });

  it("drops self-loops created by collapsing both endpoints", () => {
    const edges = [edge("ap0", "ap1")];
    const hidden = new Map([
      ["ap0", "collapsed:sw1:5"],
      ["ap1", "collapsed:sw1:5"],
    ]);
    const out = remapEdgesForCollapsedGroups(edges, hidden, new Set());
    expect(out).toHaveLength(0);
  });

  it("passes edges through untouched when nothing is hidden", () => {
    const edges = [edge("ap0", "sw1")];
    const out = remapEdgesForCollapsedGroups(edges, new Map(), new Set(["ap0", "sw1"]));
    expect(out).toBe(edges);
  });
});
