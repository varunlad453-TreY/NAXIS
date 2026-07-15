import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTopologyLayout } from "./use-topology-layout";
import type { TopologyNode, TopologyEdge } from "@/types/topology";

const mockNodes: TopologyNode[] = [
  {
    node_id: "core-switch-01",
    node_type: "switch",
    name: "naxis-core-01",
    ip_address: "10.0.0.1",
    vendor: "cisco",
    model: "C9300",
    site_id: "site-sfo-01",
    site_name: "SFO-01",
    health_status: "healthy",
    health_label: "Healthy",
  },
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
];

const mockEdges: TopologyEdge[] = [
  { src_id: "ap-sfo-101", dst_id: "core-switch-01", edge_type: "wired" },
];

const defaultInput = {
  nodes: mockNodes,
  edges: mockEdges,
  highlightSet: new Set<string>(),
  expandedSites: new Set<string>(),
  activeTypeFilters: new Set<string>(["ap", "switch", "site"]),
};

describe("useTopologyLayout", () => {
  it("starts empty (no render blocking), then computes after paint", async () => {
    const { result } = renderHook(() => useTopologyLayout(defaultInput));

    // Initially empty (render was not blocked)
    expect(result.current.layoutNodes).toHaveLength(0);
    expect(result.current.isComputing).toBe(true);

    // After the deferred setTimeout fires, layout should be computed
    await waitFor(() => {
      expect(result.current.layoutNodes.length).toBeGreaterThan(0);
      expect(result.current.isComputing).toBe(false);
    });
  });

  it("re-computes when inputs change", async () => {
    const { result, rerender } = renderHook(
      (input) => useTopologyLayout(input),
      { initialProps: defaultInput },
    );

    await waitFor(() => expect(result.current.isComputing).toBe(false));

    rerender({ ...defaultInput, expandedSites: new Set(["site-sfo-01"]) });

    expect(result.current.isComputing).toBe(true);

    await waitFor(() => {
      expect(result.current.layoutNodes.length).toBeGreaterThan(0);
      expect(result.current.isComputing).toBe(false);
    });
  });

  it("cleans up pending timeout on unmount", async () => {
    const { unmount } = renderHook(() => useTopologyLayout(defaultInput));
    // Unmount before the deferred computation runs
    unmount();
    // No error = pass
  });

  it("handles empty input gracefully", async () => {
    const emptyInput = {
      nodes: [] as TopologyNode[],
      edges: [] as TopologyEdge[],
      highlightSet: new Set<string>(),
      expandedSites: new Set<string>(),
      activeTypeFilters: new Set<string>(),
    };
    const { result } = renderHook(() => useTopologyLayout(emptyInput));

    await waitFor(() => {
      expect(result.current.layoutNodes).toHaveLength(0);
      expect(result.current.layoutEdges).toHaveLength(0);
      expect(result.current.isComputing).toBe(false);
    });
  });
});
