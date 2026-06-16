import { mcpToolContracts } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { handleMcpProtocolMethod } from "./protocol.js";

const auth = { tokenSub: "user_01", scopes: ["read"] as const, bearerToken: "token-read" };

describe("handleMcpProtocolMethod tools/call", () => {
  it("initializes with publish follow-up instructions that match MCP outputs", () => {
    const handled = handleMcpProtocolMethod({
      method: "initialize",
      params: {},
      id: 0,
      auth,
    });
    expect(handled.kind).toBe("result");
    if (handled.kind === "result") {
      const instructions = (handled.response.result as { instructions: string }).instructions;
      expect(instructions).toContain("Publish responses intentionally omit artifact_id");
      expect(instructions).toContain("recover it with list_artifacts (data[].id)");
      expect(instructions).toContain("Once you have artifact_id");
      expect(instructions).not.toMatch(/artifact_id from each publish_artifact response/);
      expect(instructions).not.toContain("data[].id), read_artifact");
    }
  });

  it("returns internal_error when the API binding is missing", async () => {
    const handled = await handleMcpProtocolMethod({
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
      id: 1,
      auth,
    });
    expect(handled).toEqual({
      kind: "error",
      error: expect.objectContaining({ code: "internal_error" }),
    });
  });

  it("returns tool errors from callMcpTool", async () => {
    const handled = await handleMcpProtocolMethod({
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
      id: 2,
      auth: { tokenSub: "user_01", scopes: ["read"], bearerToken: "token-read" },
      toolDeps: {
        api: {
          fetch: vi.fn(async () =>
            Response.json({ error: { code: "not_authenticated", message: "not_authenticated" } }, { status: 401 }),
          ),
        },
        upload: { fetch: vi.fn() },
        bearerToken: "token-read",
      },
    });
    expect(handled.kind).toBe("error");
    if (handled.kind === "error") {
      expect(handled.error.code).toBe("invalid_token");
    }
  });

  it("wraps successful tool output in JSON-RPC content", async () => {
    const whoami = {
      workspace_member: { id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", email: "user@example.com" },
      workspace: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Personal",
        created_at: "2026-05-20T12:00:00.000Z",
      },
      scopes: ["read"],
    };
    const handled = await handleMcpProtocolMethod({
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
      id: 3,
      auth,
      toolDeps: {
        api: { fetch: vi.fn(async () => Response.json(whoami)) },
        upload: { fetch: vi.fn() },
        bearerToken: auth.bearerToken,
      },
    });
    expect(handled.kind).toBe("result");
    if (handled.kind === "result") {
      expect(handled.response.result).toMatchObject({
        structuredContent: whoami,
        content: [{ type: "text", text: JSON.stringify(whoami) }],
      });
    }
  });

  it("accepts the MCP-reserved _meta member on tools/call params", async () => {
    const whoami = {
      workspace_member: { id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", email: "user@example.com" },
      workspace: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Personal",
        created_at: "2026-05-20T12:00:00.000Z",
      },
      scopes: ["read"],
    };
    const handled = await handleMcpProtocolMethod({
      method: "tools/call",
      params: { name: "whoami", arguments: {}, _meta: { progressToken: 1 } },
      id: 4,
      auth,
      toolDeps: {
        api: { fetch: vi.fn(async () => Response.json(whoami)) },
        upload: { fetch: vi.fn() },
        bearerToken: auth.bearerToken,
      },
    });
    expect(handled.kind).toBe("result");
  });
});

describe("handleMcpProtocolMethod protocol errors", () => {
  it("returns method_not_found for unknown methods", () => {
    const handled = handleMcpProtocolMethod({
      method: "unknown/method",
      params: undefined,
      id: 10,
      auth: { tokenSub: "user_01", scopes: ["read"], bearerToken: "token-read" },
    });
    expect(handled).toEqual({
      kind: "error",
      error: expect.objectContaining({ code: "method_not_found" }),
    });
  });
});

describe("handleMcpProtocolMethod tools/list", () => {
  it("returns descriptors for every ADR 0061 tool", () => {
    const handled = handleMcpProtocolMethod({
      method: "tools/list",
      params: undefined,
      id: 9,
      auth: { tokenSub: "user_01", scopes: ["read"], bearerToken: "token-read" },
    });
    expect(handled.kind).toBe("result");
    if (handled.kind === "result") {
      const tools = (handled.response.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.map((tool) => tool.name)).toEqual(mcpToolContracts.map((tool) => tool.name));
    }
  });
});
