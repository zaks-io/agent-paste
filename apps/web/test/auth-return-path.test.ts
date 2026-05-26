import { describe, expect, it } from "vitest";
import {
  decodeReturnPathname,
  encodeReturnPathname,
  parseReturnPathname,
  signInBridgeHref,
} from "../src/lib/auth-return-path";

describe("auth-return-path", () => {
  it("accepts safe in-app paths and rejects open redirects", () => {
    expect(parseReturnPathname("/settings")).toBe("/settings");
    expect(parseReturnPathname("/artifacts/art_123")).toBe("/artifacts/art_123");
    expect(parseReturnPathname("/audit?request_id=req_1")).toBe("/audit?request_id=req_1");
    expect(parseReturnPathname("//evil.test/phish")).toBeUndefined();
    expect(parseReturnPathname("https://evil.test")).toBeUndefined();
    expect(parseReturnPathname(null)).toBeUndefined();
  });

  it("round-trips pathnames through the sign-in bridge href", () => {
    const pathname = "/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const href = signInBridgeHref(pathname);
    expect(href.startsWith("/api/auth/sign-in/p/")).toBe(true);
    const encoded = href.slice("/api/auth/sign-in/p/".length);
    expect(decodeReturnPathname(encoded)).toBe(pathname);
    expect(encodeReturnPathname(pathname)).toBe(encoded);
  });
});
