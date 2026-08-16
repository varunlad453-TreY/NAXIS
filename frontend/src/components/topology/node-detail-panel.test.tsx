import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodeDetailPanel } from "./node-detail-panel";
import type { TopologyNodeDetail } from "@/types/topology";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({
    data: { node_id: "", history: [], summary: {} },
    isLoading: false,
    error: null,
  }),
}));

const mockNodeDetail: TopologyNodeDetail = {
  node: {
    node_id: "core-switch-01",
    node_type: "switch",
    name: "naxis-core-01",
    ip_address: "10.0.0.1",
    vendor: "cisco",
    model: "C9300",
    site_id: "site-sfo-01",
    site_name: "SFO-01",
    health_status: "critical",
    health_label: "Critical",
  },
  parents: [
    {
      node_id: "router-01",
      node_type: "router",
      name: "border-router-01",
      ip_address: "10.0.0.254",
      vendor: "cisco",
      model: "ISR4451",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "healthy",
      health_label: "Healthy",
    },
  ],
  children: [
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
  ],
};

const mockNodeDetailSplitParents: TopologyNodeDetail = {
  node: {
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
  },
  parents: [
    {
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
    },
    {
      node_id: "switch-dist-01",
      node_type: "distribution_switch",
      name: "dist-switch-01",
      ip_address: "10.0.0.2",
      vendor: "cisco",
      model: "C9500",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "healthy",
      health_label: "Healthy",
    },
    {
      node_id: "router-01",
      node_type: "router",
      name: "border-router-01",
      ip_address: "10.0.0.254",
      vendor: "cisco",
      model: "ISR4451",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "healthy",
      health_label: "Healthy",
    },
  ],
  children: [],
};

const mockNodeDetailNoNeighbors: TopologyNodeDetail = {
  node: {
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
  parents: [],
  children: [],
};

describe("NodeDetailPanel", () => {
  it("renders loading skeleton when loading", () => {
    render(<NodeDetailPanel loading />);
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders empty state when no node detail", () => {
    render(<NodeDetailPanel nodeDetail={null} />);
    expect(screen.getByText("Select a node to view details")).toBeDefined();
  });

  it("renders node name and type", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} />);
    expect(screen.getByText("naxis-core-01")).toBeDefined();
    expect(screen.getByText("Switch")).toBeDefined();
  });

  it("renders health status", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} />);
    expect(screen.getByText("Critical")).toBeDefined();
    expect(screen.getByText("Current health status")).toBeDefined();
  });

  it("renders node detail fields", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} />);
    expect(screen.getByText("core-switch-01")).toBeDefined();
    expect(screen.getByText("10.0.0.1")).toBeDefined();
    expect(screen.getByText("site-sfo-01")).toBeDefined();
    expect(screen.getByText("SFO-01")).toBeDefined();
  });

  it("renders parent section with correct label", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} />);
    expect(screen.getByText("Other Parents (1)")).toBeDefined();
    expect(screen.getByText("border-router-01")).toBeDefined();
  });

  it("splits parents into Site, Connected Switch, and Other sections", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetailSplitParents} />);
    expect(screen.getByText("Site (1)")).toBeDefined();
    expect(screen.getByText("Connected Switch (1)")).toBeDefined();
    expect(screen.getByText("Other Parents (1)")).toBeDefined();
    expect(screen.getByText("dist-switch-01")).toBeDefined();
    expect(screen.getByText("border-router-01")).toBeDefined();
    const siteNames = screen.getAllByText("SFO-01");
    expect(siteNames.length).toBeGreaterThanOrEqual(1);
  });

  it("renders children nodes section", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} />);
    expect(screen.getByText("Children (2)")).toBeDefined();
    expect(screen.getByText("ap-101")).toBeDefined();
    expect(screen.getByText("ap-102")).toBeDefined();
  });

  it("shows isolated node message when no neighbors", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetailNoNeighbors} />);
    expect(
      screen.getByText(/No topology neighbors/),
    ).toBeDefined();
  });

  it("does not render parents or children sections when none exist", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetailNoNeighbors} />);
    expect(screen.queryByText(/Other Parents/)).toBeNull();
    expect(screen.queryByText(/Children/)).toBeNull();
  });

  it("renders downstream impact section when children exist", () => {
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} />);
    expect(screen.getByText(/Downstream Impact/)).toBeDefined();
    expect(screen.getByText(/direct downstream devices/)).toBeDefined();
  });

  it("renders quick actions when callbacks provided", () => {
    const onPathTrace = vi.fn();
    const onBlastRadius = vi.fn();
    render(
      <NodeDetailPanel
        nodeDetail={mockNodeDetail}
        onPathTrace={onPathTrace}
        onBlastRadius={onBlastRadius}
      />,
    );
    expect(screen.getByText(/Quick Actions/)).toBeDefined();
    expect(screen.getByText(/Path to Internet/)).toBeDefined();
    expect(screen.getByText(/Blast Radius/)).toBeDefined();
  });

  it("expands children list when +X more button is clicked", () => {
    const manyChildren = Array.from({ length: 15 }, (_, i) => ({
      node_id: `ap-${i}`,
      node_type: "ap",
      name: `ap-name-${i}`,
      ip_address: `10.0.0.${i}`,
      vendor: "mist",
      model: "AP43",
      site_id: "site-sfo-01",
      site_name: "SFO-01",
      health_status: "healthy",
      health_label: "Healthy",
    }));
    const detailWithManyChildren: TopologyNodeDetail = {
      ...mockNodeDetail,
      children: manyChildren,
    };

    render(<NodeDetailPanel nodeDetail={detailWithManyChildren} />);
    expect(screen.getByText("Children (15)")).toBeDefined();
    expect(screen.getByText("ap-name-0")).toBeDefined();
    expect(screen.queryByText("ap-name-14")).toBeNull();

    const expandBtn = screen.getByText("+5 more");
    fireEvent.click(expandBtn);

    expect(screen.getByText("ap-name-14")).toBeDefined();
    expect(screen.getByText("Show less")).toBeDefined();
  });

  it("calls path trace callback when button clicked", () => {
    const onPathTrace = vi.fn();
    render(<NodeDetailPanel nodeDetail={mockNodeDetail} onPathTrace={onPathTrace} />);
    const btn = screen.getByText(/Path to Internet/);
    fireEvent.click(btn);
    expect(onPathTrace).toHaveBeenCalled();
  });
});
