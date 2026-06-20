import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ApexAssets, Shell } from "./app/Shell";
import { EXAMPLE_ACCESS_LINK_URL, EXAMPLE_ARTIFACT_TITLE, PUBLISH_EPHEMERAL_CMD } from "./copy";
import { docsPagesForBilling } from "./docs/registry";
import { getRoutes } from "./routes";

// Pages are prerendered to static HTML at build time. These tests render a route
// in-process the same way scripts/prerender.mjs does (getRoutes + Shell), so they
// assert the exact bytes shipped to the browser without standing up a build.
//
// These tests assert STRUCTURE and CONTRACTS, never marketing copy. The wording of
// a headline or section title is the most-edited, least-invariant thing on the site;
// pinning it just makes copy edits break the build without catching a real bug. We
// test the rule (CSP shape, external assets, route gating, HTML/MD twins, the github
// link, house style bans), not the sentence.
const ASSETS: ApexAssets = { cssHref: "/assets/styles.css", jsHref: "/assets/client.js" };
const SOCIAL_IMAGE_SVG = readFileSync(new URL("../public/agent-paste-social.svg", import.meta.url), "utf8");
const SOCIAL_IMAGE_PNG = readFileSync(new URL("../public/agent-paste-social.png", import.meta.url));

// Read width/height from a PNG's IHDR chunk (big-endian uint32 at byte 16/20).
function pngDimensions(png: Buffer): { width: number; height: number } {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`not a PNG: ${signature}`);
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function renderPage(path: string, opts: { billingEnabled?: boolean; analyticsToken?: string } = {}): string {
  const billingEnabled = opts.billingEnabled ?? false;
  const route = getRoutes(billingEnabled).find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`No apex route for ${path}`);
  }
  const html = renderToStaticMarkup(
    <Shell
      meta={route.meta}
      assets={ASSETS}
      analyticsToken={opts.analyticsToken}
      billingEnabled={billingEnabled}
      bleed={route.bleed}
    >
      {route.element}
    </Shell>,
  );
  return `<!doctype html>\n${html}`;
}

function hasRoute(path: string, billingEnabled: boolean): boolean {
  return getRoutes(billingEnabled).some((route) => route.path === path);
}

describe("apex shell", () => {
  const html = renderPage("/");

  it("emits a static document with external hashed CSS and JS", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<link rel="stylesheet" href="/assets/styles.css"/>');
    expect(html).toContain('<script type="module" src="/assets/client.js">');
  });

  it("ships exactly one inline script: the pre-paint theme-init", () => {
    // The pre-paint script reads the cross-surface theme cookie and pins
    // data-theme before first paint (no flash). Assert the behavior, not the
    // exact body.
    expect(html).toContain("agp_theme");
    expect(html).toContain('setAttribute("data-theme"');
    // A bare <script> (no attributes) is the inline theme-init; everything else
    // (client enhancement, beacon) is external/attributed. Pin the count so no
    // second inline script slips in under the static CSP.
    // Case-insensitive so the count can't be fooled by a <SCRIPT> variant
    // (CodeQL flags a lowercase-only HTML tag regex even in a test count).
    expect((html.match(/<script>/gi) ?? []).length).toBe(1);
  });

  it("renders the Cloudflare Analytics beacon when a token is configured", () => {
    const withToken = renderPage("/", { analyticsToken: "tok_apex_123" });
    expect(withToken).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(withToken).toContain('data-cf-beacon="{&quot;token&quot;:&quot;tok_apex_123&quot;}"');
  });

  it("omits the beacon when no analytics token is configured", () => {
    expect(html).not.toContain("cloudflareinsights.com");
  });

  it("renders the optional analytics preference control", () => {
    expect(html).toContain('id="analytics-toggle"');
    expect(html).toContain("Analytics on");
  });

  it("renders a skip link to the main content landmark", () => {
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('<main id="main-content" tabindex="-1"');
  });

  it("renders the operating company attribution in the footer", () => {
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(footer).toContain("Source code is Apache-2.0");
    expect(footer).toContain("Hosted service operated by");
    expect(footer).toContain("Zaks.io, LLC");
    expect(footer).toContain('href="https://zaks.io"');
    expect(footer).not.toContain("Apache-2.0 (c) zaks-io");
  });

  it("publishes Zaks.io, LLC as the structured-data publisher", () => {
    expect(html).toContain('"@id":"https://zaks.io/#organization"');
    expect(html).toContain('"name":"Zaks.io, LLC"');
    expect(html).toContain('"url":"https://zaks.io"');
    expect(html).toContain('"publisher":{"@id":"https://zaks.io/#organization"}');
  });

  it("uses the brand PNG as the social preview image", () => {
    // PNG, not SVG: social scrapers do not render SVG og:image. The PNG is the
    // SVG master rasterized at the same 1200x630 dimensions.
    expect(html).toContain('<meta property="og:site_name" content="agent-paste.sh"/>');
    expect(html).toContain('<meta property="og:image" content="https://agent-paste.sh/agent-paste-social.png"/>');
    expect(html).toContain('<meta property="og:image:type" content="image/png"/>');
    expect(html).toContain('<meta property="og:image:width" content="1200"/>');
    expect(html).toContain('<meta property="og:image:height" content="630"/>');
    expect(html).toContain('<meta name="twitter:image" content="https://agent-paste.sh/agent-paste-social.png"/>');
  });

  it("keeps social descriptions and card dimensions crawler-friendly", () => {
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
    expect(description).toBeDefined();
    expect(description?.length).toBeLessThanOrEqual(125);
    expect(html).toContain(`<meta property="og:description" content="${description}"/>`);
    // The served og:image is the PNG; it must be a real PNG at the declared
    // 1200x630. The SVG master stays the source of that raster, so verify both.
    expect(pngDimensions(SOCIAL_IMAGE_PNG)).toEqual({ width: 1200, height: 630 });
    expect(SOCIAL_IMAGE_SVG).toContain('<svg width="1200" height="630" viewBox="0 0 1200 630"');
    expect(SOCIAL_IMAGE_SVG).toContain('<rect width="1200" height="630" fill="#fff"/>');
  });
});

