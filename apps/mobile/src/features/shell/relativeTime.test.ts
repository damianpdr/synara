import { describe, expect, it } from "vitest";

import { formatAbsoluteDateTime, formatRelativeTime } from "./relativeTime";

const NOW = Date.parse("2025-06-15T12:00:00.000Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe("formatRelativeTime", () => {
  it("returns an empty string for missing or unparseable input", () => {
    expect(formatRelativeTime(null, NOW)).toBe("");
    expect(formatRelativeTime(undefined, NOW)).toBe("");
    expect(formatRelativeTime("not a date", NOW)).toBe("");
  });

  it("clamps sub-minute and skewed-future timestamps to now", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("now");
    expect(formatRelativeTime(ago(59_000), NOW)).toBe("now");
    expect(formatRelativeTime(new Date(NOW + 5_000).toISOString(), NOW)).toBe("now");
  });

  it("formats minutes, hours and days", () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe("1m");
    expect(formatRelativeTime(ago(59 * 60_000), NOW)).toBe("59m");
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe("1h");
    expect(formatRelativeTime(ago(23 * 3_600_000), NOW)).toBe("23h");
    expect(formatRelativeTime(ago(24 * 3_600_000), NOW)).toBe("1d");
    expect(formatRelativeTime(ago(6 * 86_400_000), NOW)).toBe("6d");
  });

  it("falls back to a day/month date beyond a week", () => {
    expect(formatRelativeTime("2025-03-12T09:00:00.000Z", NOW)).toBe("12 Mar");
  });

  it("includes the year for a different year", () => {
    expect(formatRelativeTime("2024-12-31T09:00:00.000Z", NOW)).toBe("31 Dec 2024");
  });
});

describe("formatAbsoluteDateTime", () => {
  it("returns an em dash for missing input", () => {
    expect(formatAbsoluteDateTime(null)).toBe("—");
    expect(formatAbsoluteDateTime("nope")).toBe("—");
  });

  it("formats a local day/month/year and zero-padded clock time", () => {
    // Constructed from local parts so the assertion holds in any TZ.
    const local = new Date(2025, 2, 12, 9, 5, 0);
    expect(formatAbsoluteDateTime(local.toISOString())).toBe("12 Mar 2025, 09:05");
  });
});
