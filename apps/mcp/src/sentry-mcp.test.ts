import { describe, expect, it, vi } from "vitest";
import { traceMcpRequest } from "./sentry-mcp.js";

const sentryMock = vi.hoisted(() => ({
  spans: [] as Array<{
    options: { name: string; op?: string; attributes?: Record<string, unknown> };
    span: {
      setAttribute: ReturnType<typeof vi.fn>;
      setAttributes: ReturnType<typeof vi.fn>;
      setStatus: ReturnType<typeof vi.fn>;
    };
  }>,
  startSpan: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({
  startSpan: sentryMock.startSpan,
}));

describe("traceMcpRequest", () => {
  it("records MCP method and tool metadata without request bodies", async () => {
    withMockSpan();

    await traceMcpRequest(
      {
        method: "tools/call",
        id: 7,
        params: { name: "whoami", arguments: { ignored: "body" } },
        sessionId: "session-abc",
      },
      async () => ({
        kind: "result",
        response: { jsonrpc: "2.0", id: 7, result: {} },
      }),
    );

    expect(sentryMock.spans[0]?.options).toMatchObject({
      name: "MCP tools/call",
      op: "mcp.server",
      attributes: {
        "mcp.method.name": "tools/call",
        "mcp.request.id": "7",
        "mcp.session.id": "session-abc",
        "mcp.tool.name": "whoami",
        "mcp.server.name": "agent-paste",
        "mcp.protocol.version": "2025-06-18",
      },
    });
    expect(sentryMock.spans[0]?.options.attributes).not.toHaveProperty("mcp.request.argument.ignored");
    expect(sentryMock.spans[0]?.span.setAttribute).toHaveBeenCalledWith("mcp.tool.result.is_error", false);
    expect(sentryMock.spans[0]?.span.setStatus).toHaveBeenCalledWith({ code: 1 });
  });

  it("marks protocol errors on the span without capturing outputs", async () => {
    withMockSpan();

    await traceMcpRequest(
      {
        method: "tools/call",
        id: "req-1",
        params: { name: "publish_artifact" },
        sessionId: null,
      },
      async () => ({
        kind: "error",
        error: { code: "invalid_params", message: "invalid_params" },
      }),
    );

    expect(sentryMock.spans[0]?.span.setAttributes).toHaveBeenCalledWith({
      "mcp.error.code": "invalid_params",
      "mcp.tool.result.is_error": true,
    });
    expect(sentryMock.spans[0]?.span.setStatus).toHaveBeenCalledWith({ code: 2, message: "invalid_params" });
  });
});

function withMockSpan() {
  sentryMock.spans.length = 0;
  sentryMock.startSpan.mockImplementation((options, callback) => {
    const span = {
      setAttribute: vi.fn().mockReturnThis(),
      setAttributes: vi.fn().mockReturnThis(),
      setStatus: vi.fn().mockReturnThis(),
    };
    sentryMock.spans.push({ options, span });
    return callback(span);
  });
}
