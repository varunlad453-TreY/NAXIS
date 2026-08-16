import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TopologyNode, TopologyEdge } from "@/types/topology";
import { WorstOffendersStrip } from "./worst-offenders-strip";

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

const nodes = [
  makeNode({ node_id: "site1", node_type: "site", name: "Site" }),
  makeNode({ node_id: "sw1", node_type: "switch", name: "Core Switch", health_status: "critical" }),
  makeNode({ node_id: "ap1", name: "AP One", health_status: "critical" }),
  makeNode({ node_id: "ap2", name: "AP Two", health_status: "warning" }),
  makeNode({ node_id: "ap3", name: "AP Three", health_status: "healthy" }),
];

const edges: TopologyEdge[] = [
  { src_id: "ap1", dst_id: "sw1", edge_type: "uplink" },
  { src_id: "ap2", dst_id: "sw1", edge_type: "uplink" },
  { src_id: "ap3", dst_id: "sw1", edge_type: "uplink" },
];

describe("WorstOffendersStrip", () => {
  it("renders alerting devices only, critical first, blast radius annotated", () => {
    render(<WorstOffendersStrip nodes={nodes} edges={edges} onSelect={vi.fn()} />);
    expect(screen.getByTestId("worst-offenders-strip")).toBeInTheDocument();

    // healthy device never shown
    expect(screen.queryByTestId("offender-ap3")).not.toBeInTheDocument();

    // sw1 is critical AND has 3 downstream → ranked first
    const first = screen.getByTestId("offender-sw1");
    expect(first).toHaveTextContent("Switch");
    expect(first).toHaveTextContent("→ 3 affected");

    // Click expand button to view remaining offenders
    fireEvent.click(screen.getByText(/\+2 more/));

    expect(screen.getByTestId("offender-ap1")).toBeInTheDocument();
    expect(screen.getByTestId("offender-ap2")).toBeInTheDocument();
  });

  it("invokes onSelect with id and name when a card is clicked", () => {
    const onSelect = vi.fn();
    render(<WorstOffendersStrip nodes={nodes} edges={edges} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("offender-sw1"));
    expect(onSelect).toHaveBeenCalledWith("sw1", "Core Switch");
  });

  it("renders nothing when no devices are alerting", () => {
    const healthy = nodes.map((n) => ({ ...n, health_status: "healthy" }));
    const { container } = render(
      <WorstOffendersStrip nodes={healthy} edges={edges} onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
