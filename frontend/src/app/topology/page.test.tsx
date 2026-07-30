import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { deriveAggregatedHealth } from "@/lib/topology-utils";
import type { TopologyNode } from "@/types/topology";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  Suspense: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getTopologyBackbone: vi.fn(),
    getSiteTopology: vi.fn(),
    getSiteSummary: vi.fn(),
    getTopologySummary: vi.fn(),
  },
}));

describe("deriveAggregatedHealth", () => {
  it("returns unknown when device count is zero", () => {
    const node: TopologyNode = {
      node_id: "site-1", node_type: "site", name: "Empty", ip_address: "",
      vendor: "", model: "", site_id: "", site_name: null,
      health_status: "unknown", health_label: "Unknown",
      device_count: 0,
    };
    const result = deriveAggregatedHealth(node);
    expect(result.status).toBe("unknown");
    expect(result.label).toBe("No devices");
  });

  it("returns critical when critical_count > 0", () => {
    const node: TopologyNode = {
      node_id: "site-1", node_type: "site", name: "Site", ip_address: "",
      vendor: "", model: "", site_id: "", site_name: null,
      health_status: "unknown", health_label: "Unknown",
      device_count: 10, critical_count: 2, warning_count: 1,
    };
    const result = deriveAggregatedHealth(node);
    expect(result.status).toBe("critical");
    expect(result.label).toBe("2 critical");
  });

  it("returns warning when warning_count > 0 and no critical", () => {
    const node: TopologyNode = {
      node_id: "site-1", node_type: "site", name: "Site", ip_address: "",
      vendor: "", model: "", site_id: "", site_name: null,
      health_status: "unknown", health_label: "Unknown",
      device_count: 10, critical_count: 0, warning_count: 3,
    };
    const result = deriveAggregatedHealth(node);
    expect(result.status).toBe("warning");
    expect(result.label).toBe("3 warning");
  });

  it("returns healthy when all devices are healthy", () => {
    const node: TopologyNode = {
      node_id: "site-1", node_type: "site", name: "Site", ip_address: "",
      vendor: "", model: "", site_id: "", site_name: null,
      health_status: "unknown", health_label: "Unknown",
      device_count: 5, critical_count: 0, warning_count: 0,
    };
    const result = deriveAggregatedHealth(node);
    expect(result.status).toBe("healthy");
    expect(result.label).toBe("All healthy");
  });

  it("handles missing optional fields gracefully", () => {
    const node: TopologyNode = {
      node_id: "site-1", node_type: "site", name: "Site", ip_address: "",
      vendor: "", model: "", site_id: "", site_name: null,
      health_status: "unknown", health_label: "Unknown",
    };
    const result = deriveAggregatedHealth(node);
    expect(result.status).toBe("unknown");
  });
});
