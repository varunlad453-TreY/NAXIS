import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlastRadiusPanel } from "./blast-radius-panel";
import type { IncidentDetail } from "@/types/incident";

const mockIncidentDetail: IncidentDetail = {
  incident_id: "inc-test-001",
  title: "Core switch uplink failure at SFO-01",
  severity: "critical",
  severity_label: "Outage",
  status: "open",
  event_count: 12,
  affected_sites_count: 1,
  affected_devices_count: 3,
  confidence_score: 0.85,
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:15:00Z",
  affected_sites: ["site-sfo-01"],
  affected_devices: ["core-switch-01", "ap-sfo-101", "ap-sfo-102"],
  affected_clients: [],
  related_event_ids: ["evt-001", "evt-002", "evt-003"],
  probable_cause: "ISP BGP flap on primary uplink",
  topology_node_ids: ["core-switch-01"],
};

describe("BlastRadiusPanel", () => {
  it("renders loading skeleton when loading", () => {
    render(<BlastRadiusPanel loading />);
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders empty state when no incident detail", () => {
    render(<BlastRadiusPanel incidentDetail={null} />);
    expect(screen.getByText("No incident data available")).toBeDefined();
  });

  it("renders incident title and severity", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("Core switch uplink failure at SFO-01")).toBeDefined();
    expect(screen.getByText("Outage")).toBeDefined();
  });

  it("renders confidence score", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("renders blast radius stats", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("Sites")).toBeDefined();
    expect(screen.getByText("Devices")).toBeDefined();
    expect(screen.getByText("Root Cause")).toBeDefined();
    expect(screen.getByText("Symptoms")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined(); // devices count (unique)
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2); // sites + root cause both = 1
  });

  it("renders probable cause", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("Probable Cause")).toBeDefined();
    expect(screen.getByText("ISP BGP flap on primary uplink")).toBeDefined();
  });

  it("renders timeline section", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("Timeline")).toBeDefined();
    expect(screen.getByText("Incident Detected")).toBeDefined();
    expect(screen.getByText("Last Updated")).toBeDefined();
  });

  it("renders affected sites section", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("Affected Sites")).toBeDefined();
    expect(screen.getByText("site-sfo-01")).toBeDefined();
  });

  it("renders affected devices section", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("Affected Devices")).toBeDefined();
    expect(screen.getByText("core-switch-01")).toBeDefined();
    expect(screen.getByText("ap-sfo-101")).toBeDefined();
  });

  it("renders view incident link", () => {
    render(<BlastRadiusPanel incidentDetail={mockIncidentDetail} />);
    expect(screen.getByText("View Full Incident Details")).toBeDefined();
  });
});
