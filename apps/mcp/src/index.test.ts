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
      resource: "https://mcp.agent-paste.sh",
      authorization_servers: [],
      bearer_methods_supported: ["header"],
      scopes_supported: ["write", "read", "share"],
    });
  });

  it("serves configured OAuth protected-resource metadata", async () => {
    const response = await request("/.well-known/oauth-protected-resource", {
      MCP_RESOURCE: "https://mcp.preview.agent-paste.sh",
      MCP_AUTHORIZATION_SERVER: "https://auth.example.test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: "https://mcp.preview.agent-paste.sh",
      authorization_servers: ["https://auth.example.test"],
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
