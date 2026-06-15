import { describe, expect, it } from "vitest";
import { UpdateDisplayMetadataRequest } from "./accessLinks.js";
import {
  buildMcpToolList,
  deriveMcpIdempotencyKey,
  MCP_API_ERROR_HTTP_STATUS,
  McpAddRevisionInput,
  McpMultiEditInput,
  McpPublishArtifactInput,
  McpSetVisibilityInput,
  McpToolName,
  McpUpdateDisplayMetadataInput,
  mapApiErrorToMcp,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
  mcpIdempotencySegment,
  mcpProtectedResourceMetadata,
  mcpPublishAccessLinkIdempotencyKey,
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
  it("registers the ADR 0061 tools in snake_case", () => {
    expect(mcpToolContracts.map((tool) => tool.name)).toEqual([
      "publish_artifact",
      "add_revision",
      "multi_edit",
      "list_artifacts",
      "read_artifact",
      "read_file",
      "list_revisions",
      "delete_artifact",
      "update_display_metadata",
      "set_visibility",
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

  it("exposes no share input on publish tools (content-only, private)", () => {
    const listed = buildMcpToolList();
    for (const name of ["publish_artifact", "add_revision"] as const) {
      const tool = listed.tools.find((entry) => entry.name === name);
      const properties = (tool?.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(properties).not.toHaveProperty("share");
    }
    expect(
      McpPublishArtifactInput.safeParse({ title: "Demo", body: "hello", render_mode: "text", share: true }).success,
    ).toBe(false);
    expect(
      McpAddRevisionInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        body: "hello",
        render_mode: "text",
        share: true,
      }).success,
    ).toBe(false);
  });

  it("advertises only shipped set_visibility values", () => {
    const listed = buildMcpToolList();
    const tool = listed.tools.find((entry) => entry.name === "set_visibility");
    const serializedSchema = JSON.stringify(tool?.inputSchema ?? {});

    expect(serializedSchema).toContain('"private"');
    expect(serializedSchema).toContain('"unlisted"');
    expect(serializedSchema).not.toContain('"public"');
    expect(
      McpSetVisibilityInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        visibility: "private",
      }).success,
    ).toBe(true);
    expect(
      McpSetVisibilityInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        visibility: "public",
      }).success,
    ).toBe(false);
  });

  it("requires publish and read for publish tools", () => {
    expect(mcpToolContractByName("publish_artifact").requiredScopes).toEqual(["publish", "read"]);
    expect(mcpToolContractByName("add_revision").requiredScopes).toEqual(["publish", "read"]);
  });

  it("advertises Access Link failures on publish tools", () => {
    for (const toolName of ["publish_artifact", "add_revision"] as const) {
      const tool = mcpToolContractByName(toolName);
      expect(tool.errors).toContain("forbidden");
      expect(tool.errors).toContain("not_found");
    }
  });

  it("threads both publish tools through the same upload->publish chain, with no Share Link routes", () => {
    const expected = [
      "uploadSessions.create",
      "uploadSessions.putFile",
      "uploadSessions.finalize",
      "revisions.publish",
    ];
    const publish = mcpToolContractByName("publish_artifact");
    const addRevision = mcpToolContractByName("add_revision");
    expect(publish.forwardedCalls.map((call) => call.routeId)).toEqual(expected);
    // add_revision runs the SAME content-only chain — publish never touches access links.
    expect(addRevision.forwardedCalls.map((call) => call.routeId)).toEqual(expected);
    const allCalls = [...publish.forwardedCalls, ...addRevision.forwardedCalls];
    expect(allCalls.some((call) => call.routeId.startsWith("accessLinks."))).toBe(false);
    expect(allCalls.every((call) => call.auth === "mcp_bearer" || call.auth === "signed_upload_url")).toBe(true);
  });

  it("does not forward to any access-link route from the publish tools (publish is content-only)", () => {
    for (const toolName of ["publish_artifact", "add_revision"] as const) {
      const tool = mcpToolContractByName(toolName);
      const accessLinkCalls = tool.forwardedCalls.filter((call) => call.routeId.startsWith("accessLinks."));
      expect(accessLinkCalls).toHaveLength(0);
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

  it("requires publish and read for multi_edit and reads the base before the publish chain", () => {
    const tool = mcpToolContractByName("multi_edit");
    expect(tool.requiredScopes).toEqual(["publish", "read"]);
    expect(tool.forwardedCalls.map((call) => call.routeId)).toEqual([
      "agentView.getLatest",
      "artifacts.fileContent",
      "uploadSessions.create",
      "uploadSessions.putFile",
      "uploadSessions.finalize",
      "revisions.publish",
    ]);
    // Decrypts a blob to apply the edits, so it can surface a transient blob-read failure.
    expect(tool.errors).toContain("storage_unavailable");
  });

  it("validates multi_edit input: a non-empty edit array with literal old/new, rejecting empty old_string", () => {
    const artifact_id = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    expect(
      McpMultiEditInput.safeParse({
        artifact_id,
        path: "index.html",
        edits: [{ old_string: "foo", new_string: "bar" }],
      }).success,
    ).toBe(true);
    expect(McpMultiEditInput.safeParse({ artifact_id, path: "index.html", edits: [] }).success).toBe(false);
    expect(
      McpMultiEditInput.safeParse({
        artifact_id,
        path: "index.html",
        edits: [{ old_string: "", new_string: "bar" }],
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
    expect(mcpTokenHasRequiredScopes(["read", "publish", "admin"], ["read"])).toBe(true);
    expect(mcpTokenHasRequiredScopes(["read"], ["publish"])).toBe(false);
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
      McpAddRevisionInput.safeParse({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        body: "hello",
        render_mode: "text",
        idempotency_key: maxKey,
      }).success,
    ).toBe(true);
  });

  it("derives idempotency keys from token sub, json rpc id, tool name, and args", () => {
    const key = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 42,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", body: "hello", render_mode: "text" },
    });
    expect(key).toMatch(/^mcp:user_01:42:publish_artifact:h[0-9a-f]{8}$/);
    expect(IdempotencyKey.safeParse(key).success).toBe(true);
  });

  it("derives identical keys for deterministic retries regardless of arg key order", () => {
    const first = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", body: "hello", render_mode: "text" },
    });
    const retry = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { render_mode: "text", body: "hello", title: "Demo" },
    });
    expect(retry).toBe(first);
  });

  it("canonicalizes nested object keys when deriving", () => {
    const first = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", files: [{ path: "index.html", content: "<p>hi</p>" }] },
    });
    const retry = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { files: [{ content: "<p>hi</p>", path: "index.html" }], title: "Demo" },
    });
    const different = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { files: [{ content: "<p>bye</p>", path: "index.html" }], title: "Demo" },
    });
    expect(retry).toBe(first);
    expect(different).not.toBe(first);
  });

  it("derives different keys for different args under the same json rpc id", () => {
    const yesterday = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", body: "yesterday", render_mode: "text" },
    });
    const today = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 1,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", body: "today", render_mode: "text" },
    });
    expect(today).not.toBe(yesterday);
  });

  it("treats missing args and empty args identically", () => {
    const missing = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 2,
      toolName: "list_artifacts",
      toolArgs: undefined,
    });
    const empty = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: 2,
      toolName: "list_artifacts",
      toolArgs: {},
    });
    expect(missing).toBe(empty);
    expect(IdempotencyKey.safeParse(missing).success).toBe(true);
  });

  it("sanitizes json rpc ids with spaces and slashes into valid idempotency keys", () => {
    const withSpaces = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: "task 1",
      toolName: "publish_artifact",
      toolArgs: {},
    });
    expect(withSpaces).toMatch(/^mcp:user_01:task_1:publish_artifact:h[0-9a-f]{8}$/);
    expect(IdempotencyKey.safeParse(withSpaces).success).toBe(true);

    const withSlashes = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: "req/phase-2",
      toolName: "add_revision",
      toolArgs: {},
    });
    expect(withSlashes).toMatch(/^mcp:user_01:req_phase-2:add_revision:h[0-9a-f]{8}$/);
    expect(IdempotencyKey.safeParse(withSlashes).success).toBe(true);
  });

  it("hashes long or unsafe json rpc ids to a bounded stable segment", () => {
    const longId = "x".repeat(500);
    const first = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: longId,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", body: "hello", render_mode: "text" },
    });
    const second = deriveMcpIdempotencyKey({
      tokenSub: "user_01",
      jsonRpcId: longId,
      toolName: "publish_artifact",
      toolArgs: { title: "Demo", body: "hello", render_mode: "text" },
    });
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(200);
    expect(IdempotencyKey.safeParse(first).success).toBe(true);
    expect(mcpIdempotencySegment(longId)).toMatch(/^h[0-9a-f]{8}$/);
  });

  it("stays within the idempotency key bounds at max-length segments", () => {
    const key = deriveMcpIdempotencyKey({
      tokenSub: "s".repeat(64),
      jsonRpcId: "r".repeat(64),
      toolName: "update_display_metadata",
      toolArgs: { artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", title: "x".repeat(5000) },
    });
    expect(key.length).toBeLessThanOrEqual(200);
    expect(IdempotencyKey.safeParse(key).success).toBe(true);
    expect(IdempotencyKey.safeParse(mcpPublishAccessLinkIdempotencyKey(key)).success).toBe(true);
  });

  it("parameterizes the WWW-Authenticate error while defaulting to invalid_token", () => {
    expect(mcpWwwAuthenticateHeader("https://mcp.example.test")).toContain('error="invalid_token"');
    expect(mcpWwwAuthenticateHeader("https://mcp.example.test", "insufficient_scope")).toContain(
      'error="insufficient_scope"',
    );
    expect(mcpWwwAuthenticateHeader("https://mcp.example.test", "insufficient_scope")).toContain(
      'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
    );
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

  it("maps a patch_conflict to 422, not the 500 fallback", () => {
    const mapped = mapApiErrorToMcp({
      code: "patch_conflict",
      message: "patch_conflict: app.js: result_hash_mismatch",
      requestId: "req_patch",
    });
    expect(mapped).toMatchObject({ code: "patch_conflict", httpStatus: 422 });
    // The actionable detail (path + reason) rides the message through to the agent.
    expect(mapped.message).toContain("app.js");
  });

  it("has an HTTP status for every error a forwarded MCP tool can surface", () => {
    // A missing entry silently falls back to 500, masking a real client-actionable
    // error (the list_artifacts null-revision class of bug). Guard the whole surface.
    const reachable = new Set<keyof typeof MCP_API_ERROR_HTTP_STATUS>();
    for (const tool of mcpToolContracts) {
      for (const call of tool.forwardedCalls) {
        for (const code of routeContractById(call.routeId).errors) {
          reachable.add(code);
        }
      }
    }
    for (const code of reachable) {
      expect(MCP_API_ERROR_HTTP_STATUS[code], `missing MCP HTTP status for ${code}`).toBeDefined();
    }
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

  it("declares patch_conflict on every tool that forwards a finalize call", () => {
    // finalize can surface patch_conflict (ADR 0089); a tool that forwards it must
    // declare it, or an agent sees an error its contract never advertised (it slipped
    // out of publishChain once). Scoped to patch_conflict + the finalize route rather
    // than a full superset assertion, which would relitigate the deliberate exclusion
    // of signed-PUT and auth codes from tool error groups.
    for (const tool of mcpToolContracts) {
      const forwardsFinalize = tool.forwardedCalls.some((call) => call.routeId === "uploadSessions.finalize");
      if (forwardsFinalize) {
        expect(tool.errors, `${tool.name} forwards finalize but omits patch_conflict`).toContain("patch_conflict");
      }
    }
  });
});

describe("MCP tool name enum", () => {
  it("covers every registry entry", () => {
    for (const tool of mcpToolContracts) {
      expect(McpToolName.safeParse(tool.name).success).toBe(true);
    }
  });
});
