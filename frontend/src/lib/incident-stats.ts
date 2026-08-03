import type { IncidentStats, IncidentSummary } from "@/types/incident";

const ACTIVE_STATUSES = ["open", "investigating", "mitigated"];

export interface KpiValues {
  critical: number;
  major: number;
  minor: number;
  total: number;
  active: number;
  avgConfidence: number;
  distinctSites: number;
  distinctDevices: number;
}

export function buildStats(
  kpiData: IncidentStats | undefined,
  incidents: IncidentSummary[],
  totalIncidents: number
): KpiValues {
  return {
    critical: kpiData?.bySeverity.critical ?? 0,
    major: kpiData?.bySeverity.major ?? 0,
    minor: kpiData?.bySeverity.minor ?? 0,
    total: kpiData?.total ?? totalIncidents,
    active: kpiData?.active ?? incidents.filter((i) => ACTIVE_STATUSES.includes(i.status)).length,
    avgConfidence:
      kpiData?.avgConfidence ??
      (incidents.length > 0
        ? incidents.reduce((sum, i) => sum + i.confidence_score, 0) / incidents.length
        : 0),
    distinctSites: kpiData?.distinctSites ?? 0,
    distinctDevices: kpiData?.distinctDevices ?? 0,
  };
}
