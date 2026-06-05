import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebAnalyticsBeacon } from "../src/components/web-analytics-beacon";

describe("WebAnalyticsBeacon", () => {
  it("renders nothing when no token is configured", () => {
    expect(renderToString(<WebAnalyticsBeacon token={undefined} />)).toBe("");
    expect(renderToString(<WebAnalyticsBeacon token="" />)).toBe("");
    expect(renderToString(<WebAnalyticsBeacon token="   " />)).toBe("");
  });

  it("renders the Cloudflare beacon with the token when configured", () => {
    const html = renderToString(<WebAnalyticsBeacon token="tok_123" />);
    expect(html).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(html).toContain('data-cf-beacon="{&quot;token&quot;:&quot;tok_123&quot;}"');
    expect(html).toContain("defer");
  });

  it("trims surrounding whitespace from the token", () => {
    const html = renderToString(<WebAnalyticsBeacon token="  tok_123  " />);
    expect(html).toContain("&quot;token&quot;:&quot;tok_123&quot;");
  });
});
