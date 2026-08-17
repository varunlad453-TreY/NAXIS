import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TopologyNode, TopologyGraphResponse } from "@/types/topology";
import { HostMapView } from "./host-map-view";

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

function makeData(nodes: TopologyNode[]): TopologyGraphResponse {
  return { nodes, edges: [], total_nodes: nodes.length, total_edges: 0 };
}

const nodes = [
  makeNode({ node_id: "site1", node_type: "site", name: "Site" }),
  makeNode({ node_id: "sw1", node_type: "switch", name: "Switch One", health_status: "healthy" }),
  makeNode({ node_id: "ap1", name: "AP Critical", health_status: "critical" }),
  makeNode({ node_id: "ap2", name: "AP Warning", health_status: "warning" }),
  makeNode({ node_id: "ap3", name: "AP Healthy", health_status: "healthy" }),
];

describe("HostMapView", () => {
  it("defaults to the alerting filter — only critical + warning tiles shown", () => {
    render(<HostMapView data={makeData(nodes)} onContextSelect={vi.fn()} />);
    expect(screen.getByTestId("hostmap-tile-ap1")).toBeInTheDocument();
    expect(screen.getByTestId("hostmap-tile-ap2")).toBeInTheDocument();
    expect(screen.queryByTestId("hostmap-tile-ap3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hostmap-tile-sw1")).not.toBeInTheDocument();
    expect(screen.getByTestId("hostmap-visible-count")).toHaveTextContent("2 of 4 shown");
  });

  it("shows every device under the All filter, grouped by category", () => {
    render(<HostMapView data={makeData(nodes)} onContextSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("hostmap-filter-all"));
    expect(screen.getByTestId("hostmap-tile-sw1")).toBeInTheDocument();
    expect(screen.getByTestId("hostmap-tile-ap3")).toBeInTheDocument();
    expect(screen.getByTestId("hostmap-group-core_network")).toBeInTheDocument();
    expect(screen.getByTestId("hostmap-group-wireless")).toBeInTheDocument();
    expect(screen.getByTestId("hostmap-visible-count")).toHaveTextContent("4 of 4 shown");
  });

  it("sorts tiles critical-first within a group", () => {
    render(<HostMapView data={makeData(nodes)} onContextSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("hostmap-filter-all"));
    const group = screen.getByTestId("hostmap-group-wireless");
    const tiles = group.querySelectorAll("[data-testid^='hostmap-tile-']");
    expect(tiles[0]).toHaveAttribute("data-testid", "hostmap-tile-ap1");
    expect(tiles[1]).toHaveAttribute("data-testid", "hostmap-tile-ap2");
    expect(tiles[2]).toHaveAttribute("data-testid", "hostmap-tile-ap3");
  });

  it("calls onContextSelect when a tile is clicked", () => {
    const onSelect = vi.fn();
    render(<HostMapView data={makeData(nodes)} onContextSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("hostmap-tile-ap1"));
    expect(onSelect).toHaveBeenCalledWith("ap1", "AP Critical");
  });

  it("filters tiles by search text", () => {
    render(<HostMapView data={makeData(nodes)} onContextSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("hostmap-filter-all"));
    fireEvent.change(screen.getByTestId("hostmap-search"), { target: { value: "warning" } });
    expect(screen.queryByTestId("hostmap-tile-ap1")).not.toBeInTheDocument();
    expect(screen.getByTestId("hostmap-tile-ap2")).toBeInTheDocument();
  });

  it("shows an encouraging empty state when nothing is alerting", () => {
    const healthy = nodes.map((n) => ({ ...n, health_status: "healthy" }));
    render(<HostMapView data={makeData(healthy)} onContextSelect={vi.fn()} />);
    expect(screen.getAllByText(/Show healthy infrastructure/).length).toBeGreaterThan(0);
  });

  it("collapses and expands a category group", () => {
    render(<HostMapView data={makeData(nodes)} onContextSelect={vi.fn()} />);
    const groupButton = screen.getByTestId("hostmap-group-wireless").querySelector("button")!;
    fireEvent.click(groupButton);
    expect(screen.queryByTestId("hostmap-tile-ap1")).not.toBeInTheDocument();
    fireEvent.click(groupButton);
    expect(screen.getByTestId("hostmap-tile-ap1")).toBeInTheDocument();
  });
});
