import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatBytes, formatRelativeTime, truncateId } from "../src/lib/format";

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
});
