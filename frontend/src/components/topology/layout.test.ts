import { describe, it, expect } from "vitest";
import { buildLayout, NODE_WIDTH, NODE_HEIGHT } from "./layout";
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
