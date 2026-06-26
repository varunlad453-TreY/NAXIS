/**
 * Component tests for device row
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeviceRow } from "@/components/devices/device-row";
import type { DeviceSummary } from "@/types/device";

const mockDevice: DeviceSummary = {
  device_id: "dev-1",
  platform: "dnac",
  hostname: "router-01",
  ip_address: "192.168.1.1",
  device_type: "Router",
  site_id: "site-1",
  site_name: "New York",
  reachability: "reachable",
  management_state: "managed",
  last_seen: "2026-06-26T10:00:00Z",
};

describe("DeviceRow", () => {
  it("should render device information", () => {
    render(<DeviceRow device={mockDevice} />);

    expect(screen.getByText(mockDevice.hostname)).toBeInTheDocument();
    expect(screen.getByText(mockDevice.ip_address)).toBeInTheDocument();
    expect(screen.getByText(mockDevice.device_type)).toBeInTheDocument();
    expect(screen.getByText(mockDevice.site_name)).toBeInTheDocument();
  });

  it("should render platform badge with uppercase text", () => {
    render(<DeviceRow device={mockDevice} />);
    expect(screen.getByText("DNAC")).toBeInTheDocument();
  });

  it("should render reachability badge", () => {
    render(<DeviceRow device={mockDevice} />);
    expect(screen.getByText("Reachable")).toBeInTheDocument();
  });

  it("should render last_seen timestamp", () => {
    render(<DeviceRow device={mockDevice} />);
    const timeElement = screen.getByText(/6\/26\/2026/);
    expect(timeElement).toBeInTheDocument();
  });

  it("should render device ID in hostname when hostname is empty", () => {
    const deviceWithoutHostname = { ...mockDevice, hostname: "" };
    render(<DeviceRow device={deviceWithoutHostname} />);
    expect(screen.getByText(mockDevice.device_id)).toBeInTheDocument();
  });

  it("should render site ID when site_name is empty", () => {
    const deviceWithoutSiteName = { ...mockDevice, site_name: "" };
    render(<DeviceRow device={deviceWithoutSiteName} />);
    expect(screen.getByText(mockDevice.site_id)).toBeInTheDocument();
  });

  it("should handle missing last_seen gracefully", () => {
    const deviceWithoutLastSeen = { ...mockDevice, last_seen: null };
    const { container } = render(<DeviceRow device={deviceWithoutLastSeen} />);
    expect(container).toBeInTheDocument();
  });
});
