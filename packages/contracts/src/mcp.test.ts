import { describe, expect, it } from "vitest";
import { UpdateDisplayMetadataRequest } from "./accessLinks.js";
import {
  apiScopesToMcpScopes,
  buildMcpToolList,
  deriveMcpIdempotencyKey,
  McpAddRevisionInput,
  McpPublishArtifactInput,
  McpToolName,
  McpUpdateDisplayMetadataInput,
  mapApiErrorToMcp,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
  mcpIdempotencySegment,
  mcpProtectedResourceMetadata,
  mcpPublishAccessLinkIdempotencyKey,
  mcpScopesToApiScopes,
  mcpTokenHasRequiredScopes,
  mcpToolContractByName,
  mcpToolContracts,
  mcpWwwAuthenticateHeader,
  resolveMcpForwardedCall,
  toMcpJsonRpcError,
  trimTrailingSlashes,
} from "./mcp.js";
import { IdempotencyKey } from "./primitives.js";
import { routeContractById } from "./routes.js";

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

  it("builds tools/list descriptors for every registered tool", () => {
    const listed = buildMcpToolList();
    expect(listed.tools.map((tool) => tool.name)).toEqual(mcpToolContracts.map((tool) => tool.name));
    expect(listed.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("requires write and read for publish tools", () => {
    expect(mcpToolContractByName("publish_artifact").requiredScopes).toEqual(["write", "read"]);
    expect(mcpToolContractByName("add_revision").requiredScopes).toEqual(["write", "read"]);
  });

  it("threads publish chains through upload, publish, and optional share-link routes", () => {
    const publish = mcpToolContractByName("publish_artifact");
    expect(publish.forwardedCalls.map((call) => call.routeId)).toEqual([
      "uploadSessions.create",
      "uploadSessions.putFile",
      "uploadSessions.finalize",
      "revisions.publish",
      "accessLinks.create",
      "accessLinks.mint",
    ]);
    const requiredAccessLinkCalls = publish.forwardedCalls.filter((call) => !("optional" in call && call.optional));
    expect(requiredAccessLinkCalls.filter((call) => call.routeId === "accessLinks.create")).toHaveLength(0);
    expect(requiredAccessLinkCalls.filter((call) => call.routeId === "accessLinks.mint")).toHaveLength(0);
    expect(
      publish.forwardedCalls.every((call) => call.auth === "mcp_bearer" || call.auth === "signed_upload_url"),
    ).toBe(true);
  });

  it("labels optional publish-chain share-link creates with derived idempotency keys, not same_as_tool", () => {
    for (const toolName of ["publish_artifact", "add_revision"] as const) {
      const tool = mcpToolContractByName(toolName);
      const accessLinkCreates = tool.forwardedCalls.filter((call) => call.routeId === "accessLinks.create");
      expect(accessLinkCreates).toHaveLength(1);
      expect(accessLinkCreates[0]?.idempotencyKey).toBe("derived_share_link");
      expect(accessLinkCreates.every((call) => call.idempotencyKey !== "same_as_tool")).toBe(true);
    }
  });

  it("resolves forwarded method, path, app, and idempotency from route contracts", () => {
    for (const tool of mcpToolContracts) {
      for (const call of tool.forwardedCalls) {
        const route = routeContractById(call.routeId);
        const resolved = resolveMcpForwardedCall(call);

        expect(resolved.app, `${tool.name}:${call.routeId}`).toBe(route.app);
        expect(resolved.method, `${tool.name}:${call.routeId}`).toBe(route.method);
        expect(resolved.path, `${tool.name}:${call.routeId}`).toBe(route.path);
        expect(resolved.idempotency, `${tool.name}:${call.routeId}`).toBe(route.idempotency);
        expect("app" in call, `${tool.name}:${call.routeId}`).toBe(false);
        expect("method" in call, `${tool.name}:${call.routeId}`).toBe(false);
        expect("path" in call, `${tool.name}:${call.routeId}`).toBe(false);

        const idempotencyKeySource = "idempotencyKey" in call ? call.idempotencyKey : undefined;
        if (route.idempotency === "required") {
          expect(idempotencyKeySource, `${tool.name}:${call.routeId}`).toBeDefined();
        } else {
          expect(idempotencyKeySource, `${tool.name}:${call.routeId}`).toBeUndefined();
        }
      }
    }
  });

  it("requires title-only UpdateDisplayMetadataRequest bodies", () => {
    expect(UpdateDisplayMetadataRequest.safeParse({ title: "Renamed" }).success).toBe(true);
    expect(UpdateDisplayMetadataRequest.safeParse({ description: "not supported" }).success).toBe(false);
    expect(UpdateDisplayMetadataRequest.safeParse({}).success).toBe(false);
  });

  it("requires artifact_id and title for update_display_metadata", () => {
    expect(
      McpUpdateDisplayMetadataInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        title: "Renamed",
      }).success,
    ).toBe(true);
    expect(
      McpUpdateDisplayMetadataInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        description: "not supported",
      }).success,
    ).toBe(false);
    expect(
      McpUpdateDisplayMetadataInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }).success,
    ).toBe(false);
  });

  it("omits description from update_display_metadata tools/list schema", () => {
    const tool = buildMcpToolList().tools.find((entry) => entry.name === "update_display_metadata");
    expect(tool).toBeDefined();
    const properties = (tool?.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(properties).toHaveProperty("artifact_id");
    expect(properties).toHaveProperty("title");
    expect(properties).not.toHaveProperty("description");
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
  it("advertises AuthKit OAuth scopes (not the capability vocabulary) in protected resource metadata", () => {
    expect(
      mcpProtectedResourceMetadata({
        authorizationServers: ["https://auth.example.test"],
      }),
    ).toEqual({
      resource: "https://mcp.agent-paste.sh/",
      resource_name: "Agent Paste MCP",
      authorization_servers: ["https://auth.example.test"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
    });
  });

  it("builds OAuth discovery URLs without regex backtracking on slash-heavy resources", () => {
    expect(trimTrailingSlashes("https://mcp.example.test////")).toBe("https://mcp.example.test");
    expect(trimTrailingSlashes("////")).toBe("");
    expect(mcpWwwAuthenticateHeader(`${"https://mcp.example.test"}${"/".repeat(4096)}`)).toContain(
      'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
    );
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

  it("maps delegated MCP scopes to API route scopes", () => {
    expect(mcpScopesToApiScopes(["write", "read", "share"])).toEqual(["publish", "read", "admin"]);
    expect(mcpScopesToApiScopes(["read"])).toEqual(["read"]);
  });

  it("maps member API scopes to delegated MCP scopes", () => {
    expect(apiScopesToMcpScopes(["publish", "read", "admin"])).toEqual(["write", "read", "share"]);
    expect(apiScopesToMcpScopes(["read"])).toEqual(["read"]);
  });

  it("derives the optional publish share-link idempotency key from the tool key", () => {
    const toolKey = IdempotencyKey.parse("mcp:user_01:42:publish_artifact");
    expect(mcpPublishAccessLinkIdempotencyKey(toolKey)).toBe("mcp:user_01:42:publish_artifact:share-link");
  });

  it("derives valid share-link keys for max-length publish tool idempotency keys", () => {
    const maxToolKey = IdempotencyKey.parse("a".repeat(200));
    const shareKey = mcpPublishAccessLinkIdempotencyKey(maxToolKey);

    expect(shareKey.length).toBeLessThanOrEqual(200);
    expect(IdempotencyKey.safeParse(shareKey).success).toBe(true);
    expect(shareKey).toMatch(/:share-link$/);
  });

  it("keeps hashed and direct share-link idempotency keyspaces disjoint", () => {
    const targetHash = "d4d70a05";
    const longToolKey = IdempotencyKey.parse(`${"x".repeat(190)}${"0".repeat(10)}`);
    const shortToolKey = IdempotencyKey.parse(`h${targetHash}`);
    expect(`${longToolKey}:share-link`.length).toBeGreaterThan(200);

    const shortShareKey = mcpPublishAccessLinkIdempotencyKey(shortToolKey);
    const longShareKey = mcpPublishAccessLinkIdempotencyKey(longToolKey);

    expect(shortShareKey).not.toBe(longShareKey);
    expect(shortShareKey).toMatch(/^h[0-9a-f]{8}:share-link$/);
    expect(shortShareKey).not.toBe(`h${targetHash}:share-link`);
    expect(longShareKey).toBe(`h${targetHash}:share-link`);
  });

  it("accepts max-length idempotency_key on publish and add_revision inputs", () => {
    const maxKey = "a".repeat(200);
    expect(
      McpPublishArtifactInput.safeParse({
        title: "Demo",
        body: "hello",
        render_mode: "text",
        idempotency_key: maxKey,
      }).success,
    ).toBe(true);
    expect(
      McpPublishArtifactInput.safeParse({
        title: "Demo",
        body: "hello",
        render_mode: "text",
        idempotency_key: maxKey,
        share: true,
      }).success,
    ).toBe(true);
    expect(
      McpAddRevisionInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        body: "hello",
        render_mode: "text",
        idempotency_key: maxKey,
        share: true,
      }).success,
    ).toBe(true);
  });

  it("derives idempotency keys from token sub, json rpc id, and tool name", () => {
    const key = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 42,
      toolName: "publish_artifact",
    });
    expect(key).toBe("mcp:user_01:42:publish_artifact");
    expect(IdempotencyKey.safeParse(key).success).toBe(true);
  });

  it("sanitizes json rpc ids with spaces and slashes into valid idempotency keys", () => {
    const withSpaces = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: "task 1",
      toolName: "publish_artifact",
    });
    expect(withSpaces).toBe("mcp:user_01:task_1:publish_artifact");
    expect(IdempotencyKey.safeParse(withSpaces).success).toBe(true);

    const withSlashes = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: "req/phase-2",
      toolName: "add_revision",
    });
    expect(withSlashes).toBe("mcp:user_01:req_phase-2:add_revision");
    expect(IdempotencyKey.safeParse(withSlashes).success).toBe(true);
  });

  it("hashes long or unsafe json rpc ids to a bounded stable segment", () => {
    const longId = "x".repeat(500);
    const first = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: longId,
      toolName: "publish_artifact",
    });
    const second = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: longId,
      toolName: "publish_artifact",
    });
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(200);
    expect(IdempotencyKey.safeParse(first).success).toBe(true);
    expect(mcpIdempotencySegment(longId)).toMatch(/^h[0-9a-f]{8}$/);
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
    const envelope = toMcpJsonRpcError(mapMcpProtocolError("insufficient_scope", "Actor lacks share scope"));
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
