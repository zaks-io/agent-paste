import { describe, expect, it } from "vitest";
import {
  deriveMcpIdempotencyKey,
  mapApiErrorToMcp,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
  mcpProtectedResourceMetadata,
  mcpTokenHasRequiredScopes,
  mcpToolContracts,
  mcpToolContractByName,
  McpPublishArtifactInput,
  McpToolName,
  toMcpJsonRpcError,
} from "./mcp.js";

describe("MCP tool registry", () => {
  it("registers the twelve ADR 0061 tools in snake_case", () => {
    expect(mcpToolContracts.map((tool) => tool.name)).toEqual([
      "publish_artifact",
      "add_revision",
      "list_artifacts",
      "read_artifact",
      "list_revisions",
      "delete_artifact",
      "update_display_metadata",
      "create_share_link",
      "create_revision_link",
      "list_access_links",
      "revoke_access_link",
      "whoami",
    ]);
  });

  it("requires OAuth-only auth on every tool", () => {
    expect(mcpToolContracts.every((tool) => tool.auth === "mcp_oauth")).toBe(true);
  });

  it("requires write read share for publish tools", () => {
    expect(mcpToolContractByName("publish_artifact").requiredScopes).toEqual(["write", "read", "share"]);
    expect(mcpToolContractByName("add_revision").requiredScopes).toEqual(["write", "read", "share"]);
  });

  it("threads publish chains through upload and api routes", () => {
    const publish = mcpToolContractByName("publish_artifact");
    expect(publish.forwardedCalls.map((call) => call.routeId)).toEqual([
      "uploadSessions.create",
      "uploadSessions.putFile",
      "uploadSessions.finalize",
      "revisions.publish",
      "accessLinks.createShare",
      "accessLinks.mint",
    ]);
    expect(publish.forwardedCalls.every((call) => call.auth === "mcp_bearer" || call.auth === "signed_upload_url")).toBe(
      true,
    );
  });

  it("accepts only text render modes for publish tools", () => {
    expect(
      McpPublishArtifactInput.safeParse({
        title: "Demo",
        body: "hello",
        render_mode: "html",
      }).success,
    ).toBe(true);
    expect(
      McpPublishArtifactInput.safeParse({
        title: "Demo",
        body: "hello",
        render_mode: "image",
      }).success,
    ).toBe(false);
  });
});

describe("MCP auth and idempotency helpers", () => {
  it("builds protected resource metadata with delegated scopes", () => {
    expect(
      mcpProtectedResourceMetadata({
        authorizationServers: ["https://auth.example.test"],
      }),
    ).toEqual({
      resource: "https://mcp.agent-paste.sh",
      authorization_servers: ["https://auth.example.test"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["write", "read", "share"],
    });
  });

  it("derives entrypoints from render mode", () => {
    expect(mcpEntrypointForRenderMode("html")).toBe("index.html");
    expect(mcpEntrypointForRenderMode("markdown")).toBe("index.md");
    expect(mcpEntrypointForRenderMode("text")).toBe("content.txt");
  });

  it("checks delegated scope subsets", () => {
    expect(mcpTokenHasRequiredScopes(["write", "read", "share"], ["read"])).toBe(true);
    expect(mcpTokenHasRequiredScopes(["read"], ["write"])).toBe(false);
  });

  it("derives idempotency keys from token sub, json rpc id, and tool name", () => {
    expect(
      deriveMcpIdempotencyKey({
        tokenSub: "user_01",
        jsonRpcId: 42,
        toolName: "publish_artifact",
      }),
    ).toBe("mcp:user_01:42:publish_artifact");
  });
});

describe("MCP error mapping", () => {
  it("maps API errors to JSON-RPC application errors", () => {
    const mapped = mapApiErrorToMcp({
      code: "artifact_not_found",
      message: "artifact_not_found",
      requestId: "req_123",
    });
    expect(mapped).toMatchObject({
      code: "artifact_not_found",
      httpStatus: 404,
      jsonRpcCode: -32000,
      requestId: "req_123",
    });
  });

  it("maps protocol auth and scope failures", () => {
    expect(mapMcpProtocolError("invalid_token", "invalid_token")).toMatchObject({
      code: "invalid_token",
      httpStatus: 401,
    });
    expect(mapMcpProtocolError("insufficient_scope", "insufficient_scope")).toMatchObject({
      code: "insufficient_scope",
      httpStatus: 403,
    });
  });

  it("renders JSON-RPC error envelopes with stable data codes", () => {
    const envelope = toMcpJsonRpcError(
      mapMcpProtocolError("insufficient_scope", "Actor lacks share scope"),
    );
    expect(envelope.data?.code).toBe("insufficient_scope");
    expect(envelope.message).toBe("Actor lacks share scope");
  });
});

describe("MCP tool name enum", () => {
  it("covers every registry entry", () => {
    for (const tool of mcpToolContracts) {
      expect(McpToolName.safeParse(tool.name).success).toBe(true);
    }
  });
});
