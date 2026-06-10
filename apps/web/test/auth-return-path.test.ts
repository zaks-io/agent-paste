import { describe, expect, it } from "vitest";
import { parseReturnPathname } from "../src/lib/auth-return-path";

describe("auth-return-path", () => {
  it("accepts safe in-app paths and rejects open redirects", () => {
    expect(parseReturnPathname("/settings")).toBe("/settings");
    expect(parseReturnPathname("/artifacts/art_123")).toBe("/artifacts/art_123");
    expect(parseReturnPathname("/audit?request_id=req_1")).toBe("/audit?request_id=req_1");
    expect(parseReturnPathname("/claim")).toBe("/claim");
    expect(parseReturnPathname("//evil.test/phish")).toBeUndefined();
    expect(parseReturnPathname("/\\evil.test/phish")).toBeUndefined();
    expect(parseReturnPathname("/settings\\evil")).toBeUndefined();
    expect(parseReturnPathname("https://evil.test")).toBeUndefined();
    expect(parseReturnPathname(null)).toBeUndefined();
  });

  it("rejects paths containing control characters", () => {
    expect(parseReturnPathname("/settings\r\nSet-Cookie: x=1")).toBeUndefined();
    expect(parseReturnPathname("/settings\rinjected")).toBeUndefined();
    expect(parseReturnPathname("/settings\ninjected")).toBeUndefined();
    expect(parseReturnPathname("/settings\tinjected")).toBeUndefined();
    expect(parseReturnPathname("/settings\x00")).toBeUndefined();
    expect(parseReturnPathname("/settings\x7f")).toBeUndefined();
  });
});
