import { describe, expect, it } from "vite-plus/test";

import {
  formatApproximateAge,
  formatDayAwareTimestamp,
  formatUpcomingTimestamp,
} from "./timestampFormat";

describe("formatApproximateAge", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("spells out the largest whole unit", () => {
    expect(formatApproximateAge(ago(30), now)).toBe("just now");
    expect(formatApproximateAge(ago(60), now)).toBe("1 minute ago");
    expect(formatApproximateAge(ago(3 * 60 + 59), now)).toBe("3 minutes ago");
    expect(formatApproximateAge(ago(14 * 3600), now)).toBe("14 hours ago");
    expect(formatApproximateAge(ago(6 * 86_400), now)).toBe("6 days ago");
    expect(formatApproximateAge(ago(29 * 86_400), now)).toBe("4 weeks ago");
    expect(formatApproximateAge(ago(90 * 86_400), now)).toBe("3 months ago");
    expect(formatApproximateAge(ago(800 * 86_400), now)).toBe("2 years ago");
  });

  it("treats future and invalid dates safely", () => {
    expect(formatApproximateAge(ago(-120), now)).toBe("just now");
    expect(formatApproximateAge("not a date", now)).toBe("");
  });
});

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });
});
