import { describe, expect, it } from "vitest";
import { formatElapsed } from "./utils";

describe("formatElapsed", () => {
  const now = "2026-08-04T12:00:00Z";

  it("formats minutes", () => {
    expect(formatElapsed("2026-08-04T11:45:00Z", now)).toBe("15m");
  });

  it("formats hours and minutes", () => {
    expect(formatElapsed("2026-08-04T09:45:30Z", now)).toBe("2h 14m");
  });

  it("formats days and hours", () => {
    expect(formatElapsed("2026-08-01T11:00:00Z", now)).toBe("3d 1h");
  });

  it("says just now for under a minute", () => {
    expect(formatElapsed("2026-08-04T11:59:30Z", now)).toBe("just now");
  });

  it("never returns negative durations", () => {
    expect(formatElapsed("2026-08-05T00:00:00Z", now)).toBe("just now");
  });

  it("falls back gracefully on invalid input", () => {
    expect(formatElapsed("not-a-date", now)).toBe("—");
  });
});
