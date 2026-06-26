/**
 * Component tests for event row
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventRow } from "@/components/events/event-row";
import type { EventSummary } from "@/types/event";

const mockEvent: EventSummary = {
  event_id: "evt-1",
  timestamp: "2026-06-26T10:00:00Z",
  source: "dnac",
  severity: "critical",
  category: "network",
  event_type: "device_down",
  title: "Device Down",
  description: "Device is unreachable",
  device_id: "dev-1",
  device_name: "Router-01",
  site_id: "site-1",
  site_name: "New York",
  incident_id: "inc-1",
};

describe("EventRow", () => {
  it("should render event information", () => {
    render(<EventRow event={mockEvent} />);

    expect(screen.getByText(mockEvent.title)).toBeInTheDocument();
    expect(screen.getByText(mockEvent.device_name)).toBeInTheDocument();
    expect(screen.getByText(mockEvent.site_name)).toBeInTheDocument();
    expect(screen.getByText(mockEvent.source)).toBeInTheDocument();
  });

  it("should render severity badge", () => {
    render(<EventRow event={mockEvent} />);
    const badge = screen.getByText("Critical");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("uppercase");
  });

  it("should show incident link when incident_id is present", () => {
    render(<EventRow event={mockEvent} />);
    expect(screen.getByText("Incident")).toBeInTheDocument();
  });

  it("should link to incident detail page", () => {
    render(<EventRow event={mockEvent} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/incidents/${mockEvent.incident_id}`);
  });

  it("should not show incident link when incident_id is null", () => {
    const eventWithoutIncident = { ...mockEvent, incident_id: null };
    render(<EventRow event={eventWithoutIncident} />);
    expect(screen.queryByText("Incident")).not.toBeInTheDocument();
  });

  it("should format timestamp correctly", () => {
    render(<EventRow event={mockEvent} />);
    const timeElement = screen.getByTitle(/2026-06-26/);
    expect(timeElement).toBeInTheDocument();
  });
});
