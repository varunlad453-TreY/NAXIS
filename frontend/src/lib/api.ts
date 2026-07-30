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
import type {
  IntegrationListResponse,
  IntegrationDetailResponse,
  IntegrationConfigResponse,
  IntegrationActionResponse,
  TelemetryAlertsResponse,
  TelemetryResponse,
} from "@/types/integration";
import type {
  TopologyGraphResponse,
  TopologySummaryResponse,
  TopologyNodeDetail,
  BlastRadiusResponse,
  NodeHealthHistoryResponse,
  SiteSummaryResponse,
} from "@/types/topology";

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

function toCamelCase(str: string): string {
  return str.replace(/([-_][a-z])/g, (g) => g.toUpperCase().replace(/[-_]/g, ""));
}

function camelizeKeys<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map((v) => camelizeKeys(v as unknown as Record<string, unknown>)) as unknown as T;
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [toCamelCase(k), camelizeKeys(v)])
    ) as unknown as T;
  }
  return obj;
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

  listIntegrations: () =>
    fetchAPI<IntegrationListResponse>("/integrations").then((r) => camelizeKeys(r)),

  getIntegration: (id: string) =>
    fetchAPI<IntegrationDetailResponse>(`/integrations/${encodeURIComponent(id)}`).then((r) =>
      camelizeKeys(r)
    ),

  testIntegration: (id: string) =>
    fetchAPI<IntegrationActionResponse>(`/integrations/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }).then((r) => camelizeKeys(r)),

  syncIntegration: (id: string) =>
    fetchAPI<IntegrationActionResponse>(`/integrations/${encodeURIComponent(id)}/sync`, {
      method: "POST",
    }).then((r) => camelizeKeys(r)),

  getIntegrationConfig: (id: string) =>
    fetchAPI<IntegrationConfigResponse>(`/integrations/${encodeURIComponent(id)}/config`).then(
      (r) => camelizeKeys(r)
    ),

  listTelemetryAlerts: () =>
    fetchAPI<TelemetryAlertsResponse>("/telemetry/alerts").then((r) => camelizeKeys(r)),

  getTelemetry: () =>
    fetchAPI<TelemetryResponse>("/telemetry").then((r) => camelizeKeys(r)),

  getCorrelationStats: () =>
    fetchAPI<Record<string, unknown>>("/correlation/stats").then((r) => camelizeKeys(r)),

  /**
   * Get full topology graph
   */
  getTopology: (params?: { site_id?: string; node_type?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.site_id) searchParams.set("site_id", params.site_id);
    if (params?.node_type) searchParams.set("node_type", params.node_type);
    const query = searchParams.toString();
    return fetchAPI<TopologyGraphResponse>(`/topology${query ? `?${query}` : ""}`);
  },

  /**
   * Get backbone topology — site nodes + inter-site edges only.
   * Default landing view — lightweight, fast.
   */
  getTopologyBackbone: () => fetchAPI<TopologyGraphResponse>("/topology/backbone"),

  /**
   * Get internal topology for a single site — all nodes + edges inside a site.
   * Called when user clicks a site in the backbone view.
   */
  getSiteTopology: (siteId: string) =>
    fetchAPI<TopologyGraphResponse>(`/topology/sites/${encodeURIComponent(siteId)}/internal`),

  getSiteSummary: (siteId: string) =>
    fetchAPI<SiteSummaryResponse>(`/topology/sites/${encodeURIComponent(siteId)}/summary`),

  /**
   * Get topology summary
   */
  getTopologySummary: () => fetchAPI<TopologySummaryResponse>("/topology/summary"),

  /**
   * Get single topology node with neighbours
   */
  getTopologyNode: (nodeId: string) =>
    fetchAPI<TopologyNodeDetail>(`/topology/nodes/${encodeURIComponent(nodeId)}`),

  /**
   * Get blast radius subgraph for an incident
   */
  getBlastRadius: (incidentId: string) =>
    fetchAPI<BlastRadiusResponse>(`/topology/blast-radius/${encodeURIComponent(incidentId)}`),

  /**
   * Get health history timeline for a topology node
   */
  getNodeHealthHistory: (nodeId: string, params?: { hours_back?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.hours_back) searchParams.set("hours_back", String(params.hours_back));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const query = searchParams.toString();
    return fetchAPI<NodeHealthHistoryResponse>(
      `/topology/nodes/${encodeURIComponent(nodeId)}/health-history${query ? `?${query}` : ""}`,
    );
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
