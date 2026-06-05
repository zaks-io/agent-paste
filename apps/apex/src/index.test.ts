import { describe, expect, it } from "vitest";
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
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Hand off what your agent made");
    expect(body).toContain("Where agents publish");
    expect(body).toContain('<span class="wordmark-tld">.sh</span>');
    expect(body).toContain("npx @zaks-io/agent-paste publish ./report");
    expect(body).toContain("/fonts/BricolageGrotesque-Variable.woff2");
    expect(body).toContain("/fonts/IBMPlexMono-Regular.woff2");
    expect(body).toContain('data-clipboard="https://agent-paste.sh/art_01HZ8K2X9NPQR3VW7TYBE5MCDF"');
    expect(body).toContain('href="/agents.md"');
    expect(body).toContain('href="https://app.agent-paste.sh/api/auth/sign-in"');
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
    expect(body).toContain('href="/privacy#data-storage-and-protection"');
    expect(body).not.toContain("github.com");
    expect(body).not.toContain("View on GitHub");
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
    expect(body).toContain("<loc>https://agent-paste.sh/terms</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/privacy</loc>");
    expect(body).toContain("<loc>https://agent-paste.sh/llms.txt</loc>");
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
      "/terms",
      "/privacy",
      "/llms.txt",
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
