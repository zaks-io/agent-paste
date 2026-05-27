import { describe, expect, it } from "vitest";
import { parseMcpJsonRpcBody, wantsEventStreamResponse } from "./jsonrpc.js";

describe("MCP JSON-RPC parsing", () => {
  it("rejects non-object bodies", () => {
    expect(parseMcpJsonRpcBody(null).kind).toBe("invalid");
    expect(parseMcpJsonRpcBody("text").kind).toBe("invalid");
  });

  it("accepts client JSON-RPC responses without a method", () => {
    const parsed = parseMcpJsonRpcBody({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
    expect(parsed).toEqual({
      kind: "response",
      response: { jsonrpc: "2.0", id: 7, result: { ok: true } },
    });
  });

  it("detects SSE accept preferences", () => {
    expect(wantsEventStreamResponse(null)).toBe(false);
    expect(wantsEventStreamResponse("application/json")).toBe(false);
    expect(wantsEventStreamResponse("application/json, text/event-stream")).toBe(true);
  });
});
