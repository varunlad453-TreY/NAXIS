/**
 * Incident type definitions
 *
 * Matches the backend Pydantic models from the Naxis API
 */

export type IncidentSeverity = "critical" | "major" | "minor" | "info";
export type IncidentStatus = "open" | "investigating" | "mitigated" | "resolved" | "closed" | "suppressed";

export interface IncidentSummary {
  incident_id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  event_count: number;
  affected_sites_count: number;
  affected_devices_count: number;
  affected_clients_count: number;
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export interface IncidentDetail extends IncidentSummary {
  affected_sites: string[];
  affected_devices: string[];
  affected_clients: string[];
  related_event_ids: string[];
  probable_cause: string | null;
}

export interface IncidentListResponse {
  incidents: IncidentSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}
