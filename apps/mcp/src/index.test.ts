import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index.js";

function request(path: string, env: Env = {}) {
  return worker.fetch(new Request(`https://mcp.test${path}`), env);
}

describe("mcp worker", () => {
  it("reports health", async () => {
    const response = await request("/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, app: "mcp" });
  });

  it("serves default OAuth protected-resource metadata", async () => {
    const response = await request("/.well-known/oauth-protected-resource");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: "https://mcp.agent-paste.sh/",
      resource_name: "Agent Paste MCP",
      authorization_servers: [],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
    });
  });

  it("serves configured OAuth protected-resource metadata", async () => {
    const response = await request("/.well-known/oauth-protected-resource", {
      MCP_RESOURCE: "https://mcp.preview.agent-paste.sh/",
      MCP_AUTHORIZATION_SERVER: "https://auth.example.test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: "https://mcp.preview.agent-paste.sh/",
      authorization_servers: ["https://auth.example.test"],
    });
  });

  it("serves configured OAuth authorization-server metadata", async () => {
    const response = await request("/.well-known/oauth-authorization-server", {
      MCP_RESOURCE: "https://mcp.preview.agent-paste.sh/",
      MCP_AUTHORIZATION_SERVER: "https://auth.example.test",
      WORKOS_MCP_ISSUER: "https://auth.example.test",
      WORKOS_MCP_JWKS_URL: "https://auth.example.test/oauth2/jwks",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://auth.example.test",
      authorization_endpoint: "https://auth.example.test/oauth2/authorize",
      token_endpoint: "https://auth.example.test/oauth2/token",
      registration_endpoint: "https://auth.example.test/oauth2/register",
      jwks_uri: "https://auth.example.test/oauth2/jwks",
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
      client_id_metadata_document_supported: true,
      resource: "https://mcp.preview.agent-paste.sh/",
      resource_metadata: "https://mcp.preview.agent-paste.sh/.well-known/oauth-protected-resource",
      protected_resources: ["https://mcp.preview.agent-paste.sh/", "https://mcp.preview.agent-paste.sh"],
    });
  });

  it("serves path-suffixed OAuth metadata fallbacks", async () => {
    const response = await request("/.well-known/openid-configuration/mcp", {
      MCP_RESOURCE: "https://mcp.preview.agent-paste.sh/",
      MCP_AUTHORIZATION_SERVER: "https://auth.example.test/",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://auth.example.test",
      authorization_endpoint: "https://auth.example.test/oauth2/authorize",
    });
  });

  it("serves the MCP OpenAPI document", async () => {
    const response = await request("/openapi.json");
    const doc = (await response.json()) as { openapi: string; info: { title: string }; paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Agent Paste MCP API");
    expect(doc.paths).toHaveProperty("/");
    expect(doc.paths).toHaveProperty("/healthz");
    expect(doc.paths).toHaveProperty("/.well-known/oauth-protected-resource");
  });

  it("returns 405 for GET on the MCP endpoint", async () => {
    const response = await request("/");
    expect(response.status).toBe(405);
  });

  it("returns a canonical not_found envelope for unknown paths", async () => {
    const response = await request("/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "not_found", message: "not_found" } });
  });
});

describe("mcp security headers", () => {
  function expectBaseline(response: Response): void {
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }

  it("applies the baseline to /healthz", async () => {
    expectBaseline(await request("/healthz"));
  });

  it("applies the baseline to a 404 response", async () => {
    expectBaseline(await request("/missing"));
  });
});
