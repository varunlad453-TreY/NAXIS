import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopologySidePanel } from "./topology-side-panel";
import type { IncidentDetail } from "@/types/incident";
import type { TopologyNodeDetail } from "@/types/topology";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({
    data: { node_id: "", history: [], summary: {} },
    isLoading: false,
    error: null,
  }),
}));

const mockIncidentDetail: IncidentDetail = {
  incident_id: "inc-test-001",
  title: "Core switch uplink failure at SFO-01",
  severity: "critical",
  severity_label: "Outage",
  status: "open",
  event_count: 12,
  affected_sites_count: 1,
  affected_devices_count: 3,
  root_device_count: 1,
  symptom_device_count: 2,
  confidence_score: 0.85,
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:15:00Z",
  affected_sites: ["site-sfo-01"],
  affected_devices: ["core-switch-01", "ap-sfo-101", "ap-sfo-102"],
  affected_clients: [],
  root_device_ids: ["core-switch-01"],
  symptom_device_ids: ["ap-sfo-101", "ap-sfo-102"],
  related_event_ids: ["evt-001", "evt-002", "evt-003"],
  probable_cause: "ISP BGP flap on primary uplink",
  topology_node_ids: ["core-switch-01"],
  confidence_breakdown: { event_score: 0.7, avg_severity: 0.8, device_score: 0.6, total: 0.74 },
};

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
  ],
};

describe("TopologySidePanel", () => {
  it("renders nothing when mode is null", () => {
    const { container } = render(
      <TopologySidePanel mode={null} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders incident panel when mode is incident", () => {
    render(
      <TopologySidePanel
        mode="incident"
        incidentId="inc-test-001"
        incidentDetail={mockIncidentDetail}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Incident Blast Radius")).toBeDefined();
    expect(screen.getByText("Core switch uplink failure at SFO-01")).toBeDefined();
    expect(screen.getByText("Outage")).toBeDefined();
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders node panel when mode is node", () => {
    render(
      <TopologySidePanel
        mode="node"
        nodeDetail={mockNodeDetail}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Node Details")).toBeDefined();
    expect(screen.getByText("naxis-core-01")).toBeDefined();
    expect(screen.getAllByText("Switch").length).toBeGreaterThan(0);
    expect(screen.getByText("Critical")).toBeDefined();
    expect(screen.getByText("10.0.0.1")).toBeDefined();
  });

  it("shows loading skeleton for incident panel", () => {
    render(
      <TopologySidePanel
        mode="incident"
        incidentId="inc-test-001"
        incidentLoading
        onClose={() => {}}
      />,
    );
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows loading skeleton for node panel", () => {
    render(
      <TopologySidePanel
        mode="node"
        nodeLoading
        onClose={() => {}}
      />,
    );
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders close button", () => {
    render(
      <TopologySidePanel
        mode="incident"
        incidentId="inc-test-001"
        incidentDetail={mockIncidentDetail}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button")).toBeDefined();
  });
});
