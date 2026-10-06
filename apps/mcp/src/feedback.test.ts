import { buildMcpToolList, mcpToolContractByName, resolveMcpForwardedCalls } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { handleMcpProtocolMethod } from "./protocol.js";
import { MCP_SERVER_INFO } from "./server-card.js";
import { callMcpTool } from "./tools.js";

const feedbackId = "fb_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const auth = { tokenSub: "user_read_member" };

function dependencies(response = Response.json({ feedback_id: feedbackId })) {
  return {
    api: { fetchMcp: vi.fn(async (_request: Request, _subject: string, _routeId: string) => response.clone()) },
    upload: { fetchMcp: vi.fn() },
    tokenSub: auth.tokenSub,
    jsonRpcId: 1,
  };
}

describe("feedback MCP tool", () => {
  it("is registered with no required scope and forwards to the idempotent API route", () => {
    const contract = mcpToolContractByName("feedback");
    expect(contract.requiredScopes).toEqual([]);
    expect(resolveMcpForwardedCalls(contract)).toEqual([
      expect.objectContaining({
        routeId: "feedback.create",
        app: "api",
        method: "POST",
        path: "/v1/feedback",
        idempotency: "required",
      }),
    ]);
    const descriptor = buildMcpToolList().tools.find((tool) => tool.name === "feedback");
    expect(descriptor?.inputSchema).toMatchObject({ type: "object", required: ["body"] });
  });

  it("returns the created id via tools/call using verified subject RPC and automatic context", async () => {
    const deps = dependencies();
    const result = await handleMcpProtocolMethod({
      method: "tools/call",
      params: {
        name: "feedback",
        arguments: {
          body: "  read failed  ",
        },
      },
      id: 1,
      auth,
      toolDeps: deps,
    });
    expect(result).toMatchObject({
      kind: "result",
      response: { result: { structuredContent: { feedback_id: feedbackId } } },
    });
    expect(deps.api.fetchMcp).toHaveBeenCalledTimes(1);
    const [request, subject, routeId] = deps.api.fetchMcp.mock.calls[0] as unknown as [Request, string, string];
    expect(subject).toBe(auth.tokenSub);
    expect(routeId).toBe("feedback.create");
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/v1/feedback");
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.get("idempotency-key")).toMatch(/^mcp:/);
    expect(await request.json()).toEqual({
      body: "read failed",
      context: { surface: "mcp", version: MCP_SERVER_INFO.version, tool: "feedback" },
    });
    expect(deps.upload.fetchMcp).not.toHaveBeenCalled();
  });

  it.each([
    { body: "" },
    { body: " " },
    { body: "x".repeat(10001) },
    { body: "report", context: { details: "unsupported" } },
    { body: "report", unexpected: true },
  ])("maps invalid body or unsupported context to invalid_params without a network call", async (input) => {
    const deps = dependencies();
    const result = await callMcpTool("feedback", input, auth, deps);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_params", httpStatus: 400 } });
    expect(deps.api.fetchMcp).not.toHaveBeenCalled();
  });

  it("derives the same retry key for the same request without collapsing changed bodies", async () => {
    const deps = dependencies();
    await callMcpTool("feedback", { body: "first" }, auth, deps);
    await callMcpTool("feedback", { body: "first" }, auth, deps);
    await callMcpTool("feedback", { body: "second" }, auth, deps);
    const keys = deps.api.fetchMcp.mock.calls.map((call) =>
      (call[0] as unknown as Request).headers.get("idempotency-key"),
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it("preserves API validation and availability error mapping", async () => {
    for (const [code, status] of [
      ["invalid_request", 400],
      ["database_unavailable", 503],
    ] as const) {
      const result = await callMcpTool(
        "feedback",
        { body: "report" },
        auth,
        dependencies(Response.json({ error: { code, message: code, request_id: "req_feedback" } }, { status })),
      );
      expect(result).toMatchObject({ ok: false, error: { code, httpStatus: status } });
    }
  });

  it("rejects a malformed successful API response", async () => {
    const result = await callMcpTool(
      "feedback",
      { body: "report" },
      auth,
      dependencies(Response.json({ feedback_id: "invalid" })),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
});
