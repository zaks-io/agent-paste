import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ApexAssets, Shell } from "./app/Shell";
import { DOCS_PAGES } from "./docs/registry";
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
});

describe("home page", () => {
  const body = renderPage("/");

  it("preloads the brand fonts", () => {
    expect(body).toContain("/fonts/CabinetGrotesk-Variable.woff2");
    expect(body).toContain("/fonts/Switzer-Variable.woff2");
    expect(body).toContain("/fonts/SplineSansMono-Variable.woff2");
  });

  it("renders the demo transcript as an Access Link with a static example fallback", () => {
    // The visible result is the shareable no-login Access Link contract. The href
    // still opens the id-shaped static page because this demo cannot depend on
    // production data.
    expect(body).toContain('https://</span><span class="text-accent">app.agent-paste.sh/al/');
    expect(body).toContain('href="/a/art_8KQ2WSDIEGO7XR"');
  });

  it("leads with OAuth login, not manual credential setup", () => {
    const main = body.match(/<main[^>]*>[\s\S]*?<\/main>/)?.[0] ?? body;
    expect(body).toContain('data-clipboard="npx @zaks-io/agent-paste login"');
    expect(main).not.toContain("Get an API key");
    expect(main).not.toContain("REST API");
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
    expect(body).toContain('href="/privacy#your-choices"');
    expect(body).toContain('href="/privacy#data-storage-and-protection"');
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

  it("renders the result gesture as a box-drawing wire, never an em dash", () => {
    expect(body).toContain(
      '<span class="t-gesture" aria-hidden="true">&gt;─<span class="t-gesture-node">●</span></span>',
    );
    expect(body).not.toContain("—");
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
    for (const page of DOCS_PAGES) {
      expect(body).toContain(page.title);
    }
  });

  // Every shipped doc page must prerender, carry its title, and link its Markdown
  // twin. Rendering all slugs also exercises every DocsBlock kind
  // (paragraph/list/ordered/code/table/note/links) without a synthetic fixture,
  // since the corpus uses all of them. (Page titles are registry-driven structure,
  // not free-form marketing copy, so asserting them is a twin/contract check.)
  it.each(
    DOCS_PAGES.map((page) => [page.slug, page.title] as const),
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
