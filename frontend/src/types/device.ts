export type DeviceReachability = "reachable" | "unreachable" | "degraded" | "unknown";

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
  props?: { velobrain_score?: number; links?: VeloBrainLink[]; [key: string]: unknown };
}

export interface VeloBrainLink {
  name: string;
  interface: string;
  state: string;
  score_tx: number;
  score_rx: number;
  latency_ms_rx: number;
  latency_ms_tx: number;
  jitter_ms_rx: number;
  jitter_ms_tx: number;
  loss_pct_rx: number;
  loss_pct_tx: number;
  bps_rx: number;
  bps_tx: number;
  avg_mbps_rx?: number;
  avg_mbps_tx?: number;
  upstream_mbps?: number | null;
  downstream_mbps?: number | null;
  isp?: string;
  public_ip?: string;
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
