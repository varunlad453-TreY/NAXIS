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
  it("renders site name and device count", () => {
    const nodes = [makeNode(), makeNode({ node_id: "n2", node_type: "ap" })];
    render(<SiteContextBanner siteName="Delhi Palwal" nodes={nodes} />);
    expect(screen.getByText("Delhi Palwal")).toBeDefined();
    expect(screen.getByText("2 devices")).toBeDefined();
  });

  it("shows healthy message when no alerts", () => {
    const nodes = [makeNode(), makeNode({ node_id: "n2" })];
    render(<SiteContextBanner nodes={nodes} />);
    expect(screen.getByText(/All devices healthy/)).toBeDefined();
  });

  it("shows alert sentence when devices are degraded", () => {
    const nodes = [
      makeNode(),
      makeNode({ node_id: "n2", node_type: "ap", health_status: "critical", name: "ap-bad" }),
    ];
    render(<SiteContextBanner nodes={nodes} />);
    expect(screen.getByText(/1 of 2 devices alerting/)).toBeDefined();
    expect(screen.getByText(/ap-bad critical/)).toBeDefined();
  });

  it("uses provided health counts over computed", () => {
    const nodes = [makeNode()];
    render(
      <SiteContextBanner
        nodes={nodes}
        health={{ healthy_count: 0, warning_count: 1, critical_count: 2, unknown_count: 0 }}
        totalDevices={3}
      />,
    );
    expect(screen.getByText("3 devices")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("Critical")).toBeDefined();
  });
});