describe("home page", () => {
  const body = renderPage("/");

  it("preloads the brand fonts", () => {
    expect(body).toContain("/fonts/CabinetGrotesk-Variable.woff2");
    expect(body).toContain("/fonts/Switzer-Variable.woff2");
    expect(body).toContain("/fonts/SplineSansMono-Variable.woff2");
  });

  it("ends the demo with an inline access-link preview, not a link out to a separate page", () => {
    // The payoff is rendered inline (a mini access-link viewer), so there is no
    // separate static example page to drift from the real viewer. Contract: the
    // preview beat renders with the published title, and no /a/<id> link-out exists.
    expect(body).toContain('data-kind="preview"');
    expect(body).toContain(EXAMPLE_ARTIFACT_TITLE);
    expect(body).not.toContain('href="/a/');
  });

  it("prints the shareable no-login Access Link in the demo output", () => {
    // The transcript's CLI-style output still surfaces the real share-link contract
    // (the /al/ URL a real ephemeral publish returns), just no longer as a link.
    expect(body).toContain("app.agent-paste.sh/al/");
    expect(body).toContain(EXAMPLE_ACCESS_LINK_URL.split("#")[0]);
  });

  it("leads with OAuth login, not manual credential setup", () => {
    const main = body.match(/<main[^>]*>[\s\S]*?<\/main>/)?.[0] ?? body;
    expect(body).toContain('data-clipboard="npx @zaks-io/agent-paste login"');
    expect(main).not.toContain("Get an API key");
    expect(main).not.toContain("REST API");
  });

  it("makes the attributed agent prompt and the accountless publish the primary path", () => {
    // The hero's primary action is a claim-attributed copy-to-clipboard prompt,
    // and the shell path leads with the no-account --ephemeral publish. Assert
    // the wiring, not the prompt wording.
    expect(body).toContain("data-claim-prompt-variant=");
    expect(body).toContain(`data-clipboard="${PUBLISH_EPHEMERAL_CMD}"`);
    // The dashboard sign-in stays reachable, demoted to a secondary link.
    expect(body).toContain('href="https://app.agent-paste.sh/api/auth/sign-in"');
  });

  it("links the one-line installer to its served scripts", () => {
    expect(body).toContain('href="/install.sh"');
    expect(body).toContain('href="/install.ps1"');
  });

  it("links docs, legal, the app, and the public repo", () => {
    expect(body).toContain('href="/docs"');
    expect(body).toContain('href="https://app.agent-paste.sh/api/auth/sign-in"');
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
    expect(body).toContain('href="/privacy#data-storage-and-protection"');
    expect(body).not.toContain('href="/privacy#your-choices"');
    expect(body).toContain('href="/llms-full.txt"');
    expect(body).toContain('href="https://github.com/zaks-io/agent-paste"');
  });

  it("exposes machine-readable docs hints for agents on the landing page", () => {
    expect(body).toContain('data-agent-guide="/agents.md"');
    expect(body).toContain('data-agent-docs="/docs.md"');
    expect(body).toContain('data-agent-summary="/llms.txt"');
    expect(body).toContain('data-agent-corpus="/llms-full.txt"');
    expect(body).toContain('data-agent-docs="/docs/mcp.md"');
  });

  // Marketing shares the dashboard's discipline (docs/specs/style-guide.md §11):
  // square corners, no accent glow, no gradients, no grain, banned display fonts.
  // These are house-style INVARIANTS, not copy.
  it("holds the style-guide §11 bans", () => {
    const lower = body.toLowerCase();
    expect(lower).not.toContain("geist");
    expect(lower).not.toContain("space grotesk");
    expect(lower).not.toMatch(/["\s,]inter["\s,]/);
    expect(lower).not.toContain("9999px");
    expect(lower).not.toContain("999px");
    expect(lower).not.toMatch(/box-shadow:[^;]*var\(--accent\)/);
    expect(lower).not.toContain("gradient");
    expect(lower).not.toContain("feturbulence");
  });

  // Assert the hrefs are wired (the contract), not the class strings (presentation
  // that floats with the Tailwind styling). See feedback_never_unit_test_copy.
  it("links about, how-it-works, and docs from nav and footer", () => {
    expect(body).toContain('href="/about"');
    expect(body).toContain('href="/how-it-works"');
    expect(body).toContain('href="/docs"');
  });
});

