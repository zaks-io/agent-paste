import { mcpWwwAuthenticateHeader } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { createTestMcpBearerAuth } from "./auth.js";
import { MCP_PROTOCOL_VERSION } from "./jsonrpc.js";
import { handleMcpEndpoint } from "./transport.js";

const testAuth = createTestMcpBearerAuth({
  "mcp-valid-token": {
    tokenSub: "user_01",
    scopes: ["write", "read", "share"],
    bearerToken: "mcp-valid-token",
  },
  "mcp-read-only": {
    tokenSub: "user_02",
    scopes: ["read"],
    bearerToken: "mcp-read-only",
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

  it("returns 401 with WWW-Authenticate before parsing when bearer is missing and content-type is invalid", async () => {
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not json",
      }),
      { MCP_RESOURCE: "https://mcp.preview.agent-paste.sh" },
      { verifyBearer: testAuth },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh"),
    );
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("invalid_token");
  });

  it("returns 401 with WWW-Authenticate before parsing when bearer is missing and JSON is invalid", async () => {
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
      { MCP_RESOURCE: "https://mcp.preview.agent-paste.sh" },
      { verifyBearer: testAuth },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh"),
    );
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("invalid_token");
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

  it("returns internal_error for tools/call when the API binding is missing", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("internal_error");
  });

  it("forwards whoami over the API service binding", async () => {
    const api = {
      async fetch(request: Request) {
        expect(request.headers.get("authorization")).toBe("Bearer mcp-valid-token");
        expect(new URL(request.url).pathname).toBe("/v1/mcp/whoami");
        return Response.json({
          workspace_member: {
            id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            email: "user@example.com",
          },
          workspace: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "Personal",
            created_at: "2026-05-20T12:00:00.000Z",
          },
          scopes: ["read", "share"],
        });
      },
    };

    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer mcp-valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        }),
      }),
      {},
      { verifyBearer: testAuth, api },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result: { structuredContent: { workspace_member: { id: string } } };
    };
    expect(payload.result.structuredContent.workspace_member.id).toBe("mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");
  });

  it("returns insufficient_scope when the token lacks required scopes", async () => {
    const api = { fetch: async () => new Response(null, { status: 500 }) };
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer mcp-read-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "publish_artifact", arguments: { title: "t", body: "b", render_mode: "text" } },
        }),
      }),
      {},
      { verifyBearer: testAuth, api },
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("insufficient_scope");
  });

  it("rejects DELETE and non-POST methods with 405", async () => {
    const deleteResponse = await handleMcpEndpoint(
      new Request("https://mcp.test/", { method: "DELETE" }),
      {},
      { verifyBearer: testAuth },
    );
    const putResponse = await handleMcpEndpoint(
      new Request("https://mcp.test/", { method: "PUT" }),
      {},
      { verifyBearer: testAuth },
    );
    expect(deleteResponse.status).toBe(405);
    expect(putResponse.status).toBe(405);
  });

  it("uses the default resource indicator challenge on production resource", async () => {
    const response = await mcpPost(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { resource: "https://mcp.agent-paste.sh" },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(mcpWwwAuthenticateHeader());
  });

  it("returns 400 for invalid content-type or JSON after auth succeeds", async () => {
    const badType = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer mcp-valid-token",
          "content-type": "text/plain",
        },
        body: "x",
      }),
      {},
      { verifyBearer: testAuth },
    );
    const badJson = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer mcp-valid-token",
          "content-type": "application/json",
        },
        body: "not-json",
      }),
      {},
      { verifyBearer: testAuth },
    );
    expect(badType.status).toBe(400);
    expect(badJson.status).toBe(400);
  });

  it("accepts client JSON-RPC responses with 202", async () => {
    const response = await mcpPost({ jsonrpc: "2.0", id: 2, result: {} }, { authorization: "Bearer mcp-valid-token" });
    expect(response.status).toBe(202);
  });

  it("rejects unknown notifications and requests without ids", async () => {
    const unknownNotification = await mcpPost(
      { jsonrpc: "2.0", method: "notifications/unknown" },
      { authorization: "Bearer mcp-valid-token" },
    );
    const invalidRequest = await mcpPost(
      { jsonrpc: "2.0", method: "ping", id: [] },
      { authorization: "Bearer mcp-valid-token" },
    );
    expect(unknownNotification.status).toBe(404);
    expect(invalidRequest.status).toBe(400);
  });

  it("handles ping and unknown methods", async () => {
    const ping = await mcpPost({ jsonrpc: "2.0", id: 5, method: "ping" }, { authorization: "Bearer mcp-valid-token" });
    const unknown = await mcpPost(
      { jsonrpc: "2.0", id: 6, method: "experimental/method" },
      { authorization: "Bearer mcp-valid-token" },
    );
    expect(ping.status).toBe(200);
    await expect(ping.json()).resolves.toMatchObject({ jsonrpc: "2.0", id: 5, result: {} });
    expect(unknown.status).toBe(404);
  });

  it("echoes Mcp-Session-Id on JSON responses when provided", async () => {
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer mcp-valid-token",
          "content-type": "application/json",
          accept: "application/json",
          "mcp-session-id": "session-abc",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "ping",
        }),
      }),
      {},
      { verifyBearer: testAuth },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBe("session-abc");
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
