/**
 * API client for Naxis backend
 */

import type {
  IncidentListResponse,
  IncidentDetail,
  HealthResponse,
  IncidentSeverity,
} from "@/types/incident";
import type { EventListResponse, EventFilterParams } from "@/types/event";
import type { DeviceListResponse, DeviceFilterParams } from "@/types/device";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = "APIError";
  }
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new APIError(
        errorData.detail || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError("Network error", 0, error);
  }
}

export const api = {
  /**
   * Health check
   */
  health: () => fetchAPI<HealthResponse>("/health"),

  /**
   * List all incidents
   */
  listIncidents: (params?: {
    severity?: IncidentSeverity[];
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.severity) {
      params.severity.forEach((s) => searchParams.append("severity", s));
    }
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const query = searchParams.toString();
    return fetchAPI<IncidentListResponse>(`/incidents${query ? `?${query}` : ""}`);
  },

  /**
   * List active incidents
   */
  listActiveIncidents: (params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const query = searchParams.toString();
    return fetchAPI<IncidentListResponse>(`/incidents/active${query ? `?${query}` : ""}`);
  },

  /**
   * Get incident by ID
   */
  getIncident: (id: string) => fetchAPI<IncidentDetail>(`/incidents/${id}`),

  /**
   * List events with optional filters
   */
  listEvents: (params?: EventFilterParams) => {
    const searchParams = new URLSearchParams();
    if (params?.source) searchParams.set("source", params.source);
    if (params?.severity) params.severity.forEach((s) => searchParams.append("severity", s));
    if (params?.site_id) searchParams.set("site_id", params.site_id);
    if (params?.device_id) searchParams.set("device_id", params.device_id);
    if (params?.incident_id) searchParams.set("incident_id", params.incident_id);
    if (params?.start_time) searchParams.set("start_time", params.start_time);
    if (params?.end_time) searchParams.set("end_time", params.end_time);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return fetchAPI<EventListResponse>(`/events${query ? `?${query}` : ""}`);
  },

  /**
   * List devices with optional filters
   */
  listDevices: (params?: DeviceFilterParams) => {
    const searchParams = new URLSearchParams();
    if (params?.platform) searchParams.set("platform", params.platform);
    if (params?.site_id) searchParams.set("site_id", params.site_id);
    if (params?.reachability) searchParams.set("reachability", params.reachability);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return fetchAPI<DeviceListResponse>(`/devices${query ? `?${query}` : ""}`);
  },

  /**
   * SD-WAN intelligence chat
   */
  sdwanChat: (message: string, history: Array<{ role: string; content: string }> = []) =>
    fetchAPI<{ answer: string; data?: unknown[]; intent: string }>("/sdwan/chat", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
};
