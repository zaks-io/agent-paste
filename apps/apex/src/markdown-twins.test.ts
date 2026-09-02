import { describe, expect, it } from "vitest";
import { textAssets } from "./build/text-assets";
import { markdownLink, markdownTwinPath, requireMarkdownTwin } from "./markdown-twins";
import { getRoutes } from "./routes";

const BILLING_MODES = [true, false];

// `requireMarkdownTwin` throws, and `textAssets()` runs per request, so an
// unmapped route is a request-time 500 across every text asset (including the
// `curl | sh` install scripts). These derive the twin set from the real route
// table instead of listing it, so that drift fails here rather than in prod.
describe("Markdown twin coverage", () => {
  it.each(BILLING_MODES)("maps every prerendered route when billing is %s", (billingEnabled) => {
    const unmapped = getRoutes(billingEnabled)
      .map((route) => route.path)
      .filter((path) => !markdownTwinPath(path));
    expect(unmapped).toEqual([]);
  });

  it.each(BILLING_MODES)("serves a body for every twin when billing is %s", (billingEnabled) => {
    const assets = textAssets({ origin: "https://agent-paste.sh", billingEnabled });
    for (const route of getRoutes(billingEnabled)) {
      const asset = assets.find((entry) => entry.path === requireMarkdownTwin(route.path));
      expect(asset, `no Markdown twin asset for ${route.path}`).toBeDefined();
      expect(asset?.contentType).toBe("text/markdown; charset=utf-8");
      expect(asset?.body).toMatch(/^# \S/);
    }
  });

  it("keeps billing-gated twins out of the no-billing build", () => {
    const paths = textAssets({ origin: "https://agent-paste.sh", billingEnabled: false }).map((entry) => entry.path);
    expect(paths).not.toContain("/pricing.md");
    expect(paths).not.toContain("/docs/billing.md");
  });
});

describe("markdownLink", () => {
  it("points an on-site link at the twin and preserves the fragment", () => {
    expect(markdownLink("/about")).toBe("/about.md");
    expect(markdownLink("/docs/cli#publish")).toBe("/docs/cli.md#publish");
  });

  it("leaves links with no twin alone", () => {
    expect(markdownLink("/llms.txt")).toBe("/llms.txt");
    expect(markdownLink("https://app.agent-paste.sh")).toBe("https://app.agent-paste.sh");
  });
});
