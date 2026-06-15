import { afterEach, describe, expect, it } from "vitest";
import { DOCS_PAGES, docsMarkdownPath } from "./docs/registry";
import { type Env, handleRequest } from "./server";

const APEX = "https://agent-paste.sh";

// The CF static-asset server is mocked: prerendered HTML/files are served by the
// ASSETS binding in production, so here we only exercise the worker shim around
// it (text assets, redirects, method gate, header stamping, 404).
const okHtmlAssets = {
  async fetch() {
    return new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};

const notFoundAssets = {
  async fetch() {
    return new Response("nope", { status: 404 });
  },
};

const htmlRewriterGlobal = globalThis as typeof globalThis & { HTMLRewriter?: unknown };
const originalHtmlRewriter = htmlRewriterGlobal.HTMLRewriter;
const ANALYTICS_SCRIPT_FIXTURE = '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script>';

function env(extra: Partial<Env> = {}): Env {
  return { ASSETS: okHtmlAssets, ...extra };
}

async function get(path: string, extra: Partial<Env> = {}): Promise<Response> {
  return handleRequest(new Request(`${APEX}${path}`), env(extra));
}

describe("text and data assets", () => {
  it("serves /llms.txt as text/plain", async () => {
    const response = await get("/llms.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# agent-paste");
    expect(body).toContain("npx @zaks-io/agent-paste publish");
    expect(body).toContain("agent-paste login");
    expect(body).toContain("npx @zaks-io/agent-paste whoami");
    expect(body).toContain("files[].url");
    expect(body).toContain("plain HTTP 200");
    expect(body).toMatch(/Ephemeral is not\s+the Free Plan/);
    expect(body).toContain("non-interactive text");
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
    expect(body).toContain("npx @zaks-io/agent-paste whoami");
    expect(body).toContain("files[].url");
    expect(body).toContain("HTTP 200");
    expect(body).not.toContain("AGENT_PASTE_API_KEY");
    expect(body).not.toContain("API key");
    expect(body).not.toContain("REST API");
    expect(body).toMatch(/Ephemeral is not\s+the Free Plan/);
    expect(body).toContain("non-interactive work");
    expect(body).toContain("https://agent-paste.sh/docs");
    expect(body).toContain("https://agent-paste.sh/llms-full.txt");
  });

  it("serves the docs index Markdown twin from the page registry", async () => {
    const response = await get("/docs.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# agent-paste docs");
    for (const page of DOCS_PAGES) {
      expect(body).toContain(`[${page.title}](${docsMarkdownPath(page)})`);
    }
  });

  it("serves a docs child Markdown twin", async () => {
    const response = await get("/docs/billing.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# Billing and Plans");
    expect(body).toContain("| Pro | 2000 | 25 MB | 100 MB | 30d default, 90d max | 1000 | Yes |");
  });

  it("serves the safety Markdown twin with the secrets warning", async () => {
    const response = await get("/docs/safety.md");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("What not to publish");
    expect(body).toContain("Do not upload secrets");
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

  it("serves /install.sh as a checksum-verifying POSIX script", async () => {
    const response = await get("/install.sh");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
    const body = await response.text();
    expect(body.startsWith("#!/bin/sh")).toBe(true);
    expect(body).toContain("zaks-io/agent-paste");
    expect(body).toContain("SHA256SUMS");
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

  it("serves /robots.txt with a sitemap pointer", async () => {
    const response = await get("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Sitemap: https://agent-paste.sh/sitemap.xml");
  });

  it("serves /.well-known/security.txt with public contact metadata", async () => {
    const response = await get("/.well-known/security.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("Contact: mailto:support@agent-paste.sh");
    expect(body).toContain("Preferred-Languages: en");
    expect(body).toContain("Canonical: https://agent-paste.sh/.well-known/security.txt");
    expect(body).toContain("Expires: 2027-06-12T00:00:00Z");
  });

  it("serves /.well-known/gpc.json with the GPC support declaration", async () => {
    const response = await get("/.well-known/gpc.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toEqual({ gpc: true, lastUpdate: "2026-06-14" });
  });

  it("serves /sitemap.xml with the public URL set", async () => {
    const response = await get("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await response.text();
    for (const loc of [
      "/",
      "/about",
      "/how-it-works",
      "/docs",
      "/docs.md",
      "/docs/billing",
      "/docs/billing.md",
      "/terms",
      "/privacy",
      "/llms.txt",
      "/llms-full.txt",
      "/install.sh",
      "/install.ps1",
    ]) {
      expect(body).toContain(`<loc>https://agent-paste.sh${loc}</loc>`);
    }
  });

  it("returns text assets with no body for HEAD", async () => {
    const markdown = await handleRequest(new Request(`${APEX}/docs/getting-started.md`, { method: "HEAD" }), env());
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await markdown.text()).toBe("");

    const shell = await handleRequest(new Request(`${APEX}/install.sh`, { method: "HEAD" }), env());
    expect(shell.status).toBe(200);
    expect(shell.headers.get("content-type")).toBe("text/x-shellscript; charset=utf-8");
    expect(await shell.text()).toBe("");
  });
});

describe("billing-gated text assets", () => {
  it("lists /pricing in the sitemap only when billing is enabled", async () => {
    expect(await (await get("/sitemap.xml")).text()).not.toContain("<loc>https://agent-paste.sh/pricing</loc>");
    expect(await (await get("/sitemap.xml", { BILLING_ENABLED: "true" })).text()).toContain(
      "<loc>https://agent-paste.sh/pricing</loc>",
    );
  });

  it("adds the Pricing section to llms.txt only when billing is enabled", async () => {
    expect(await (await get("/llms.txt")).text()).not.toContain("## Pricing");
    const enabled = await (await get("/llms.txt", { BILLING_ENABLED: "true" })).text();
    expect(enabled).toContain("## Pricing");
    expect(enabled).toContain("/pricing");
    expect(enabled).toContain("https://app.agent-paste.sh/billing");
  });
});

describe("product redirects", () => {
  it("redirects /dashboard to the app domain with no cookie", async () => {
    const response = await get("/dashboard");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/dashboard");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves query strings and redirects nested paths", async () => {
    expect((await get("/artifacts?cursor=abc")).headers.get("location")).toBe(
      "https://app.agent-paste.sh/artifacts?cursor=abc",
    );
    expect((await get("/artifacts/art_01HZ8K2X9NPQR3VW7TYBE5MCDF")).headers.get("location")).toBe(
      "https://app.agent-paste.sh/artifacts/art_01HZ8K2X9NPQR3VW7TYBE5MCDF",
    );
    expect((await get("/r/token-abc")).headers.get("location")).toBe("https://app.agent-paste.sh/r/token-abc");
  });

  it("maps /login and /logout vanity paths to the app auth routes", async () => {
    expect((await get("/login?return_to=%2Fdashboard")).headers.get("location")).toBe(
      "https://app.agent-paste.sh/api/auth/sign-in?return_to=%2Fdashboard",
    );
    expect((await get("/logout")).headers.get("location")).toBe("https://app.agent-paste.sh/api/auth/sign-out");
    expect((await get("/login/")).headers.get("location")).toBe("https://app.agent-paste.sh/api/auth/sign-in");
  });
});

describe("method gate and health", () => {
  it("answers OPTIONS preflight with 204 and an Allow header", async () => {
    const response = await handleRequest(new Request(`${APEX}/`, { method: "OPTIONS" }), env());
    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toContain("GET");
  });

  it("rejects non-GET/HEAD methods with 405", async () => {
    const response = await handleRequest(new Request(`${APEX}/`, { method: "POST" }), env());
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toContain("GET");
  });

  it("answers /healthz with 200 ok and no cookie", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("ASSETS delegation and 404", () => {
  it("delegates prerendered assets to the ASSETS binding and stamps security headers", async () => {
    let calls = 0;
    const response = await handleRequest(
      new Request(`${APEX}/fonts/CabinetGrotesk-Variable.woff2`),
      env({
        ASSETS: {
          async fetch() {
            calls += 1;
            return new Response("@font-face { }", { status: 200, headers: { "content-type": "font/woff2" } });
          },
        },
      }),
    );
    expect(calls).toBe(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("returns an HTML asset with no body for HEAD", async () => {
    const response = await handleRequest(new Request(`${APEX}/docs/getting-started`, { method: "HEAD" }), env());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("strips the analytics beacon from opted-out HTML asset responses", async () => {
    installTestHtmlRewriter();
    const response = await handleRequest(
      new Request(`${APEX}/`, { headers: { "sec-gpc": "1" } }),
      env({
        ASSETS: {
          async fetch() {
            return new Response(`<!doctype html>${ANALYTICS_SCRIPT_FIXTURE}<main>ok</main>`, {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          },
        },
      }),
    );

    const body = await response.text();
    expect(body).not.toContain("static.cloudflareinsights.com/beacon.min.js");
    expect(body).toContain("<main>ok</main>");
  });

  it("404s unknown paths and still stamps security headers", async () => {
    const response = await get("/no-such-page", { ASSETS: notFoundAssets });
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not_found");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("404s /pricing when billing is disabled (no prerendered page)", async () => {
    const response = await get("/pricing", { ASSETS: notFoundAssets });
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not_found");
  });

  it("falls through a .md path with no matching page to the asset 404", async () => {
    // Shape-matches the docs Markdown route but is not a real page, so the text
    // emitter yields nothing and the request drops to the ASSETS binding.
    const response = await get("/docs/not-a-real-page.md", { ASSETS: notFoundAssets });
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not_found");
  });
});

afterEach(() => {
  Object.defineProperty(htmlRewriterGlobal, "HTMLRewriter", { value: originalHtmlRewriter, configurable: true });
});

function installTestHtmlRewriter() {
  class TestHtmlRewriter {
    on() {
      return this;
    }

    transform(response: Response): Response {
      const stream = new ReadableStream({
        async start(controller) {
          const text = await response.text();
          expect(text).toContain(ANALYTICS_SCRIPT_FIXTURE);
          controller.enqueue(new TextEncoder().encode("<!doctype html><main>ok</main>"));
          controller.close();
        },
      });
      return new Response(stream, response);
    }
  }

  Object.defineProperty(htmlRewriterGlobal, "HTMLRewriter", { value: TestHtmlRewriter, configurable: true });
}

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
    "/.well-known/gpc.json",
    "/.well-known/security.txt",
    "/sitemap.xml",
    "/dashboard",
    "/healthz",
  ];
  for (const path of paths) {
    const response = await get(path);
    expect(response.headers.get("set-cookie"), `cookie on ${path}`).toBeNull();
  }
});
