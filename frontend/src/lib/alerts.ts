import type { IncidentSummary } from "@/types/incident";
import { getSeverityOrder } from "./utils";

export interface RootCauseGroup {
  key: string;
  siteName: string;
  rootDevice: string;
  incidents: IncidentSummary[];
}

/**
 * Group incidents by root cause.
 *
 * The correlation engine already deduplicates per root cause
 * (site + root device + category), but one root device can carry several
 * categories — each a separate incident. Group them under a single
 * "root device · site" header so operators see the cause once.
 */
export function groupByRootCause(incidents: IncidentSummary[]): RootCauseGroup[] {
  const groups = new Map<string, RootCauseGroup>();

  for (const incident of incidents) {
    const siteName = incident.site_name || "Unknown site";
    const rootDevice = incident.root_device || "Multiple devices";
    const key = `${siteName}::${rootDevice}`;
    const group = groups.get(key);
    if (group) {
      group.incidents.push(incident);
    } else {
      groups.set(key, { key, siteName, rootDevice, incidents: [incident] });
    }
  }

  const bySeverity = (g: RootCauseGroup) =>
    Math.min(...g.incidents.map((i) => getSeverityOrder(i.severity)));
  const newest = (g: RootCauseGroup) =>
    Math.max(...g.incidents.map((i) => new Date(i.created_at).getTime()));

  return [...groups.values()].sort(
    (a, b) => bySeverity(a) - bySeverity(b) || newest(b) - newest(a)
  );
}
