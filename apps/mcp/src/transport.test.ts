import { mcpWwwAuthenticateHeader } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { createTestMcpBearerAuth } from "./auth.js";
import { MCP_PROTOCOL_VERSION } from "./jsonrpc.js";
import { handleMcpEndpoint } from "./transport.js";

const testAuth = createTestMcpBearerAuth({
  "mcp-valid-token": {
    tokenSub: "user_01",
  },
  "mcp-read-only": {
    tokenSub: "user_02",
  },
});

function whoamiResponse(scopes: readonly string[]) {
  return Response.json({
    workspace_member: { id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", email: "user@example.com" },
    workspace: { id: "550e8400-e29b-41d4-a716-446655440000", name: "Personal", created_at: "2026-05-20T12:00:00.000Z" },
    scopes: [...scopes],
  });
}

function mcpPost(
  body: unknown,
  options: {
    authorization?: string;
    accept?: string;
    resource?: string;
    origin?: string;
    protocolVersion?: string;
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
  if (options.origin) {
    headers.origin = options.origin;
  }
  if (options.protocolVersion) {
    headers["mcp-protocol-version"] = options.protocolVersion;
  }
  return handleMcpEndpoint(
    new Request("https://mcp.test/", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    {
      MCP_RESOURCE: options.resource ?? "https://mcp.preview.agent-paste.sh/",
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
      { MCP_RESOURCE: "https://mcp.preview.agent-paste.sh/" },
      { verifyBearer: testAuth },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh/"),
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
      { MCP_RESOURCE: "https://mcp.preview.agent-paste.sh/" },
      { verifyBearer: testAuth },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh/"),
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
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh/"),
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

  it("rejects cross-origin requests before authentication", async () => {
    const response = await mcpPost(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { authorization: "Bearer mcp-valid-token", origin: "https://attacker.example" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { data: { code: "invalid_request" }, message: "invalid_origin" },
    });
  });

  it("accepts absent or same-origin Origin headers", async () => {
    const absent = await mcpPost(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { authorization: "Bearer mcp-valid-token" },
    );
    const same = await mcpPost(
      { jsonrpc: "2.0", id: 2, method: "ping" },
      { authorization: "Bearer mcp-valid-token", origin: "https://mcp.test" },
    );

    expect(absent.status).toBe(200);
    expect(same.status).toBe(200);
  });

  it("rejects unsupported MCP-Protocol-Version headers", async () => {
    const response = await mcpPost(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { authorization: "Bearer mcp-valid-token", protocolVersion: "2025-03-26" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { data: { code: "invalid_params" }, message: "unsupported_mcp_protocol_version" },
    });
  });

  it("rate limits by caller IP before authentication", async () => {
    let observedKey = "";
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.4",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      {},
      {
        verifyBearer: testAuth,
        ipRateLimit: {
          async limit({ key }) {
            observedKey = key;
            return { success: false };
          },
        },
      },
    );

    expect(observedKey).toBe("mcp:203.0.113.4");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("fails closed when the production rate-limit binding is missing or unavailable", async () => {
    const request = () => new Request("https://mcp.test/", { method: "POST" });
    const missing = await handleMcpEndpoint(request(), {});
    const unavailable = await handleMcpEndpoint(
      request(),
      {},
      {
        ipRateLimit: {
          async limit() {
            throw new Error("binding unavailable");
          },
        },
      },
    );

    expect(missing.status).toBe(503);
    expect(unavailable.status).toBe(503);
  });

  it("returns 503 without an auth challenge when token verification is unavailable", async () => {
    const response = await handleMcpEndpoint(
      new Request("https://mcp.test/", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      {},
      {
        verifyBearer: async () => ({
          ok: false,
          code: "database_unavailable",
          message: "oauth_verification_unavailable",
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
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

  it("returns internal_error for tools/call when service bindings are missing", async () => {
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
    const upload = { fetchMcp: async () => new Response(null, { status: 500 }) };
    const api = {
      async fetchMcp(request: Request, subject: string, routeId: string) {
        expect(request.headers.has("authorization")).toBe(false);
        expect(subject).toBe("user_01");
        expect(routeId).toBe("mcp.whoami");
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
          scopes: ["read", "publish"],
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
      { verifyBearer: testAuth, api, upload },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result: { structuredContent: { workspace_member: { id: string } } };
    };
    expect(payload.result.structuredContent.workspace_member.id).toBe("mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");
  });

  it("returns insufficient_scope when the member's granted scopes lack the requirement", async () => {
    const upload = { fetchMcp: async () => new Response(null, { status: 500 }) };
    const api = { fetchMcp: async () => whoamiResponse(["read"]) };
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
      { verifyBearer: testAuth, api, upload },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe(mcpWwwAuthenticateHeader(undefined, "insufficient_scope"));
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    const payload = (await response.json()) as { error: { data: { code: string } } };
    expect(payload.error.data.code).toBe("insufficient_scope");
  });

  it("attaches an invalid_token challenge when forwarded auth fails mid-session", async () => {
    const upload = { fetchMcp: async () => new Response(null, { status: 500 }) };
    const api = {
      fetchMcp: async () =>
        Response.json({ error: { code: "not_authenticated", message: "not_authenticated" } }, { status: 401 }),
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
          id: 11,
          method: "tools/call",
          params: { name: "whoami", arguments: {} },
        }),
      }),
      { MCP_RESOURCE: "https://mcp.preview.agent-paste.sh/" },
      { verifyBearer: testAuth, api, upload },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      mcpWwwAuthenticateHeader("https://mcp.preview.agent-paste.sh/", "invalid_token"),
    );
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
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
      { resource: "https://mcp.agent-paste.sh/" },
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

  it("rejects an oversized JSON-RPC body after authentication", async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          throw new Error("body should not be read when content-length exceeds the cap");
        },
      },
      { highWaterMark: 0 },
    );
    const request = {
      method: "POST",
      headers: new Headers({
        authorization: "Bearer mcp-valid-token",
        "content-type": "application/json",
        "content-length": String(1024 * 1024 + 1),
      }),
      body,
      url: "https://mcp.test/",
    } as unknown as Request;
    const response = await handleMcpEndpoint(request, {}, { verifyBearer: testAuth });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { data: { code: "invalid_params" }, message: "request_body_too_large" },
    });
  });

  it("reports an unreadable JSON-RPC body separately from size overflow", async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          throw new Error("stream boom");
        },
      },
      { highWaterMark: 0 },
    );
    const request = {
      method: "POST",
      headers: new Headers({
        authorization: "Bearer mcp-valid-token",
        "content-type": "application/json",
      }),
      body,
      url: "https://mcp.test/",
    } as unknown as Request;

    const response = await handleMcpEndpoint(request, {}, { verifyBearer: testAuth });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { data: { code: "invalid_params" }, message: "request_body_unreadable" },
    });
  });

  it("accepts client JSON-RPC responses with 202", async () => {
    const response = await mcpPost({ jsonrpc: "2.0", id: 2, result: {} }, { authorization: "Bearer mcp-valid-token" });
    expect(response.status).toBe(202);
  });

  it("accepts standard and unknown notifications with 202 while rejecting requests without ids", async () => {
    const cancelled = await mcpPost(
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
      { authorization: "Bearer mcp-valid-token" },
    );
    const rootsListChanged = await mcpPost(
      { jsonrpc: "2.0", method: "notifications/roots/list_changed" },
      { authorization: "Bearer mcp-valid-token" },
    );
    const unknownNotification = await mcpPost(
      { jsonrpc: "2.0", method: "notifications/unknown" },
      { authorization: "Bearer mcp-valid-token" },
    );
    const invalidRequest = await mcpPost(
      { jsonrpc: "2.0", method: "ping", id: [] },
      { authorization: "Bearer mcp-valid-token" },
    );
    expect(cancelled.status).toBe(202);
    expect(rootsListChanged.status).toBe(202);
    expect(unknownNotification.status).toBe(202);
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

  it("does not reflect caller-provided Mcp-Session-Id on stateless responses", async () => {
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
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("lists all ADR 0061 tools with JSON Schema inputs", async () => {
    const response = await mcpPost(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      },
      { authorization: "Bearer mcp-valid-token" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
    });
    const tools = (body as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual([
      "publish_artifact",
      "add_revision",
      "multi_edit",
      "list_artifacts",
      "read_artifact",
      "read_file",
      "list_revisions",
      "delete_artifact",
      "update_display_metadata",
      "whoami",
    ]);
    expect(tools.every((tool) => tool.name && "inputSchema" in tool && typeof tool.inputSchema === "object")).toBe(
      true,
    );
  });
});
