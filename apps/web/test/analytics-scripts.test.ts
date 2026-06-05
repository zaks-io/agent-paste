import { describe, expect, it } from "vitest";
import { analyticsScripts } from "../src/lib/analytics-scripts";

describe("analyticsScripts", () => {
  it("returns no scripts when the token is missing or blank", () => {
    expect(analyticsScripts(undefined)).toEqual([]);
    expect(analyticsScripts("")).toEqual([]);
    expect(analyticsScripts("   ")).toEqual([]);
  });

  it("declares the Cloudflare beacon as a head() script entry (no JSX, so TanStack stamps the nonce)", () => {
    const [beacon, ...rest] = analyticsScripts("tok_123");
    expect(rest).toEqual([]);
    expect(beacon).toEqual({
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      defer: true,
      "data-cf-beacon": '{"token":"tok_123"}',
    });
  });

  it("trims surrounding whitespace from the token", () => {
    const [beacon] = analyticsScripts("  tok_123  ");
    expect(beacon?.["data-cf-beacon"]).toBe('{"token":"tok_123"}');
  });
});
