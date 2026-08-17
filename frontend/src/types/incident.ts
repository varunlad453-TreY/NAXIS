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
  severity_label: string;
  status: IncidentStatus;
  site_name?: string;
  root_device?: string;
  event_count: number;
  affected_sites_count: number;
  affected_devices_count: number;
  root_device_count: number;
  symptom_device_count: number;
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export interface ConfidenceBreakdown {
  event_score: number;
  avg_severity: number;
  device_score: number;
  total: number;
}

export interface IncidentDetail extends IncidentSummary {
  affected_sites: string[];
  affected_devices: string[];
  affected_clients: string[];
  root_device_ids: string[];
  symptom_device_ids: string[];
  related_event_ids: string[];
  probable_cause: string | null;
  topology_node_ids: string[];
  confidence_breakdown: ConfidenceBreakdown | null;
}

export interface IncidentListResponse {
  incidents: IncidentSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface IncidentStats {
  total: number;
  active: number;
  bySeverity: Record<IncidentSeverity | "warning", number>;
  distinctSites: number;
  distinctDevices: number;
  avgConfidence: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}
