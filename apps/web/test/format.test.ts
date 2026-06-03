import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatBytes,
  formatRelativeTime,
  getRelativeTimeTickIntervalMs,
  truncateId,
} from "../src/lib/format";

describe("truncateId", () => {
  it("returns the original value when short enough to fit", () => {
    expect(truncateId("abc12345")).toBe("abc12345");
  });

  it("collapses long ids to lead…tail", () => {
    expect(truncateId("0123456789abcdef")).toBe("012345…cdef");
  });

  it("respects custom lead and tail lengths", () => {
    expect(truncateId("0123456789abcdef", 4, 2)).toBe("0123…ef");
  });
});

describe("formatBytes", () => {
  it("returns 0 B for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("returns whole bytes without a fraction", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes with one fraction digit", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("scales into megabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("clamps sub-byte input to the bytes unit", () => {
    expect(formatBytes(0.5)).toBe("1 B");
  });
});

describe("formatAbsoluteTime", () => {
  // Determinism is the whole point: SSR (UTC server) and client hydration must
  // produce identical text from the same input, or React aborts hydration (#418)
  // and the app goes non-interactive.
  it("is clock-independent and timezone-stable for the same input", () => {
    const iso = "2026-01-15T09:30:00.000Z";
    expect(formatAbsoluteTime(iso)).toBe(formatAbsoluteTime(iso));
    expect(formatAbsoluteTime(iso)).toMatch(/2026/);
    expect(formatAbsoluteTime(iso)).toMatch(/UTC/);
  });

  // Byte-lock the exact output so a future runtime-default drift (e.g. hour12
  // resolving to true on Workers but false in the browser) is caught here rather
  // than as a React #418 hydration abort in production. hour12:false is pinned in
  // formatAbsoluteTime precisely so this string is identical across runtimes.
  it("renders an exact, hour-cycle-pinned UTC string for a morning instant", () => {
    expect(formatAbsoluteTime("2026-01-15T09:30:00.000Z")).toBe("Jan 15, 2026, 09:30 UTC");
  });

  it("uses a 24-hour clock so afternoon instants carry no AM/PM marker", () => {
    expect(formatAbsoluteTime("2026-01-15T14:32:00.000Z")).toBe("Jan 15, 2026, 14:32 UTC");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatAbsoluteTime("not-a-date")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  // The injectable `now` is what lets <RelativeTime> pin a single timestamp so
  // server and first client paint agree instead of each reading their own clock.
  it("derives the relative string from the supplied now, not the wall clock", () => {
    const past = "2026-01-15T09:30:00.000Z";
    const now = Date.parse("2026-01-15T11:30:00.000Z");
    // Same (input, now) must always yield the same text — that determinism is
    // what keeps SSR and client hydration in agreement.
    const first = formatRelativeTime(past, now);
    expect(formatRelativeTime(past, now)).toBe(first);
    // A different now yields a different string, proving the wall clock is unused.
    const later = Date.parse("2026-02-15T11:30:00.000Z");
    expect(formatRelativeTime(past, later)).not.toBe(first);
  });

  it("reports very recent timestamps as just now", () => {
    const t = "2026-01-15T09:30:00.000Z";
    expect(formatRelativeTime(t, Date.parse(t) + 1000)).toBe("just now");
  });

  it("returns an empty string for an unparseable value instead of throwing", () => {
    // Intl.RelativeTimeFormat throws RangeError on a NaN date; guard against it.
    expect(formatRelativeTime("not-a-date")).toBe("");
  });
});

describe("getRelativeTimeTickIntervalMs", () => {
  const now = Date.parse("2026-06-03T12:00:00.000Z");

  it("returns no finite interval for an unparseable value", () => {
    expect(getRelativeTimeTickIntervalMs("not-a-date", now)).toBe(Number.POSITIVE_INFINITY);
  });

  it("uses a short cadence while the label is still in the just-now window", () => {
    const recent = Date.parse("2026-06-03T11:59:57.000Z");
    expect(getRelativeTimeTickIntervalMs(recent, now)).toBe(5_000);
  });

  it("uses second-, minute-, hour-, and day-scale cadences by age", () => {
    expect(getRelativeTimeTickIntervalMs("2026-06-03T11:59:20.000Z", now)).toBe(15_000);
    expect(getRelativeTimeTickIntervalMs("2026-06-03T11:30:00.000Z", now)).toBe(60_000);
    expect(getRelativeTimeTickIntervalMs("2026-06-03T00:00:00.000Z", now)).toBe(3_600_000);
    expect(getRelativeTimeTickIntervalMs("2026-05-01T12:00:00.000Z", now)).toBe(86_400_000);
  });
});
