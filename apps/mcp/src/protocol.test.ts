import { describe, expect, it, vi } from "vitest";
import { handleMcpProtocolMethod } from "./protocol.js";

const auth = { tokenSub: "user_01", scopes: ["read"] as const, bearerToken: "token-read" };

describe("handleMcpProtocolMethod tools/call", () => {
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
      toolDeps: { api: { fetch: vi.fn(async () => Response.json(whoami)) }, bearerToken: auth.bearerToken },
    });
    expect(handled.kind).toBe("result");
    if (handled.kind === "result") {
      expect(handled.response.result).toMatchObject({
        structuredContent: whoami,
        content: [{ type: "text", text: JSON.stringify(whoami) }],
      });
    }
  });
});
