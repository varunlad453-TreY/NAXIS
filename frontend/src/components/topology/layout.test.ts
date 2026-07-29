import { describe, it, expect } from "vitest";
import { buildLayout, buildGroupedLayout, NODE_WIDTH, NODE_HEIGHT } from "./layout";
import type { TopologyNode, TopologyEdge } from "@/types/topology";

describe("buildLayout", () => {
  const nodes: TopologyNode[] = [
    {
      node_id: "core-switch-01",
      node_type: "switch",
      name: "naxis-core-01",
      ip_address: "10.0.0.1",
      vendor: "cisco",
      model: "C9300",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "healthy",
      health_label: "Healthy",
    },
    {
      node_id: "ap-sfo-101",
      node_type: "ap",
      name: "ap-101",
      ip_address: "10.0.1.1",
      vendor: "mist",
      model: "AP43",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "unknown",
      health_label: "Unknown",
    },
    {
      node_id: "ap-sfo-102",
      node_type: "ap",
      name: "ap-102",
      ip_address: "10.0.1.2",
      vendor: "mist",
      model: "AP43",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "unknown",
      health_label: "Unknown",
    },
  ];

  const edges: TopologyEdge[] = [
    { src_id: "ap-sfo-101", dst_id: "core-switch-01", edge_type: "wired" },
    { src_id: "ap-sfo-102", dst_id: "core-switch-01", edge_type: "wired" },
  ];

  it("produces correct number of ReactFlow nodes", () => {
    const result = buildLayout(nodes, edges);
    expect(result.nodes).toHaveLength(3);
  });

  it("produces correct number of ReactFlow edges", () => {
    const result = buildLayout(nodes, edges);
    expect(result.edges).toHaveLength(2);
  });

  it("assigns node type topologyNode to each node", () => {
    const result = buildLayout(nodes, edges);
    for (const n of result.nodes) {
      expect(n.type).toBe("topologyNode");
    }
  });

  it("preserves node data in each ReactFlow node", () => {
    const result = buildLayout(nodes, edges);
    for (const n of result.nodes) {
      const d = n.data as Record<string, unknown>;
      expect(d.label).toBeTruthy();
      expect(d.node_type).toBeTruthy();
      expect(d.health_status).toBeTruthy();
    }
  });

  it("assigns edge source and target correctly", () => {
    const result = buildLayout(nodes, edges);
    expect(result.edges[0].source).toBe("core-switch-01");
    expect(result.edges[0].target).toBe("ap-sfo-101");
    expect(result.edges[1].source).toBe("core-switch-01");
    expect(result.edges[1].target).toBe("ap-sfo-102");
  });

  it("positions nodes using dagre (all have x,y)", () => {
    const result = buildLayout(nodes, edges);
    for (const n of result.nodes) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles empty input gracefully", () => {
    const result = buildLayout([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("filters out edges referencing non-existent nodes", () => {
    const extraEdges: TopologyEdge[] = [
      ...edges,
      { src_id: "phantom-node", dst_id: "core-switch-01", edge_type: "wired" },
    ];
    const result = buildLayout(nodes, extraEdges);
    expect(result.edges).toHaveLength(2);
  });

  it("positions parent above children (smaller y for parents)", () => {
    const result = buildLayout(nodes, edges);
    const switchNode = result.nodes.find((n) => n.id === "core-switch-01");
    const apNode = result.nodes.find((n) => n.id === "ap-sfo-101");
    expect(switchNode).toBeDefined();
    expect(apNode).toBeDefined();
    expect(switchNode!.position.y).toBeLessThan(apNode!.position.y);
  });

  it("marks highlighted nodes in node data", () => {
    const highlightSet = new Set(["core-switch-01"]);
    const result = buildLayout(nodes, edges, highlightSet);
    const switchNode = result.nodes.find((n) => n.id === "core-switch-01");
    const apNode = result.nodes.find((n) => n.id === "ap-sfo-101");
    expect((switchNode!.data as Record<string, unknown>).highlighted).toBe(true);
    expect((apNode!.data as Record<string, unknown>).highlighted).toBe(false);
  });

  it("does not highlight when no set provided", () => {
    const result = buildLayout(nodes, edges);
    for (const n of result.nodes) {
      expect((n.data as Record<string, unknown>).highlighted).toBe(false);
    }
  });

  it("highlights multiple nodes", () => {
    const highlightSet = new Set(["core-switch-01", "ap-sfo-102"]);
    const result = buildLayout(nodes, edges, highlightSet);
    const sw = result.nodes.find((n) => n.id === "core-switch-01")!;
    const ap1 = result.nodes.find((n) => n.id === "ap-sfo-101")!;
    const ap2 = result.nodes.find((n) => n.id === "ap-sfo-102")!;
    expect((sw.data as Record<string, unknown>).highlighted).toBe(true);
    expect((ap1.data as Record<string, unknown>).highlighted).toBe(false);
    expect((ap2.data as Record<string, unknown>).highlighted).toBe(true);
  });
});

describe("buildGroupedLayout", () => {
  const siteNode: TopologyNode = {
    node_id: "mist-site-sfo-01",
    node_type: "site",
    name: "SFO-01",
    ip_address: "",
    vendor: "mist",
    model: "",
    site_id: "site-sfo-01",
    site_name: "SFO-01",
    health_status: "healthy",
    health_label: "Healthy",
  };

  const ap1: TopologyNode = {
    node_id: "ap-sfo-101",
    node_type: "ap",
    name: "ap-101",
    ip_address: "10.0.1.1",
    vendor: "mist",
    model: "AP43",
    site_id: "site-sfo-01",
    site_name: "SFO-01",
    health_status: "healthy",
    health_label: "Healthy",
  };

  const ap2: TopologyNode = {
    node_id: "ap-sfo-102",
    node_type: "ap",
    name: "ap-102",
    ip_address: "10.0.1.2",
    vendor: "mist",
    model: "AP43",
    site_id: "site-sfo-01",
    site_name: "SFO-01",
    health_status: "unknown",
    health_label: "Unknown",
  };

  const switch1: TopologyNode = {
    node_id: "core-switch-01",
    node_type: "switch",
    name: "naxis-core-01",
    ip_address: "10.0.0.1",
    vendor: "cisco",
    model: "C9300",
    site_id: "site-sfo-01",
    site_name: "SFO-01",
    health_status: "healthy",
    health_label: "Healthy",
  };

  const edges: TopologyEdge[] = [
    { src_id: "ap-sfo-101", dst_id: "core-switch-01", edge_type: "physical_link" },
    { src_id: "ap-sfo-102", dst_id: "core-switch-01", edge_type: "physical_link" },
    { src_id: "ap-sfo-101", dst_id: "mist-site-sfo-01", edge_type: "site_membership" },
    { src_id: "ap-sfo-102", dst_id: "mist-site-sfo-01", edge_type: "site_membership" },
    { src_id: "core-switch-01", dst_id: "mist-site-sfo-01", edge_type: "site_membership" },
  ];

  it("creates a siteGroup for each site with children", () => {
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
    );
    const groupNodes = result.nodes.filter((n) => n.type === "siteGroup");
    expect(groupNodes).toHaveLength(1);
    const gn = groupNodes[0];
    expect(gn.data.label).toBe("SFO-01");
    expect(gn.data.child_count).toBe(3);
    expect(gn.data.isExpanded).toBe(false);
  });

  it("includes children when site is expanded", () => {
    const expanded = new Set(["site-sfo-01"]);
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
      undefined,
      expanded,
    );
    const groupNode = result.nodes.find((n) => n.type === "siteGroup")!;
    expect(groupNode.data.isExpanded).toBe(true);

    // Children should be present with parentId
    const childNodes = result.nodes.filter((n) => n.parentId !== undefined);
    expect(childNodes).toHaveLength(3);
    expect(childNodes.every((n) => n.parentId === groupNode.id)).toBe(true);
  });

  it("hides children when site is collapsed", () => {
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
    );
    const childNodes = result.nodes.filter((n) => n.parentId !== undefined);
    expect(childNodes).toHaveLength(0);
  });

  it("returns crossSiteEdgeCounts map", () => {
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
    );
    expect(result.crossSiteEdgeCounts).toBeDefined();
    expect(typeof result.crossSiteEdgeCounts["site-sfo-01"]).toBe("number");
  });

  it("filters nodes by activeTypeFilters", () => {
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
      undefined,
      new Set(),
      new Set(["ap"]),
    );
    // Only AP nodes should remain; switch and site filtered out
    const topologyNodes = result.nodes.filter((n) => n.type === "topologyNode");
    expect(topologyNodes.every((n) => (n.data as Record<string, unknown>).node_type === "ap")).toBe(true);
  });

  it("returns flat layout when site type is filtered out", () => {
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
      undefined,
      new Set(),
      new Set(["switch"]),
    );
    const topologyNodes = result.nodes.filter((n) => n.type === "topologyNode");
    expect(topologyNodes).toHaveLength(1);
    expect(topologyNodes[0].id).toBe("core-switch-01");
    expect(result.nodes.filter((n) => n.type === "siteGroup")).toHaveLength(0);
  });

  it("handles empty input gracefully", () => {
    const result = buildGroupedLayout([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.crossSiteEdgeCounts).toEqual({});
  });

  it("filters out site_membership edges (replaced by containment)", () => {
    const result = buildGroupedLayout(
      [siteNode, ap1, ap2, switch1],
      edges,
    );
    // site_membership edges should not appear
    const siteMemEdges = result.edges.filter(
      (e) => e.id.includes("mist-site-sfo-01") || e.id.includes("site_membership"),
    );
    expect(siteMemEdges).toHaveLength(0);
  });

  it("returns flat layout when all nodes are sites (backbone mode)", () => {
    const siteNodes: TopologyNode[] = [
      {
        node_id: "mist-site-sfo-01",
        node_type: "site",
        name: "San Francisco",
        ip_address: "",
        vendor: "",
        model: "",
        site_id: "site-sfo-01",
        site_name: null,
        health_status: "unknown",
        health_label: "Unknown",
      },
      {
        node_id: "mist-site-nyc-01",
        node_type: "site",
        name: "New York",
        ip_address: "",
        vendor: "",
        model: "",
        site_id: "site-nyc-01",
        site_name: null,
        health_status: "unknown",
        health_label: "Unknown",
      },
    ];
    const siteEdges: TopologyEdge[] = [
      { src_id: "mist-site-sfo-01", dst_id: "mist-site-nyc-01", edge_type: "logical_link" },
    ];
    const result = buildGroupedLayout(siteNodes, siteEdges);
    // No siteGroup nodes — all nodes are topologyNode (flat)
    expect(result.nodes.filter((n) => n.type === "siteGroup")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.type === "topologyNode")).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });
});
