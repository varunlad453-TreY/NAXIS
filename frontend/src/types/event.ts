/**
 * Event type definitions
 *
 * Matches the backend Pydantic models from the Naxis API
 */

export type EventSeverity = "critical" | "major" | "minor" | "info";

export interface EventSummary {
  event_id: string;
  timestamp: string;
  source: string;
  severity: EventSeverity;
  category: string;
  event_type: string;
  title: string;
  description: string;
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  incident_id: string | null;
}

export interface EventListResponse {
  events: EventSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface EventFilterParams {
  source?: string;
  severity?: EventSeverity[];
  site_id?: string;
  device_id?: string;
  incident_id?: string;
  start_time?: string;
  end_time?: string;
  limit?: number;
  offset?: number;
}
