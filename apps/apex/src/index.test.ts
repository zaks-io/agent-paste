import { describe, expect, it } from "vitest";
import { DOCS_PAGES, docsMarkdownPath } from "./docs/registry.js";
import { type Env, handleRequest } from "./index.js";

const APEX = "https://agent-paste.sh";

function emptyEnv(): Env {
  return {};
}

async function get(path: string, env: Env = emptyEnv()): Promise<Response> {
  return handleRequest(new Request(`${APEX}${path}`), env);
}

describe("apex worker", () => {
  it("renders the marketing home page", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Strict, nonce-based CSP: no 'unsafe-inline' on scripts or styles.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toMatch(/style-src 'nonce-[^']+'/);
    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Hand off what your agent made");
    expect(body).toContain("Where agents publish");
    expect(body).toContain('<span class="wordmark-tld">.sh</span>');
    expect(body).toContain("npx @zaks-io/agent-paste publish ./report");
    expect(body).toContain("/fonts/BricolageGrotesque-Variable.woff2");
    expect(body).toContain("/fonts/IBMPlexMono-Regular.woff2");
    expect(body).toContain('data-clipboard="https://agent-paste.sh/art_01HZ8K2X9NPQR3VW7TYBE5MCDF"');
    expect(body).toContain('href="/docs"');
    expect(body).toContain(">Docs<");
    expect(body).toContain('href="https://app.agent-paste.sh/api/auth/sign-in"');
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
    expect(body).toContain('href="/privacy#data-storage-and-protection"');
    expect(body).not.toContain("github.com");
    expect(body).not.toContain("View on GitHub");
  });

  it("stamps the CSP nonce on the inline script and style so strict-dynamic trusts them", async () => {
    const response = await get("/");
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce, "CSP must carry a script nonce").toBeTruthy();
    // Same nonce appears on the style nonce token.
    expect(csp).toContain(`style-src 'nonce-${nonce}'`);
    const body = await response.text();
    // The inline clipboard helper and the inline <style> both carry the nonce.
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body).toContain(`<style nonce="${nonce}">`);
  });

  it("mints a fresh nonce per request", async () => {
    const first = (await get("/")).headers.get("content-security-policy") ?? "";
    const second = (await get("/")).headers.get("content-security-policy") ?? "";
    const nonceOf = (csp: string) => csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it("renders the Cloudflare Analytics beacon, nonce'd, when a token is configured", async () => {
    const response = await get("/", { CF_WEB_ANALYTICS_TOKEN: "tok_apex_123" });
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    // Beacon reporting host must be allowed for the POST.
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com");
    const body = await response.text();
    expect(body).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(body).toContain(`data-cf-beacon="{&quot;token&quot;:&quot;tok_apex_123&quot;}"`);
    // The beacon <script> carries the same nonce as the policy. Use plain
    // substring matching, not a RegExp: a base64 nonce can contain '+' or '/',
    // which are regex metacharacters and would make the assertion flaky.
    expect(body).toContain(
      `<script nonce="${nonce}" defer="" src="https://static.cloudflareinsights.com/beacon.min.js"`,
    );
  });

  it("omits the beacon when no analytics token is configured", async () => {
    const body = await (await get("/")).text();
    expect(body).not.toContain("cloudflareinsights.com");
  });

  it("leads with the cross-vendor handoff story and live updates", async () => {
    const response = await get("/");
    const body = await response.text();
    // The wedge: the neutral handoff layer between agents and tools, plus
    // live-updating artifacts. These are the two lead features.
    expect(body).toContain("Cross-vendor by design");
    expect(body).toContain("Leave the tab open, watch it iterate");
    expect(body).toContain("no polling");
    expect(body).toContain("hand off");
  });

  it("surfaces the standalone one-line installer", async () => {
    const response = await get("/");
    const body = await response.text();
    expect(body).toContain("Install in one line");
    expect(body).toContain("curl -fsSL https://agent-paste.sh/install.sh | sh");
    expect(body).toContain("irm https://agent-paste.sh/install.ps1 | iex");
    expect(body).toContain('href="/docs"');
    expect(body).toContain('href="/install.sh"');
    expect(body).toContain('href="/install.ps1"');
  });

  it("leads with the OAuth login flow, not manual API keys", async () => {
    const response = await get("/");
    const body = await response.text();
    // The CLI signs in over OAuth and provisions its own key; the marketing
    // surface must not tell people to fetch one by hand.
    expect(body).toContain("npx @zaks-io/agent-paste login");
    expect(body).toContain('data-clipboard="npx @zaks-io/agent-paste login"');
    expect(body).not.toContain("Get an API key");
    expect(body).toContain("Open the dashboard");
    expect(body).toContain("One ID, every surface");
  });

  it("does not include style-guide §11 banned tokens", async () => {
    const response = await get("/");
    const body = (await response.text()).toLowerCase();
    expect(body).not.toContain("gradient");
    expect(body).not.toContain("backdrop-filter");
    expect(body).not.toContain("geist");
    expect(body).not.toContain("space grotesk");
    expect(body).not.toMatch(/["\s,]inter["\s,]/);
    expect(body).not.toContain("border-radius: 9999");
  });

  it("renders the about page with the wedge and an honest scope section", async () => {
    const response = await get("/about");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Where agents publish");
    expect(body).toContain('<link rel="canonical" href="https://agent-paste.sh/about"/>');
    // The honest-about-scope sections the user asked for.
    expect(body).toContain("Why it exists");
    expect(body).toContain("How it is built and run");
    expect(body).toContain("What to expect");
    expect(body).toContain("AI was used heavily");
    expect(body).toContain("pre-launch");
    // No repo / open-source claims while the gate is closed.
    expect(body).not.toContain("github.com");
    expect(body).not.toContain("open source");
  });

  it("does not include style-guide banned tokens on the about page", async () => {
    const response = await get("/about");
    const body = (await response.text()).toLowerCase();
    expect(body).not.toContain("ai-powered");
    expect(body).not.toContain("revolutionary");
    expect(body).not.toContain("game-changing");
    expect(body).not.toContain("seamless");
    expect(body).not.toContain("gradient");
    expect(body).not.toContain("—"); // em dash
  });

  it("links to the about page from nav and footer", async () => {
    const home = await get("/");
    const homeBody = await home.text();
    expect(homeBody).toContain('<a class="head-link" href="/about">About</a>');
    expect(homeBody).toContain('<a class="foot-link" href="/about">About</a>');
  });

  it("links to docs from the home page and footer", async () => {
    const home = await get("/");
    const homeBody = await home.text();
    expect(homeBody).toContain('<a class="head-link" href="/docs">Docs</a>');
    expect(homeBody).toContain('<a class="foot-link" href="/docs">Docs</a>');
    expect(homeBody).toContain('href="/llms-full.txt"');
  });

  it("lists /about in the sitemap", async () => {
    const response = await get("/sitemap.xml");
    const body = await response.text();
    expect(body).toContain("<loc>https://agent-paste.sh/about</loc>");
  });

  it("serves /llms.txt as text/plain", async () => {
    const response = await get("/llms.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toContain("# agent-paste");
    expect(body).toContain("npx @zaks-io/agent-paste publish");
    expect(body).toContain("agent-paste login");
    expect(body).toContain("/llms-full.txt");
  });

  it("serves /agents.md as text/markdown", async () => {
    const response = await get("/agents.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# agent-paste for agents");
    expect(body).toContain("Mental model");
    expect(body).toContain("npx @zaks-io/agent-paste login");
    expect(body).toContain("AGENT_PASTE_API_KEY");
    expect(body).toContain("https://agent-paste.sh/docs");
    expect(body).toContain("https://agent-paste.sh/llms-full.txt");
  });

  it("serves docs index as human HTML and Markdown from the same page registry", async () => {
    const html = await get("/docs");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.headers.get("set-cookie")).toBeNull();
    const htmlBody = await html.text();
    expect(htmlBody).toContain("Use agent-paste");
    expect(htmlBody).toContain('href="/docs.md"');
    expect(htmlBody).toContain('href="/llms-full.txt"');

    const markdown = await get("/docs.md");
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const markdownBody = await markdown.text();
    expect(markdownBody).toContain("# agent-paste docs");

    for (const page of DOCS_PAGES) {
      expect(htmlBody).toContain(page.title);
      expect(markdownBody).toContain(`[${page.title}](${docsMarkdownPath(page)})`);
    }
  });

  it("serves docs child pages and Markdown twins", async () => {
    const html = await get("/docs/billing");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const htmlBody = await html.text();
    expect(htmlBody).toContain("Billing and Plans");
    expect(htmlBody).toContain("Stripe Checkout");
    expect(htmlBody).toContain("2000");
    expect(htmlBody).toContain('href="/docs/billing.md"');

    const markdown = await get("/docs/billing.md");
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const markdownBody = await markdown.text();
    expect(markdownBody).toContain("# Billing and Plans");
    expect(markdownBody).toContain("| Pro | 2000 | 25 MB | 100 MB | 30d default, 90d max | 1000 | Yes |");
  });

  it("returns the generic 404 for unknown docs pages", async () => {
    const response = await get("/docs/not-a-page");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await expect(response.text()).resolves.toBe("not_found");
  });

  it("returns docs pages with no body for HEAD", async () => {
    const response = await handleRequest(new Request(`${APEX}/docs/getting-started`, { method: "HEAD" }), emptyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("");

    const markdown = await handleRequest(
      new Request(`${APEX}/docs/getting-started.md`, { method: "HEAD" }),
      emptyEnv(),
    );
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await markdown.text()).toBe("");
  });

  it("serves /llms-full.txt with the complete docs corpus", async () => {
    const response = await get("/llms-full.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# agent-paste full docs");
    expect(body).toContain("# Getting Started");
    expect(body).toContain("# Billing and Plans");
    expect(body).toContain("# MCP Server");
    expect(body).toContain("Per-page Markdown twins live under /docs/{slug}.md");
  });

  it.each([
    ["/terms", "Terms of Use", "Eligibility and availability", "The hosted service is provided by Zaks.io, LLC"],
    [
      "/privacy",
      "Privacy Policy",
      "How we store and protect data",
      "without publishing internal key names, exact topology, operational runbooks",
    ],
  ])("serves %s as an HTML legal page", async (path, title, section, expectedCopy) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toContain(title);
    expect(body).toContain("Effective June 4, 2026");
    expect(body).toContain(section);
    expect(body).toContain(expectedCopy);
    expect(body).toContain('href="/agents.md"');
    expect(body).toContain('href="https://app.agent-paste.sh/api/auth/sign-in"');
  });

  it("returns /privacy with no body for HEAD", async () => {
    const response = await handleRequest(new Request(`${APEX}/privacy`, { method: "HEAD" }), emptyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("serves /install.sh as a POSIX shell script", async () => {
    const response = await get("/install.sh");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body.startsWith("#!/bin/sh")).toBe(true);
    expect(body).toContain("zaks-io/agent-paste");
    expect(body).toContain("SHA256SUMS");
    // Must hard-fail rather than install unverified, and curl must use --fail
    // so a 404 never lands as the binary.
    expect(body).toContain("checksum mismatch");
    expect(body).toContain("--fail");
  });

  it("serves /install.ps1 as a PowerShell script", async () => {
    const response = await get("/install.ps1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("Get-FileHash");
    expect(body).toContain("agent-paste-windows-x64.exe");
    expect(body).toContain("SHA256SUMS");
  });

  it("returns /install.sh with no body for HEAD", async () => {
    const response = await handleRequest(new Request(`${APEX}/install.sh`, { method: "HEAD" }), emptyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("serves /robots.txt with sitemap pointer", async () => {
    const response = await get("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Sitemap: https://agent-paste.sh/sitemap.xml");
  });

  it("serves /sitemap.xml", async () => {
    const response = await get("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("<loc>https://agent-paste.sh/</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/docs</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/docs.md</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/docs/billing</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/docs/billing.md</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/terms</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/privacy</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/llms.txt</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/llms-full.txt</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/install.sh</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/install.ps1</loc>");
  });

  it("redirects /dashboard to the app domain", async () => {
    const response = await get("/dashboard");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/dashboard");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves query strings on product redirects", async () => {
    const response = await get("/artifacts?cursor=abc");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/artifacts?cursor=abc");
  });

  it("maps the /login and /logout vanity paths to the app auth routes", async () => {
    const login = await get("/login?return_to=%2Fdashboard");
    expect(login.status).toBe(308);
    expect(login.headers.get("location")).toBe("https://app.agent-paste.sh/api/auth/sign-in?return_to=%2Fdashboard");

    const logout = await get("/logout");
    expect(logout.status).toBe(308);
    expect(logout.headers.get("location")).toBe("https://app.agent-paste.sh/api/auth/sign-out");

    const trailingSlash = await get("/login/");
    expect(trailingSlash.status).toBe(308);
    expect(trailingSlash.headers.get("location")).toBe("https://app.agent-paste.sh/api/auth/sign-in");
  });

  it("redirects nested product paths", async () => {
    const response = await get("/artifacts/art_01HZ8K2X9NPQR3VW7TYBE5MCDF");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://app.agent-paste.sh/artifacts/art_01HZ8K2X9NPQR3VW7TYBE5MCDF",
    );
  });

  it("redirects revocable artifact links to the app", async () => {
    const response = await get("/r/token-abc");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/r/token-abc");
  });

  it("GET /healthz returns 200 ok with no cookies", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 404 for unknown paths when no asset binding is present", async () => {
    const response = await get("/no-such-page");
    expect(response.status).toBe(404);
  });

  it("falls through to the assets binding when configured", async () => {
    let assetCalls = 0;
    const env: Env = {
      ASSETS: {
        async fetch() {
          assetCalls += 1;
          return new Response("@font-face { }", {
            status: 200,
            headers: { "content-type": "font/woff2" },
          });
        },
      },
    };

    const response = await handleRequest(new Request(`${APEX}/fonts/BricolageGrotesque-Variable.woff2`), env);
    expect(assetCalls).toBe(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
  });

  it("returns 405 for POST on apex routes", async () => {
    const response = await handleRequest(new Request(`${APEX}/`, { method: "POST" }), emptyEnv());
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toContain("GET");
  });

  it("never sets cookies on any apex response", async () => {
    const paths = [
      "/",
      "/about",
      "/docs",
      "/docs.md",
      "/docs/billing",
      "/docs/billing.md",
      "/terms",
      "/privacy",
      "/llms.txt",
      "/llms-full.txt",
      "/agents.md",
      "/install.sh",
      "/install.ps1",
      "/robots.txt",
      "/sitemap.xml",
      "/dashboard",
      "/healthz",
    ];
    for (const path of paths) {
      const response = await get(path);
      expect(response.headers.get("set-cookie"), `cookie on ${path}`).toBeNull();
    }
  });
});
