/**
 * Device type definitions
 *
 * Matches the backend Pydantic models from the Naxis API
 */

export type DeviceReachability = "reachable" | "unreachable" | "unknown";

export interface DeviceSummary {
  device_id: string;
  platform: string;
  hostname: string;
  ip_address: string;
  device_type: string;
  site_id: string;
  site_name: string;
  reachability: DeviceReachability;
  management_state: string;
  last_seen: string | null;
}

export interface DeviceListResponse {
  devices: DeviceSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface DeviceFilterParams {
  platform?: string;
  site_id?: string;
  reachability?: DeviceReachability;
  limit?: number;
  offset?: number;
}
