import { describe, expect, it } from "vitest";
import { ROUTE_PATHS, render } from "./entry-server";

// entry-server is the prerender entrypoint scripts/prerender.mjs calls per route.
// It captures BILLING_ENABLED / CF_WEB_ANALYTICS_TOKEN from the build env at
// module load; under the test process both are unset, i.e. the production-shaped
// build (billing off, no beacon).
const ASSETS = { cssHref: "/assets/styles.css", jsHref: "/assets/client.js" };

describe("entry-server prerender contract", () => {
  it("enumerates the production route set without /pricing", () => {
    expect(ROUTE_PATHS).toContain("/");
    expect(ROUTE_PATHS).toContain("/about");
    expect(ROUTE_PATHS).toContain("/how-it-works");
    expect(ROUTE_PATHS).toContain("/docs");
    expect(ROUTE_PATHS).not.toContain("/docs/billing");
    expect(ROUTE_PATHS).toContain("/terms");
    expect(ROUTE_PATHS).toContain("/privacy");
    expect(ROUTE_PATHS).not.toContain("/pricing");
  });

  it("renders a full static document for a route", () => {
    const html = render("/", ASSETS);
    expect(html.startsWith("<!doctype html>\n")).toBe(true);
    expect(html).toContain('<link rel="stylesheet" href="/assets/styles.css"/>');
    expect(html).toContain('<script type="module" src="/assets/client.js">');
    // Billing off in the test process: no beacon, no pricing link.
    expect(html).not.toContain("cloudflareinsights.com");
    expect(html).not.toContain('href="/pricing"');
  });

  it("throws on a path outside the route table", () => {
    expect(() => render("/pricing", ASSETS)).toThrow(/No apex route/);
  });
});
