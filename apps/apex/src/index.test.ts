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
    expect(body).toContain("Where agents publish");
    expect(body).toContain('<span class="wordmark-tld">.sh</span>');
    expect(body).toContain("npx agent-paste publish ./report");
    expect(body).toContain("/fonts/HankenGrotesk-Variable.woff2");
    expect(body).toContain("/fonts/JetBrainsMono-Regular.woff2");
    expect(body).toContain('data-clipboard="https://agent-paste.sh/art_01HZ8K2X9NPQR3VW7TYBE5MCDF"');
    expect(body).toContain('href="/agents.md"');
    expect(body).not.toContain("github.com");
    expect(body).not.toContain("View on GitHub");
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

  it("serves /llms.txt as text/plain", async () => {
    const response = await get("/llms.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toContain("# agent-paste");
    expect(body).toContain("npx agent-paste publish");
  });

  it("serves /agents.md as text/markdown", async () => {
    const response = await get("/agents.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# agent-paste for agents");
    expect(body).toContain("Mental model");
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
    expect(body).toContain("<loc>https://agent-paste.sh/llms.txt</loc>");
  });

  it("redirects /dashboard to the app domain", async () => {
    const response = await get("/dashboard");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/dashboard");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves query strings on product redirects", async () => {
    const response = await get("/login?return_to=%2Fartifacts%2Fart_1");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/login?return_to=%2Fartifacts%2Fart_1");
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

    const response = await handleRequest(new Request(`${APEX}/fonts/HankenGrotesk-Variable.woff2`), env);
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
    const paths = ["/", "/llms.txt", "/agents.md", "/robots.txt", "/sitemap.xml", "/dashboard"];
    for (const path of paths) {
      const response = await get(path);
      expect(response.headers.get("set-cookie"), `cookie on ${path}`).toBeNull();
    }
  });
});
