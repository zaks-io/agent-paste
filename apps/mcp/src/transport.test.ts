import { mcpWwwAuthenticateHeader } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { createTestMcpBearerAuth } from "./auth.js";
import { MCP_PROTOCOL_VERSION } from "./jsonrpc.js";
import { handleMcpEndpoint } from "./transport.js";

const testAuth = createTestMcpBearerAuth({
  "mcp-valid-token": {
    tokenSub: "user_01",
    scopes: ["write", "read", "share"],
  },
  "mcp-read-only": {
    tokenSub: "user_02",
    scopes: ["read"],
  },
});

function mcpPost(
  body: unknown,
  options: {
    authorization?: string;
    accept?: string;
    resource?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.authorization) {
    headers.authorization = options.authorization;
  }
  if (options.accept) {
    headers.accept = options.accept;
  }
  return handleMcpEndpoint(
    new Request("https://mcp.test/", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    {
      MCP_RESOURCE: options.resource ?? "https://mcp.preview.agent-paste.sh",
    },
    { verifyBearer: testAuth },
  );
}

describe("MCP streamable HTTP transport", () => {
  it("rejects GET with 405 in stateless v1", async () => {
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", { method: "GET" }),
      {},
      {
        verifyBearer: testAuth,
      },
    );
    expect(response.status).toBe(405);
  });

  it("returns WWW-Authenticate when bearer is missing", async () => {
    const response = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh"),
    );
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("invalid_token");
  });

  it("rejects API keys at the MCP surface", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      },
      { authorization: "Bearer ap_pk_live_example" },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("rejects malformed JSON-RPC with 400", async () => {
    const response = await mcpPost(
      { jsonrpc: "1.0", method: "ping", id: 1 },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("invalid_params");
  });

  it("accepts initialize over JSON", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "agent-paste" },
      },
    });
  });

  it("returns initialize over SSE when requested", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      },
      {
        authorization: "Bearer mcp-valid-token",
        accept: "application/json, text/event-stream",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: message");
    expect(text).toContain('"id":9');
    expect(text).toContain('"protocolVersion":"2025-06-18"');
  });

  it("accepts initialized notification with 202", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("returns method_not_found for tools/call until forwarding ships", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("method_not_found");
  });

  it("lists no tools until the tool surface is implemented", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: { tools: [] },
    });
  });
});
