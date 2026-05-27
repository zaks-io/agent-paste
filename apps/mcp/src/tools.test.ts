import { describe, expect, it, vi } from "vitest";
import { callMcpTool } from "./tools.js";

const auth = { tokenSub: "user_01", scopes: ["read"] as const, bearerToken: "token-read" };
const whoamiBody = {
  workspace_member: { id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", email: "user@example.com" },
  workspace: { id: "550e8400-e29b-41d4-a716-446655440000", name: "Personal", created_at: "2026-05-20T12:00:00.000Z" },
  scopes: ["read"],
};

describe("callMcpTool", () => {
  const upload = { fetch: vi.fn() };

  it("rejects invalid tool call params", async () => {
    const result = await callMcpTool("not-a-tool", {}, auth, {
      api: { fetch: vi.fn() },
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("rejects tools when delegated scopes are insufficient", async () => {
    const result = await callMcpTool("publish_artifact", { title: "t", body: "b", render_mode: "text" }, auth, {
      api: { fetch: vi.fn() },
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("insufficient_scope");
    }
  });

  it("returns list_artifacts results from the API binding", async () => {
    const listBody = {
      data: [],
      page_info: { next_cursor: null, has_more: false },
    };
    const api = {
      fetch: vi.fn(async () => Response.json(listBody)),
    };
    const result = await callMcpTool(
      "list_artifacts",
      {},
      { tokenSub: "user_01", scopes: ["read"], bearerToken: "token-read" },
      { api, upload, bearerToken: "token-read" },
    );
    expect(result).toEqual({ ok: true, result: listBody });
  });

  it("returns whoami results from the API binding", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json(whoamiBody)),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result).toEqual({ ok: true, result: whoamiBody });
  });

  it("surfaces API forwarding failures", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ error: { code: "forbidden", message: "forbidden" } }, { status: 403 })),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("insufficient_scope");
    }
  });

  it("returns internal_error when whoami payload fails validation", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ workspace_member: { id: "bad" } })),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
    }
  });
});
