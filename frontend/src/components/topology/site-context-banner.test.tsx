import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteContextBanner } from "./site-context-banner";
import type { TopologyNode } from "@/types/topology";

function makeNode(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    node_id: "n1",
    node_type: "switch",
    name: "sw1",
    ip_address: "",
    vendor: "cisco",
    model: "",
    site_id: "s1",
    site_name: null,
    health_status: "healthy",
    health_label: "Healthy",
    ...overrides,
  };
}

describe("SiteContextBanner", () => {
  it("returns null when no devices are alerting", () => {
    const nodes = [makeNode(), makeNode({ node_id: "n2" })];
    const { container } = render(<SiteContextBanner nodes={nodes} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows alert sentence when devices are degraded or critical", () => {
    const nodes = [
      makeNode(),
      makeNode({ node_id: "n2", node_type: "ap", health_status: "critical", name: "ap-bad" }),
    ];
    render(<SiteContextBanner nodes={nodes} />);
    expect(screen.getByText(/1 of 2 devices alerting — ap-bad critical/)).toBeDefined();
  });
});
