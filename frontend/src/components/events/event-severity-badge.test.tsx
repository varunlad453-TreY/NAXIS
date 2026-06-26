/**
 * Component tests for event severity badge
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventSeverityBadge } from "@/components/events/event-severity-badge";
import type { EventSeverity } from "@/types/event";

describe("EventSeverityBadge", () => {
  const severities: EventSeverity[] = ["critical", "major", "minor", "info"];

  severities.forEach((severity) => {
    it(`should render ${severity} badge`, () => {
      render(<EventSeverityBadge severity={severity} />);
      const badge = screen.getByText(
        severity.charAt(0).toUpperCase() + severity.slice(1)
      );
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("uppercase");
    });
  });

  it("should render dot indicator when showDot is true", () => {
    const { container } = render(
      <EventSeverityBadge severity="critical" showDot={true} />
    );
    const dot = container.querySelector("span.mr-1\\.5.h-1\\.5.w-1\\.5");
    expect(dot).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const { container } = render(
      <EventSeverityBadge severity="major" className="custom-class" />
    );
    const badge = container.firstChild;
    expect(badge).toHaveClass("custom-class");
  });

  it("should have correct variant classes based on severity", () => {
    const { container: criticalContainer } = render(
      <EventSeverityBadge severity="critical" />
    );
    const criticalBadge = criticalContainer.firstChild;
    expect(criticalBadge).toHaveClass("text-critical");
    expect(criticalBadge).toHaveClass("bg-critical-bg");
  });
});
