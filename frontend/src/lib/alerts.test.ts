import { describe, expect, it } from "vitest";
import { groupByRootCause } from "./alerts";
import type { IncidentSummary } from "@/types/incident";

function incident(overrides: Partial<IncidentSummary>): IncidentSummary {
  return {
    incident_id: "inc-1",
    title: "t",
    severity: "critical",
    severity_label: "Outage",
    status: "open",
    site_name: "",
    root_device: "",
    event_count: 1,
    affected_sites_count: 1,
    affected_devices_count: 1,
    root_device_count: 1,
    symptom_device_count: 0,
    confidence_score: 0.9,
    created_at: "2026-08-03T08:00:00",
    updated_at: "2026-08-03T08:00:00",
    ...overrides,
  };
}

describe("groupByRootCause", () => {
  it("groups incidents sharing a root device and site", () => {
    const groups = groupByRootCause([
      incident({
        incident_id: "inc-a",
        site_name: "Pune Plant",
        root_device: "EDGE-01",
        created_at: "2026-08-03T08:00:00",
      }),
      incident({
        incident_id: "inc-b",
        site_name: "Pune Plant",
        root_device: "EDGE-01",
        created_at: "2026-08-03T09:00:00",
      }),
      incident({
        incident_id: "inc-c",
        site_name: "Mumbai Site",
        root_device: "AP-44",
      }),
    ]);

    expect(groups).toHaveLength(2);
    const pune = groups.find((g) => g.key === "Pune Plant::EDGE-01");
    expect(pune?.incidents.map((i) => i.incident_id)).toEqual(["inc-a", "inc-b"]);
  });

  it("falls back to generic labels when names are missing", () => {
    const groups = groupByRootCause([
      incident({ incident_id: "inc-1", site_name: "", root_device: "" }),
    ]);

    expect(groups[0].siteName).toBe("Unknown site");
    expect(groups[0].rootDevice).toBe("Multiple devices");
  });

  it("sorts groups by worst severity then newest", () => {
    const groups = groupByRootCause([
      incident({
        incident_id: "minor-1",
        severity: "minor",
        site_name: "Site C",
        root_device: "AP-3",
        created_at: "2026-08-03T10:00:00",
      }),
      incident({
        incident_id: "critical-1",
        severity: "critical",
        site_name: "Site A",
        root_device: "EDGE-1",
        created_at: "2026-08-03T08:00:00",
      }),
      incident({
        incident_id: "major-1",
        severity: "major",
        site_name: "Site B",
        root_device: "SW-2",
        created_at: "2026-08-03T09:00:00",
      }),
    ]);

    expect(groups.map((g) => g.incidents[0].severity)).toEqual([
      "critical",
      "major",
      "minor",
    ]);
  });
});