describe("about page", () => {
  const body = renderPage("/about");

  it("has a canonical URL and links the public repo", () => {
    expect(body).toContain('<link rel="canonical" href="https://agent-paste.sh/about"/>');
    expect(body).toContain('href="https://github.com/zaks-io/agent-paste"');
    expect(body).toContain('href="https://zaks.io"');
    expect(body).toContain("Zaks.io, LLC");
  });

  it("keeps buzzword claims and em dashes out", () => {
    const lower = body.toLowerCase();
    expect(lower).not.toContain("ai-powered");
    expect(lower).not.toContain("revolutionary");
    expect(lower).not.toContain("game-changing");
    expect(lower).not.toContain("seamless");
    expect(body).not.toContain("—");
  });
});

describe("how-it-works page", () => {
  const body = renderPage("/how-it-works");

  it("has a canonical URL and links the public repo", () => {
    expect(body).toContain('<link rel="canonical" href="https://agent-paste.sh/how-it-works"/>');
    expect(body).toContain('href="https://github.com/zaks-io/agent-paste"');
  });

  it("keeps platform/infra jargon and em dashes out of the page body", () => {
    // Scope to <main>: the footer legitimately links "MCP server".
    const main = body.match(/<main[^>]*>[\s\S]*?<\/main>/)?.[0] ?? "";
    expect(main).not.toContain("Operator");
    expect(main).not.toContain("operator");
    expect(main).not.toContain("Platform Lockdown");
    expect(main).not.toContain("MCP server");
    expect(main).not.toContain("REST API");
    expect(main).not.toContain("proof-of-work");
    expect(main).not.toContain("Safety Scanner");
    expect(main).not.toContain("—");
  });
});

describe("pricing page (billing-gated)", () => {
  it("is not registered and not linked when billing is disabled", () => {
    expect(hasRoute("/pricing", false)).toBe(false);
    expect(renderPage("/")).not.toContain('href="/pricing"');
  });

  it("is registered, linked, and wired to the billing CTA when billing is enabled", () => {
    expect(hasRoute("/pricing", true)).toBe(true);
    const body = renderPage("/pricing", { billingEnabled: true });
    expect(body).toContain('href="https://app.agent-paste.sh/billing"');
    expect(body).toContain('href="https://zaks.io"');
    expect(body).toContain("Zaks.io, LLC");
    expect(body).toContain('<link rel="canonical" href="https://agent-paste.sh/pricing"/>');
    // Pricing is wired into nav + footer when billing is on (href is the
    // contract; the link classes float with the Tailwind styling).
    expect((body.match(/href="\/pricing"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("docs pages", () => {
  it("renders the docs index linked to its Markdown and llms twins", () => {
    const body = renderPage("/docs");
    expect(body).toContain('href="/docs.md"');
    expect(body).toContain('href="/llms-full.txt"');
    for (const page of docsPagesForBilling(false)) {
      expect(body).toContain(page.title);
    }
    expect(body).not.toContain("Billing and Plans");
  });

  it("registers billing docs only when billing is enabled", () => {
    expect(hasRoute("/docs/billing", false)).toBe(false);
    expect(hasRoute("/docs/billing", true)).toBe(true);
    expect(renderPage("/docs", { billingEnabled: true })).toContain("Billing and Plans");
  });

  // Every shipped doc page must prerender, carry its title, and link its Markdown
  // twin. Rendering all slugs also exercises every DocsBlock kind
  // (paragraph/list/ordered/code/table/note/links) without a synthetic fixture,
  // since the corpus uses all of them. (Page titles are registry-driven structure,
  // not free-form marketing copy, so asserting them is a twin/contract check.)
  it.each(
    docsPagesForBilling(false).map((page) => [page.slug, page.title] as const),
  )("prerenders /docs/%s with its title and Markdown twin", (slug, title) => {
    const body = renderPage(`/docs/${slug}`);
    expect(body).toContain(title);
    expect(body).toContain(`href="/docs/${slug}.md"`);
    expect(body).toContain("<main");
  });
});

describe("legal pages", () => {
  it.each([["/terms"], ["/privacy"]])("renders %s with the operating entity and agents twin", (path) => {
    const body = renderPage(path);
    // Operating entity + registered address are a legal CONTRACT, not marketing
    // copy: they must appear verbatim on the legal pages.
    expect(body).toContain("Zaks.io, LLC");
    expect(body).toContain("2108 N St, Ste N, Sacramento, CA 95816, USA");
    expect(body).toContain('href="/agents.md"');
    expect(body).toContain('href="https://app.agent-paste.sh/api/auth/sign-in"');
    expect(body).toContain(`<link rel="canonical" href="https://agent-paste.sh${path}"/>`);
  });
});
