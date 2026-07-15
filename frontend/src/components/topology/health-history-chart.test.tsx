import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthHistoryChart } from "./health-history-chart";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";

const mockNodeHealthHistory = (
  overrides?: Partial<{
    history: { snapshot_at: string; health_status: string }[];
    summary: Record<string, number>;
    isLoading: boolean;
    error: boolean;
  }>,
) => {
  const {
    history,
    summary,
    isLoading = false,
    error = false,
  } = overrides ?? {};

  const hasData = history !== undefined || summary !== undefined;

  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: hasData
      ? { node_id: "test-node", history: history ?? [], summary: summary ?? {} }
      : undefined,
    isLoading,
    error: error ? new Error("fail") : null,
  });
};

describe("HealthHistoryChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeleton when isLoading is true", () => {
    mockNodeHealthHistory({ isLoading: true });
    render(<HealthHistoryChart nodeId="test-node" />);
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders error message when error is present", () => {
    mockNodeHealthHistory({ error: true });
    render(<HealthHistoryChart nodeId="test-node" />);
    expect(screen.getByText("Failed to load health history")).toBeDefined();
  });

  it("renders error message when data is null", () => {
    mockNodeHealthHistory({});
    render(<HealthHistoryChart nodeId="test-node" />);
    expect(screen.getByText("Failed to load health history")).toBeDefined();
  });

  it("renders empty state when history is empty", () => {
    mockNodeHealthHistory({ history: [], summary: {} });
    render(<HealthHistoryChart nodeId="test-node" />);
    expect(screen.getByText("No health history data available yet")).toBeDefined();
  });

  it("renders chart and summary with data", () => {
    mockNodeHealthHistory({
      history: [
        { snapshot_at: "2026-07-08T10:00:00Z", health_status: "healthy" },
        { snapshot_at: "2026-07-08T11:00:00Z", health_status: "warning" },
        { snapshot_at: "2026-07-08T12:00:00Z", health_status: "critical" },
        { snapshot_at: "2026-07-08T13:00:00Z", health_status: "unknown" },
      ],
      summary: { healthy: 1, warning: 1, critical: 1, unknown: 1 },
    });
    render(<HealthHistoryChart nodeId="test-node" />);

    expect(screen.getByText("Health Timeline")).toBeDefined();

    expect(screen.getAllByText("25%")).toHaveLength(4);

    expect(screen.getByText("6H")).toBeDefined();
    expect(screen.getByText("24H")).toBeDefined();
    expect(screen.getByText("7D")).toBeDefined();
  });

  it("renders range toggle buttons", () => {
    mockNodeHealthHistory({
      history: [
        { snapshot_at: "2026-07-08T10:00:00Z", health_status: "healthy" },
      ],
      summary: { healthy: 1, warning: 0, critical: 0, unknown: 0 },
    });
    render(<HealthHistoryChart nodeId="test-node" />);

    expect(screen.getByText("6H")).toBeDefined();
    expect(screen.getByText("24H")).toBeDefined();
    expect(screen.getByText("7D")).toBeDefined();
  });
});
