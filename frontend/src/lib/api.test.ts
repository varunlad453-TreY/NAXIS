/**
 * API client tests for event and device endpoints
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { api } from "@/lib/api";

// Mock fetch
global.fetch = vi.fn();

describe("API Client - Events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch events with no filters", async () => {
    const mockResponse = {
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
      page_size: 100,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await api.listEvents();

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/events"),
      expect.any(Object)
    );
  });

  it("should fetch events with severity filter", async () => {
    const mockResponse = {
      events: [],
      total: 0,
      page: 1,
      page_size: 100,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await api.listEvents({ severity: ["critical", "major"] });

    const callUrl = ((global.fetch as any).mock.calls[0][0] as string);
    expect(callUrl).toContain("severity=critical");
    expect(callUrl).toContain("severity=major");
  });

  it("should fetch events with pagination", async () => {
    const mockResponse = {
      events: [],
      total: 200,
      page: 2,
      page_size: 50,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await api.listEvents({ limit: 50, offset: 50 });

    const callUrl = ((global.fetch as any).mock.calls[0][0] as string);
    expect(callUrl).toContain("limit=50");
    expect(callUrl).toContain("offset=50");
  });

  it("should handle API errors", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Internal server error" }),
    });

    await expect(api.listEvents()).rejects.toThrow();
  });
});

describe("API Client - Devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch devices with no filters", async () => {
    const mockResponse = {
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
      page_size: 100,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await api.listDevices();

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/devices"),
      expect.any(Object)
    );
  });

  it("should fetch devices with platform filter", async () => {
    const mockResponse = {
      devices: [],
      total: 0,
      page: 1,
      page_size: 100,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await api.listDevices({ platform: "mist" });

    const callUrl = ((global.fetch as any).mock.calls[0][0] as string);
    expect(callUrl).toContain("platform=mist");
  });

  it("should fetch devices with reachability filter", async () => {
    const mockResponse = {
      devices: [],
      total: 0,
      page: 1,
      page_size: 100,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await api.listDevices({ reachability: "unreachable" });

    const callUrl = ((global.fetch as any).mock.calls[0][0] as string);
    expect(callUrl).toContain("reachability=unreachable");
  });
});
