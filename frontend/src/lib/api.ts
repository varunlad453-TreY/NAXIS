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
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

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
        ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
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

  /**
   * Mist AP lifecycle history
   */
  mistApHistory: (serial: string, params?: MistHistoryParams) => {
    const q = new URLSearchParams();
    if (params?.event) q.set("event", params.event);
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    const qs = q.toString();
    return fetchAPI<MistHistoryResponse>(
      `/mist/aps/${encodeURIComponent(serial)}/history${qs ? `?${qs}` : ""}`
    );
  },

  mistApHistoryCsvUrl: (serial: string, params?: MistHistoryParams) => {
    const q = new URLSearchParams();
    if (params?.event) q.set("event", params.event);
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    const qs = q.toString();
    return `${API_BASE}/mist/aps/${encodeURIComponent(serial)}/history.csv${qs ? `?${qs}` : ""}`;
  },

  /**
   * Mist client 1:1 timeline (live pass-through)
   */
  mistClientTimeline: (mac: string, params?: MistClientTimelineParams) => {
    const q = new URLSearchParams();
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    const qs = q.toString();
    return fetchAPI<MistClientTimeline>(
      `/mist/clients/${encodeURIComponent(mac)}/timeline${qs ? `?${qs}` : ""}`
    );
  },

  mistClientTimelineCsvUrl: (mac: string, params?: MistClientTimelineParams) => {
    const q = new URLSearchParams();
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    const qs = q.toString();
    return `${API_BASE}/mist/clients/${encodeURIComponent(mac)}/timeline.csv${qs ? `?${qs}` : ""}`;
  },

  mistSleAnomalies: (params?: MistSleParams) => {
    const q = new URLSearchParams();
    if (params?.window) q.set("window", String(params.window));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sle) q.set("sle", params.sle);
    if (params?.z_threshold != null) q.set("z_threshold", String(params.z_threshold));
    const qs = q.toString();
    return fetchAPI<MistSleAnomalyResponse>(`/mist/sle/anomalies${qs ? `?${qs}` : ""}`);
  },

  mistSleAnomaliesCsvUrl: (params?: MistSleParams) => {
    const q = new URLSearchParams();
    if (params?.window) q.set("window", String(params.window));
    if (params?.sle) q.set("sle", params.sle);
    if (params?.z_threshold != null) q.set("z_threshold", String(params.z_threshold));
    q.set("limit", "1000");
    return `${API_BASE}/mist/sle/anomalies.csv?${q.toString()}`;
  },
};

export type MistLifecycleEvent =
  | "first_seen"
  | "firmware_change"
  | "site_move"
  | "rename"
  | "hardware_replaced"
  | "reachability"
  | "reboot";

export interface MistHistoryParams {
  event?: MistLifecycleEvent;
  since?: string;
  until?: string;
}

export interface MistHistoryEntry {
  observed_at: string;
  event: MistLifecycleEvent;
  field: string | null;
  from_value: string | number | null;
  to_value: string | number | null;
  site_name: string;
  hostname: string;
  firmware: string;
  reachability: string;
  uptime_s: number;
}

export interface MistHistoryResponse {
  serial: string;
  count: number;
  events: MistHistoryEntry[];
}

export interface MistClientTimelineParams {
  since?: string;
  until?: string;
}

export interface MistClientCurrent {
  site_id: string | null;
  site_name: string | null;
  ap: string | null;
  ssid: string | null;
  band: string | null;
  connected_since: string | null;
  rssi: number | null;
  hostname: string | null;
  ip: string | null;
}

export interface MistClientSession {
  site_id: string;
  site_name: string;
  ap: string | null;
  ssid: string | null;
  band: string | null;
  started: string | null;
  ended: string | null;
  duration_s: number | null;
  disconnect_reason: string | null;
}

export interface MistClientEvent {
  ts: string | null;
  site_id: string;
  site_name: string;
  ap: string | null;
  type: string | null;
  ssid: string | null;
  band: string | null;
  detail: string | null;
}

export interface MistSiteSeen {
  site_id: string;
  site_name: string;
  first_seen: string;
  last_seen: string;
}

export interface MistClientTimeline {
  mac: string;
  window: { since: string; until: string };
  current: MistClientCurrent | null;
  sessions: MistClientSession[];
  events: MistClientEvent[];
  sites_seen: MistSiteSeen[];
}

export interface MistSleParams {
  window?: number;
  limit?: number;
  sle?: string;
  z_threshold?: number;
}

export interface MistSleAnomaly {
  site_id: string;
  site_name: string;
  sle: string;
  current: number;
  org_mean: number;
  org_sd: number;
  z_score: number;
  delta_pct: number;
  num_aps: number;
  num_clients: number;
}

export interface MistSleAnomalyResponse {
  window_hours: number;
  count: number;
  anomalies: MistSleAnomaly[];
}
