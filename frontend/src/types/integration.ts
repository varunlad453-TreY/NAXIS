export type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "testing" | "error";

export type CollectorOperationalStatus = "active" | "working" | "inactive" | "notConfigured";

export interface IntegrationCollectorSummary {
  id: string;
  label: string;
  status: IntegrationStatus;
  operationalStatus: CollectorOperationalStatus;
  lastSync: string | null;
  healthScore: number | null;
  message: string | null;
  collects: string[];
  purpose: string | null;
  output: string | null;
  whyItMatters: string | null;
}

export interface IntegrationConfigItem {
  label: string;
  value: string;
  masked: boolean;
}

export interface IntegrationConfigGroup {
  title: string;
  items: IntegrationConfigItem[];
}

export interface IntegrationConfigResponse {
  integrationId: string;
  status: IntegrationStatus;
  configured: boolean;
  comingSoon: boolean;
  validationMessage: string | null;
  lastTestedAt: string | null;
  recentErrors: string[];
  groups: IntegrationConfigGroup[];
  collectors: IntegrationCollectorSummary[];
}

export interface Integration {
  id: string;
  name: string;
  vendor: string;
  description: string;
  icon: string;
  status: IntegrationStatus;
  configured: boolean;
  comingSoon: boolean;
  lastSync: string | null;
  healthScore: number | null;
  eventsCollected: number;
  errors: string[];
  collectors: IntegrationCollectorSummary[];
  config?: IntegrationConfigResponse;
}

export interface IntegrationListResponse {
  integrations: Integration[];
  total: number;
  connected: number;
  disconnected: number;
  notConfigured: number;
  averageHealth: number | null;
  totalEventsCollected: number;
}

export interface IntegrationActionResponse {
  success: boolean;
  message: string;
  integration: Integration;
}

export interface IntegrationDetailResponse extends Integration {
  config: IntegrationConfigResponse;
}

export type TelemetryAlertSeverity = "warning" | "critical";

export type TelemetryAlertType = "staleData" | "repeatedFailure" | "dataGap";

export interface TelemetryAlert {
  severity: TelemetryAlertSeverity;
  type: TelemetryAlertType;
  collectorId: string;
  sourceSystem: string;
  message: string;
  failureCount?: number;
  ageSeconds?: number;
}

export interface TelemetryAlertsResponse {
  alerts: TelemetryAlert[];
  count: number;
}

export interface TelemetryCollectorEntry {
  collectorId: string;
  sourceSystem: string;
  lastRun: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  lastStatus: string;
  failureCount: number;
  currentAgeSeconds: number | null;
  durationMs: number | null;
  rowsWritten: number | null;
  derivedStatus: string;
}

export interface TelemetrySummary {
  totalCollectors: number;
  healthy: number;
  degraded: number;
  stale: number;
  error: number;
  notConfigured: number;
  alertCount: number;
}

export interface TelemetryResponse {
  collectors: TelemetryCollectorEntry[];
  alerts: TelemetryAlert[];
  summary: TelemetrySummary;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  vendor: string;
  description: string;
  icon: string;
  comingSoon?: boolean;
}