export type DeviceReachability = "reachable" | "unreachable" | "unknown";

export interface DeviceSummary {
  device_id: string;
  platform: string;
  hostname: string;
  mac: string;
  serial: string;
  model: string;
  ip_address: string;
  device_type: string;
  site_id: string;
  site_name: string;
  connected: boolean;
  reachability: DeviceReachability;
  num_clients: number;
  uptime_seconds: number;
  firmware_version: string;
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
  search?: string;
  limit?: number;
  offset?: number;
}
