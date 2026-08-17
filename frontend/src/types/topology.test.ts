import { describe, it, expect } from "vitest";
import { NODE_TYPE_META, HEALTH_STATUS_META } from "./topology";

describe("NODE_TYPE_META", () => {
  it("covers all expected core network types", () => {
    const coreTypes = ["switch", "core_switch", "distribution_switch", "access_switch", "router", "controller"];
    for (const t of coreTypes) {
      expect(NODE_TYPE_META[t]).toBeDefined();
      expect(NODE_TYPE_META[t].category).toBe("core_network");
    }
  });

  it("covers all expected edge security types", () => {
    const edgeTypes = ["wan_edge", "gateway", "firewall"];
    for (const t of edgeTypes) {
      expect(NODE_TYPE_META[t]).toBeDefined();
      expect(NODE_TYPE_META[t].category).toBe("edge_security");
    }
  });

  it("marks ap and access_point as 'wireless' category", () => {
    expect(NODE_TYPE_META["ap"].category).toBe("wireless");
    expect(NODE_TYPE_META["access_point"].category).toBe("wireless");
  });

  it("marks client, endpoint, sensor, camera, iot as 'leaf' category", () => {
    const leafTypes = ["client", "endpoint", "sensor", "camera", "iot"];
    for (const t of leafTypes) {
      expect(NODE_TYPE_META[t].category).toBe("leaf");
    }
  });

  it("has a label for every entry", () => {
    for (const [key, meta] of Object.entries(NODE_TYPE_META)) {
      expect(meta.label, `Missing label for ${key}`).toBeTruthy();
    }
  });

  it("has a color for every entry", () => {
    for (const [key, meta] of Object.entries(NODE_TYPE_META)) {
      expect(meta.color, `Missing color for ${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("falls back gracefully for unknown types via default", () => {
    const unknown = NODE_TYPE_META["nonexistent_type"];
    expect(unknown).toBeUndefined();
  });
});

describe("HEALTH_STATUS_META", () => {
  it("covers all expected health statuses", () => {
    const statuses = ["healthy", "warning", "critical", "unknown"];
    for (const s of statuses) {
      expect(HEALTH_STATUS_META[s]).toBeDefined();
    }
  });

  it("has a color for every entry", () => {
    for (const [key, meta] of Object.entries(HEALTH_STATUS_META)) {
      expect(meta.color, `Missing color for ${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has a bgColor for every entry", () => {
    for (const [key, meta] of Object.entries(HEALTH_STATUS_META)) {
      expect(meta.bgColor, `Missing bgColor for ${key}`).toMatch(/^rgba\(/);
    }
  });

  it("has a label for every entry", () => {
    for (const [key, meta] of Object.entries(HEALTH_STATUS_META)) {
      expect(meta.label, `Missing label for ${key}`).toBeTruthy();
    }
  });

  it("falls back gracefully for unknown status", () => {
    const fallback = HEALTH_STATUS_META["nonexistent"];
    expect(fallback).toBeUndefined();
  });

  it("marks healthy as green", () => {
    expect(HEALTH_STATUS_META.healthy.color).toBe("#22c55e");
  });

  it("marks critical as red", () => {
    expect(HEALTH_STATUS_META.critical.color).toBe("#ef4444");
  });

  it("marks warning as yellow", () => {
    expect(HEALTH_STATUS_META.warning.color).toBe("#eab308");
  });

  it("marks unknown as gray", () => {
    expect(HEALTH_STATUS_META.unknown.color).toBe("#6b7280");
  });
});
