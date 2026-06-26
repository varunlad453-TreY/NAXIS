/**
 * Component tests for device reachability badge
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeviceReachabilityBadge } from "@/components/devices/device-reachability-badge";
import type { DeviceReachability } from "@/types/device";

describe("DeviceReachabilityBadge", () => {
  const reachabilities: DeviceReachability[] = [
    "reachable",
    "unreachable",
    "unknown",
  ];

  reachabilities.forEach((reachability) => {
    it(`should render ${reachability} badge`, () => {
      render(<DeviceReachabilityBadge reachability={reachability} />);
      const badge = screen.getByText(
        reachability.charAt(0).toUpperCase() + reachability.slice(1)
      );
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("uppercase");
    });
  });

  it("should render dot indicator when showDot is true", () => {
    const { container } = render(
      <DeviceReachabilityBadge reachability="reachable" showDot={true} />
    );
    const dot = container.querySelector("span.mr-1\\.5.h-1\\.5.w-1\\.5");
    expect(dot).toBeInTheDocument();
  });

  it("should have correct variant for reachable status", () => {
    const { container } = render(
      <DeviceReachabilityBadge reachability="reachable" />
    );
    const badge = container.firstChild;
    expect(badge).toHaveClass("text-success");
    expect(badge).toHaveClass("bg-success-bg");
  });

  it("should have correct variant for unreachable status", () => {
    const { container } = render(
      <DeviceReachabilityBadge reachability="unreachable" />
    );
    const badge = container.firstChild;
    expect(badge).toHaveClass("text-critical");
    expect(badge).toHaveClass("bg-critical-bg");
  });
});
