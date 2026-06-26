/**
 * Integration tests for Events and Devices pages
 * Tests the complete user flow from page load to interaction
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import EventsPage from "@/app/events/page";
import DevicesPage from "@/app/devices/page";

// Mock the API
vi.mock("@/lib/api", () => ({
  api: {
    listEvents: vi.fn(),
    listDevices: vi.fn(),
  },
}));

describe("Events and Devices Pages Integration", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  const renderWithProviders = (Component: React.ComponentType) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>
    );
  };

  describe("Events Page Flow", () => {
    it("should load and display events", async () => {
      const mockEvents = {
        events: [
          {
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
          },
        ],
        total: 1,
        page: 1,
        page_size: 50,
      };

      (api.listEvents as any).mockResolvedValue(mockEvents);

      renderWithProviders(EventsPage);

      await waitFor(() => {
        expect(api.listEvents).toHaveBeenCalled();
      });

      expect(screen.getByText("Device Down")).toBeInTheDocument();
      expect(screen.getByText("Router-01")).toBeInTheDocument();
    });

    it("should handle filtering events by severity", async () => {
      (api.listEvents as any).mockResolvedValue({
        events: [
          {
            event_id: "evt-1",
            timestamp: "2026-06-26T10:00:00Z",
            source: "dnac",
            severity: "critical",
            category: "network",
            event_type: "device_down",
            title: "Critical Event",
            description: "Critical issue",
            device_id: "dev-1",
            device_name: "Router-01",
            site_id: "site-1",
            site_name: "New York",
            incident_id: null,
          },
          {
            event_id: "evt-2",
            timestamp: "2026-06-26T09:00:00Z",
            source: "dnac",
            severity: "info",
            category: "network",
            event_type: "device_up",
            title: "Info Event",
            description: "Info notice",
            device_id: "dev-2",
            device_name: "Switch-01",
            site_id: "site-1",
            site_name: "New York",
            incident_id: null,
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(EventsPage);

      await waitFor(() => {
        expect(screen.getByText("Critical Event")).toBeInTheDocument();
      });

      const severitySelect = screen.getByLabelText("Filter by severity");
      await userEvent.selectOptions(severitySelect, "critical");

      await waitFor(() => {
        expect(screen.queryByText("Info Event")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Critical Event")).toBeInTheDocument();
    });

    it("should handle filtering events by source", async () => {
      (api.listEvents as any).mockResolvedValue({
        events: [
          {
            event_id: "evt-1",
            timestamp: "2026-06-26T10:00:00Z",
            source: "dnac",
            severity: "critical",
            category: "network",
            event_type: "device_down",
            title: "DNAC Event",
            description: "DNAC issue",
            device_id: "dev-1",
            device_name: "Router-01",
            site_id: "site-1",
            site_name: "New York",
            incident_id: null,
          },
          {
            event_id: "evt-2",
            timestamp: "2026-06-26T09:00:00Z",
            source: "mist",
            severity: "critical",
            category: "network",
            event_type: "device_down",
            title: "Mist Event",
            description: "Mist issue",
            device_id: "dev-2",
            device_name: "AP-01",
            site_id: "site-1",
            site_name: "New York",
            incident_id: null,
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(EventsPage);

      await waitFor(() => {
        expect(screen.getByText("DNAC Event")).toBeInTheDocument();
      });

      const sourceSelect = screen.getByLabelText("Filter by source");
      await userEvent.selectOptions(sourceSelect, "mist");

      await waitFor(() => {
        expect(screen.queryByText("DNAC Event")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Mist Event")).toBeInTheDocument();
    });

    it("should handle search", async () => {
      (api.listEvents as any).mockResolvedValue({
        events: [
          {
            event_id: "evt-1",
            timestamp: "2026-06-26T10:00:00Z",
            source: "dnac",
            severity: "critical",
            category: "network",
            event_type: "device_down",
            title: "Router Down",
            description: "Router issue",
            device_id: "dev-router",
            device_name: "Router-01",
            site_id: "site-1",
            site_name: "New York",
            incident_id: null,
          },
          {
            event_id: "evt-2",
            timestamp: "2026-06-26T09:00:00Z",
            source: "dnac",
            severity: "critical",
            category: "network",
            event_type: "device_down",
            title: "Switch Down",
            description: "Switch issue",
            device_id: "dev-switch",
            device_name: "Switch-01",
            site_id: "site-1",
            site_name: "New York",
            incident_id: null,
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(EventsPage);

      await waitFor(() => {
        expect(screen.getByText("Router Down")).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText("Search events, devices, sites, IDs...");
      await userEvent.type(input, "router");

      await waitFor(() => {
        expect(screen.queryByText("Switch Down")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Router Down")).toBeInTheDocument();
    });
  });

  describe("Devices Page Flow", () => {
    it("should load and display devices", async () => {
      const mockDevices = {
        devices: [
          {
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
          },
        ],
        total: 1,
        page: 1,
        page_size: 50,
      };

      (api.listDevices as any).mockResolvedValue(mockDevices);

      renderWithProviders(DevicesPage);

      await waitFor(() => {
        expect(api.listDevices).toHaveBeenCalled();
      });

      expect(screen.getByText("router-01")).toBeInTheDocument();
    });

    it("should filter devices by reachability", async () => {
      (api.listDevices as any).mockResolvedValue({
        devices: [
          {
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
          },
          {
            device_id: "dev-2",
            platform: "dnac",
            hostname: "router-02",
            ip_address: "192.168.1.2",
            device_type: "Router",
            site_id: "site-1",
            site_name: "New York",
            reachability: "unreachable",
            management_state: "managed",
            last_seen: "2026-06-26T09:00:00Z",
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(DevicesPage);

      await waitFor(() => {
        expect(screen.getByText("router-01")).toBeInTheDocument();
      });

      const reachabilitySelect = screen.getByLabelText("Filter by reachability");
      await userEvent.selectOptions(reachabilitySelect, "unreachable");

      await waitFor(() => {
        expect(screen.queryByText("router-01")).not.toBeInTheDocument();
      });
      expect(screen.getByText("router-02")).toBeInTheDocument();
    });

    it("should filter devices by platform", async () => {
      (api.listDevices as any).mockResolvedValue({
        devices: [
          {
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
          },
          {
            device_id: "dev-2",
            platform: "mist",
            hostname: "ap-01",
            ip_address: "192.168.1.2",
            device_type: "Access Point",
            site_id: "site-1",
            site_name: "New York",
            reachability: "reachable",
            management_state: "managed",
            last_seen: "2026-06-26T09:00:00Z",
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(DevicesPage);

      await waitFor(() => {
        expect(screen.getByText("router-01")).toBeInTheDocument();
      });

      const platformSelect = screen.getByLabelText("Filter by platform");
      await userEvent.selectOptions(platformSelect, "mist");

      await waitFor(() => {
        expect(screen.queryByText("router-01")).not.toBeInTheDocument();
      });
      expect(screen.getByText("ap-01")).toBeInTheDocument();
    });

    it("should handle search", async () => {
      (api.listDevices as any).mockResolvedValue({
        devices: [
          {
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
          },
          {
            device_id: "dev-2",
            platform: "dnac",
            hostname: "switch-01",
            ip_address: "192.168.1.2",
            device_type: "Switch",
            site_id: "site-1",
            site_name: "New York",
            reachability: "reachable",
            management_state: "managed",
            last_seen: "2026-06-26T09:00:00Z",
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(DevicesPage);

      await waitFor(() => {
        expect(screen.getByText("router-01")).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText("Search devices, hostnames, sites, IPs...");
      await userEvent.type(input, "router");

      await waitFor(() => {
        expect(screen.queryByText("switch-01")).not.toBeInTheDocument();
      });
      expect(screen.getByText("router-01")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      (api.listEvents as any).mockRejectedValue(new Error("API Error"));

      renderWithProviders(EventsPage);

      await waitFor(() => {
        expect(screen.getByText("Failed to load events")).toBeInTheDocument();
      });
    });

    it("should show empty state when no events", async () => {
      (api.listEvents as any).mockResolvedValue({
        events: [],
        total: 0,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(EventsPage);

      await waitFor(() => {
        expect(screen.getByText("No events found")).toBeInTheDocument();
      });
    });

    it("should show empty state when no devices", async () => {
      (api.listDevices as any).mockResolvedValue({
        devices: [],
        total: 0,
        page: 1,
        page_size: 50,
      });

      renderWithProviders(DevicesPage);

      await waitFor(() => {
        expect(screen.getByText("No devices found")).toBeInTheDocument();
      });
    });
  });
});
