import { describe, it, expect } from "vitest";
import type { TopologyNode } from "@/types/topology";
import {
  getDeviceCategory,
  computeHealthDistribution,
  aggregateHealth,
  aggregateByCategory,
} from "./topology-utils";

function makeNode(overrides: Partial<TopologyNode>): TopologyNode {
  return {
    node_id: "test",
    node_type: "ap",
    name: "test",
    ip_address: "",
    vendor: "",
    model: "",
    site_id: "",
    site_name: null,
    health_status: "unknown",
    health_label: "Unknown",
    ...overrides,
  };
}

describe("getDeviceCategory", () => {
  it("returns infrastructure for switches", () => {
    expect(getDeviceCategory(makeNode({ node_type: "switch" }))).toBe("infrastructure");
  });
  it("returns wireless for APs", () => {
    expect(getDeviceCategory(makeNode({ node_type: "ap" }))).toBe("wireless");
  });
  it("returns edge for WAN edges", () => {
    expect(getDeviceCategory(makeNode({ node_type: "wan_edge" }))).toBe("edge");
  });
  it("returns leaf for unknown types", () => {
    expect(getDeviceCategory(makeNode({ node_type: "unknown_type" }))).toBe("leaf");
  });
});

describe("computeHealthDistribution", () => {
  it("counts healthy nodes", () => {
    const nodes = [
      makeNode({ health_status: "healthy" }),
      makeNode({ health_status: "healthy" }),
    ];
    expect(computeHealthDistribution(nodes)).toEqual({
      healthy_count: 2,
      warning_count: 0,
      critical_count: 0,
      unknown_count: 0,
    });
  });

  it("counts all statuses", () => {
    const nodes = [
      makeNode({ health_status: "healthy" }),
      makeNode({ health_status: "warning" }),
      makeNode({ health_status: "critical" }),
      makeNode({ health_status: "unknown" }),
    ];
    expect(computeHealthDistribution(nodes)).toEqual({
      healthy_count: 1,
      warning_count: 1,
      critical_count: 1,
      unknown_count: 1,
    });
  });

  it("returns all zeros for empty input", () => {
    expect(computeHealthDistribution([])).toEqual({
      healthy_count: 0,
      warning_count: 0,
      critical_count: 0,
      unknown_count: 0,
    });
  });
});

describe("aggregateHealth", () => {
  it("returns critical if any critical", () => {
    expect(aggregateHealth({ healthy_count: 5, warning_count: 2, critical_count: 1, unknown_count: 0 })).toBe("critical");
  });
  it("returns warning if no critical but has warning", () => {
    expect(aggregateHealth({ healthy_count: 5, warning_count: 1, critical_count: 0, unknown_count: 0 })).toBe("warning");
  });
  it("returns healthy if all healthy", () => {
    expect(aggregateHealth({ healthy_count: 10, warning_count: 0, critical_count: 0, unknown_count: 0 })).toBe("healthy");
  });
  it("returns unknown if no data", () => {
    expect(aggregateHealth({ healthy_count: 0, warning_count: 0, critical_count: 0, unknown_count: 0 })).toBe("unknown");
  });
});

describe("aggregateByCategory", () => {
  it("groups nodes by category", () => {
    const nodes = [
      makeNode({ node_id: "sw1", node_type: "switch", health_status: "healthy" }),
      makeNode({ node_id: "sw2", node_type: "switch", health_status: "critical" }),
      makeNode({ node_id: "ap1", node_type: "ap", health_status: "warning" }),
      makeNode({ node_id: "ap2", node_type: "ap", health_status: "healthy" }),
    ];
    const clusters = aggregateByCategory(nodes);
    expect(clusters).toHaveLength(2);

    const infra = clusters.find((c) => c.category === "infrastructure")!;
    expect(infra).toBeDefined();
    expect(infra.count).toBe(2);
    expect(infra.aggregatedHealth).toBe("critical");
    expect(infra.healthDistribution.critical_count).toBe(1);
    expect(infra.healthDistribution.healthy_count).toBe(1);
    expect(infra.deviceTypes).toHaveLength(1);
    expect(infra.deviceTypes[0].type).toBe("switch");

    const wireless = clusters.find((c) => c.category === "wireless")!;
    expect(wireless).toBeDefined();
    expect(wireless.count).toBe(2);
    expect(wireless.aggregatedHealth).toBe("warning");
  });

  it("returns empty for empty input", () => {
    expect(aggregateByCategory([])).toHaveLength(0);
  });

  it("sorts by category order", () => {
    const nodes = [
      makeNode({ node_type: "ap" }),
      makeNode({ node_type: "switch" }),
      makeNode({ node_type: "client" }),
      makeNode({ node_type: "gateway" }),
    ];
    const clusters = aggregateByCategory(nodes);
    expect(clusters.map((c) => c.category)).toEqual(["infrastructure", "wireless", "edge", "leaf"]);
  });

  it("aggregates device type counts within category", () => {
    const nodes = [
      makeNode({ node_id: "sw1", node_type: "switch", health_status: "healthy" }),
      makeNode({ node_id: "fw1", node_type: "firewall", health_status: "healthy" }),
    ];
    const clusters = aggregateByCategory(nodes);
    const infra = clusters.find((c) => c.category === "infrastructure")!;
    expect(infra.deviceTypes).toHaveLength(2);
    expect(infra.deviceTypes.find((d) => d.type === "switch")!.count).toBe(1);
    expect(infra.deviceTypes.find((d) => d.type === "firewall")!.count).toBe(1);
  });
});
