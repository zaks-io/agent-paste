import { describe, expect, it } from "vitest";
import { formatBytes, truncateId } from "../src/lib/format";

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
});
