import { describe, expect, it } from "vitest";
import { parseReturnPathname } from "../src/lib/auth-return-path";

describe("auth-return-path", () => {
  it("accepts safe in-app paths and rejects open redirects", () => {
    expect(parseReturnPathname("/settings")).toBe("/settings");
    expect(parseReturnPathname("/artifacts/art_123")).toBe("/artifacts/art_123");
    expect(parseReturnPathname("/audit?request_id=req_1")).toBe("/audit?request_id=req_1");
    expect(parseReturnPathname("/claim")).toBe("/claim");
    expect(parseReturnPathname("//evil.test/phish")).toBeUndefined();
    expect(parseReturnPathname("https://evil.test")).toBeUndefined();
    expect(parseReturnPathname(null)).toBeUndefined();
  });
});
