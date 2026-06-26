import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EventsPage from "@/app/events/page";
import DevicesPage from "@/app/devices/page";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    listEvents: vi.fn(),
    listDevices: vi.fn(),
  },
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("EventsPage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders event telemetry and filters by search and severity", async () => {
    (api.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue({
      events: [
        {
          event_id: "evt-1",
          timestamp: "2026-06-26T10:00:00Z",
          source: "dnac",
          severity: "critical",
          category: "network",
          event_type: "device_down",
          title: "Core Router Down",
          description: "Core router became unreachable",
          device_id: "dev-router-01",
          device_name: "Core Router 01",
          site_id: "site-nyc",
          site_name: "New York",
          incident_id: "inc-101",
        },
        {
          event_id: "evt-2",
          timestamp: "2026-06-26T09:40:00Z",
          source: "mist",
          severity: "info",
          category: "wireless",
          event_type: "ssid_notice",
          title: "Guest SSID Notice",
          description: "Informational wireless update",
          device_id: "dev-ap-02",
          device_name: "AP 02",
          site_id: "site-sfo",
          site_name: "San Francisco",
          incident_id: null,
        },
      ],
      total: 2,
      page: 1,
      page_size: 50,
    });

    const user = userEvent.setup();
    renderWithQueryClient(<EventsPage />);

    await waitFor(() => {
      expect(api.listEvents).toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    });

    await expect(screen.findByText("Core Router Down")).resolves.toBeInTheDocument();
    await expect(screen.findByText("Guest SSID Notice")).resolves.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search events, devices, sites, IDs..."), "router");

    await waitFor(() => {
      expect(screen.getByText("Core Router Down")).toBeInTheDocument();
      expect(screen.queryByText("Guest SSID Notice")).not.toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Filter by severity"), "critical");

    await waitFor(() => {
      expect(screen.getByText("Core Router Down")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Filter by severity"), "all");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(screen.getByText("Core Router Down")).toBeInTheDocument();
      expect(screen.getByText("Guest SSID Notice")).toBeInTheDocument();
    });
  });
});

describe("DevicesPage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the inventory and filters by platform, reachability, and search", async () => {
    (api.listDevices as ReturnType<typeof vi.fn>).mockResolvedValue({
      devices: [
        {
          device_id: "dev-1",
          platform: "dnac",
          hostname: "core-router-01",
          ip_address: "10.10.0.1",
          device_type: "Router",
          site_id: "site-nyc",
          site_name: "New York",
          reachability: "reachable",
          management_state: "managed",
          last_seen: "2026-06-26T10:00:00Z",
        },
        {
          device_id: "dev-2",
          platform: "mist",
          hostname: "branch-ap-02",
          ip_address: "10.10.1.2",
          device_type: "Access Point",
          site_id: "site-sfo",
          site_name: "San Francisco",
          reachability: "unreachable",
          management_state: "managed",
          last_seen: "2026-06-26T09:30:00Z",
        },
      ],
      total: 2,
      page: 1,
      page_size: 50,
    });

    const user = userEvent.setup();
    renderWithQueryClient(<DevicesPage />);

    await waitFor(() => {
      expect(api.listDevices).toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
    });

    await expect(screen.findByText("core-router-01")).resolves.toBeInTheDocument();
    await expect(screen.findByText("branch-ap-02")).resolves.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search devices, hostnames, sites, IPs..."), "branch");

    await waitFor(() => {
      expect(screen.getByText("branch-ap-02")).toBeInTheDocument();
      expect(screen.queryByText("core-router-01")).not.toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Filter by platform"), "mist");

    await waitFor(() => {
      expect(screen.getByText("branch-ap-02")).toBeInTheDocument();
      expect(screen.queryByText("core-router-01")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(screen.getByText("core-router-01")).toBeInTheDocument();
      expect(screen.getByText("branch-ap-02")).toBeInTheDocument();
    });
  });
});