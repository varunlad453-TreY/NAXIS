import { describe, expect, it } from "vitest";

import { buildStats } from "./incident-stats";
import type { IncidentStats, IncidentSummary } from "@/types/incident";

function makeIncident(overrides: Partial<IncidentSummary>): IncidentSummary {
  return {
    incident_id: "INC-1",
    title: "Test incident",
    severity: "major",
    severity_label: "Major",
    status: "open",
    event_count: 1,
    affected_sites_count: 1,
    affected_devices_count: 1,
    root_device_count: 1,
    symptom_device_count: 0,
    confidence_score: 0.8,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

const statsFromApi: IncidentStats = {
  total: 8845,
  active: 312,
  bySeverity: { critical: 40, major: 90, minor: 182, info: 0, warning: 0 },
  distinctSites: 14,
  distinctDevices: 96,
  avgConfidence: 0.71,
};

describe("buildStats", () => {
  it("uses SQL aggregates verbatim when the stats endpoint responds", () => {
    const stats = buildStats(statsFromApi, [makeIncident({})], 1);
    expect(stats).toEqual({
      critical: 40,
      major: 90,
      minor: 182,
      total: 8845,
      active: 312,
      avgConfidence: 0.71,
      distinctSites: 14,
      distinctDevices: 96,
    });
  });

  it("falls back to the list response's true total, not the page length", () => {
    const page = [
      makeIncident({}),
      makeIncident({ incident_id: "INC-2", status: "resolved" }),
    ];
    const stats = buildStats(undefined, page, 8845);
    expect(stats.total).toBe(8845);
    expect(stats.active).toBe(1);
  });

  it("averages confidence over the visible page only as a fallback", () => {
    const page = [
      makeIncident({ confidence_score: 0.5 }),
      makeIncident({ incident_id: "INC-2", confidence_score: 0.9 }),
    ];
    const stats = buildStats(undefined, page, 2);
    expect(stats.avgConfidence).toBeCloseTo(0.7);
  });

  it("zeroes avgConfidence and severity counts with no data", () => {
    const stats = buildStats(undefined, [], 0);
    expect(stats.avgConfidence).toBe(0);
    expect(stats.critical).toBe(0);
    expect(stats.major).toBe(0);
    expect(stats.minor).toBe(0);
    expect(stats.distinctSites).toBe(0);
    expect(stats.distinctDevices).toBe(0);
  });

  it("never lets a partial stats response overwrite a real total", () => {
    const partial = { ...statsFromApi, total: 0 };
    const stats = buildStats(partial, [makeIncident({})], 8845);
    expect(stats.total).toBe(0);
  });
});
