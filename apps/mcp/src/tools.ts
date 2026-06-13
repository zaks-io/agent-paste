import { type PublishFile, type PublishInput, type PublishOutcome, runPublish } from "@agent-paste/api-client/publish";
import {
  AccessLinkSignedUrl,
  AgentView,
  DeleteArtifactResponse,
  DisplayMetadata,
  deriveMcpIdempotencyKey,
  type IdempotencyKey,
  type McpAddRevisionInput,
  type McpCreateRevisionLinkInput,
  type McpCreateShareLinkInput,
  type McpDeleteArtifactInput,
  type McpListAccessLinksInput,
  McpListAccessLinksOutput,
  type McpListArtifactsInput,
  McpListArtifactsOutput,
  type McpListRevisionsInput,
  McpListRevisionsOutput,
  type McpPublishArtifactInput,
  McpPublishArtifactOutput,
  type McpPublishRenderMode,
  type McpReadArtifactInput,
  type McpRevokeAccessLinkInput,
  McpRevokeAccessLinkOutput,
  type McpScope,
  McpToolCallParams,
  type McpUpdateDisplayMetadataInput,
  McpWhoamiResponse,
  mapMcpProtocolError,
  mcpEntrypointForRenderMode,
  mcpTokenHasRequiredScopes,
  mcpToolContractByName,
  mcpToolInputSchemas,
} from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import {
  type ApiServiceBinding,
  type ForwardToApiResult,
  forwardToApiRoute,
  type UploadServiceBinding,
} from "./forward.js";
import { ForwardError, serviceBindingTransport } from "./publish-transport.js";

export type McpToolDeps = {
  api: ApiServiceBinding;
  upload: UploadServiceBinding;
  bearerToken: string;
  jsonRpcId: string | number;
};

export type McpToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ReturnType<typeof mapMcpProtocolError> };

export async function callMcpTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const parsed = McpToolCallParams.safeParse({ name: toolName, arguments: params });
  if (!parsed.success) {
    return { ok: false, error: mapMcpProtocolError("invalid_params", "invalid_params") };
  }

  const contract = mcpToolContractByName(parsed.data.name);
  const inputSchema = mcpToolInputSchemas[parsed.data.name];
  const inputParsed = inputSchema.safeParse(parsed.data.arguments ?? {});
  if (!inputParsed.success) {
    return { ok: false, error: mapMcpProtocolError("invalid_params", "invalid_params") };
  }

  const requiredScopes = requiredScopesForToolCall(parsed.data.name, contract.requiredScopes, inputParsed.data);
  if (requiredScopes.length > 0) {
    const granted = await resolveGrantedScopes(deps);
    if (!granted.ok) {
      return granted;
    }
    if (!mcpTokenHasRequiredScopes(granted.scopes, requiredScopes)) {
      return { ok: false, error: mapMcpProtocolError("insufficient_scope", "insufficient_scope") };
    }
  }

  switch (parsed.data.name) {
    case "whoami":
      return callWhoami(deps);
    case "publish_artifact":
      return callPublishArtifact(inputParsed.data as McpPublishArtifactInput, auth, deps);
    case "add_revision":
      return callAddRevision(inputParsed.data as McpAddRevisionInput, auth, deps);
    case "list_artifacts":
      return callListArtifacts(inputParsed.data as McpListArtifactsInput, deps);
    case "read_artifact":
      return callReadArtifact(inputParsed.data as McpReadArtifactInput, deps);
    case "list_revisions":
      return callListRevisions(inputParsed.data as McpListRevisionsInput, deps);
    case "delete_artifact":
      return callDeleteArtifact(inputParsed.data as McpDeleteArtifactInput, deps);
    case "update_display_metadata":
      return callUpdateDisplayMetadata(inputParsed.data as McpUpdateDisplayMetadataInput, deps);
    case "create_share_link":
      return callCreateShareLink(inputParsed.data as McpCreateShareLinkInput, auth, deps);
    case "create_revision_link":
      return callCreateRevisionLink(inputParsed.data as McpCreateRevisionLinkInput, auth, deps);
    case "list_access_links":
      return callListAccessLinks(inputParsed.data as McpListAccessLinksInput, deps);
    case "revoke_access_link":
      return callRevokeAccessLink(inputParsed.data as McpRevokeAccessLinkInput, deps);
    default:
      return {
        ok: false,
        error: mapMcpProtocolError("method_not_found", "tools/call is not implemented yet"),
      };
  }
}

function requiredScopesForToolCall(
  toolName: string,
  baseScopes: readonly McpScope[],
  input: unknown,
): readonly McpScope[] {
  if ((toolName !== "publish_artifact" && toolName !== "add_revision") || !requestsShareLink(input)) {
    return baseScopes;
  }
  return Array.from(new Set<McpScope>([...baseScopes, "share"]));
}

function requestsShareLink(input: unknown): boolean {
  return typeof input === "object" && input !== null && "share" in input && input.share === true;
}

function resolveIdempotencyKey(
  toolName: Parameters<typeof deriveMcpIdempotencyKey>[0]["toolName"],
  toolArgs: Record<string, unknown>,
  auth: McpAuthContext,
  deps: McpToolDeps,
  explicit?: string,
): IdempotencyKey {
  if (explicit) {
    return explicit as IdempotencyKey;
  }
  return deriveMcpIdempotencyKey({
    tokenSub: auth.tokenSub,
    jsonRpcId: deps.jsonRpcId,
    toolName,
    toolArgs,
  });
}

async function callWhoami(deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "mcp.whoami",
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpWhoamiResponse);
}

type ResolvedScopes =
  | { ok: true; scopes: readonly McpScope[] }
  | { ok: false; error: ReturnType<typeof mapMcpProtocolError> };

/** Pre-flight scope source (ADR 0079): the member's granted scopes come from api, not the token. */
async function resolveGrantedScopes(deps: McpToolDeps): Promise<ResolvedScopes> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "mcp.whoami",
    bearerToken: deps.bearerToken,
  });
  if (!forwarded.ok) {
    return forwarded;
  }
  const parsed = McpWhoamiResponse.safeParse(forwarded.body);
  if (!parsed.success) {
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, scopes: parsed.data.scopes };
}

async function callPublishArtifact(
  input: McpPublishArtifactInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const idempotencyKey = resolveIdempotencyKey("publish_artifact", input, auth, deps, input.idempotency_key);
  return publishViaSharedModule(deps, await textPublishInput(input, idempotencyKey));
}

async function callAddRevision(
  input: McpAddRevisionInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const idempotencyKey = resolveIdempotencyKey("add_revision", input, auth, deps, input.idempotency_key);
  const base = await textPublishInput(input, idempotencyKey);
  return publishViaSharedModule(deps, { ...base, artifactId: input.artifact_id });
}

/** Run the shared publish module and shape the result into the MCP output, preserving mapped errors. */
async function publishViaSharedModule(deps: McpToolDeps, input: PublishInput): Promise<McpToolResult> {
  let outcome: PublishOutcome;
  try {
    outcome = await runPublish(serviceBindingTransport(deps), input);
  } catch (error) {
    if (error instanceof ForwardError) {
      return { ok: false, error: error.mapped };
    }
    // Any other throw (e.g. the shared module's "unknown file" guard) is an
    // internal fault: map it to a JSON-RPC internal_error so the client gets a
    // correlated envelope, never an uncaught HTTP 500.
    console.error("mcp: publish failed", { error });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  const parsed = McpPublishArtifactOutput.safeParse({
    title: outcome.title,
    viewer_url: outcome.viewerUrl,
    shared: outcome.shared,
    expires_at: outcome.expiresAt,
    upload_stats: {
      total_files: outcome.uploadStats.totalFiles,
      total_bytes: outcome.uploadStats.totalBytes,
      uploaded_files: outcome.uploadStats.uploadedFiles,
      uploaded_bytes: outcome.uploadStats.uploadedBytes,
      reused_files: outcome.uploadStats.reusedFiles,
      reused_bytes: outcome.uploadStats.reusedBytes,
    },
  });
  if (!parsed.success) {
    console.error("mcp: publish output schema validation failed", { error: parsed.error });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, result: parsed.data };
}

/** Build the single-file PublishInput from an MCP text-publish request. */
async function textPublishInput(
  input: { title?: string; body: string; render_mode: McpPublishRenderMode; share?: boolean },
  idempotencyKey: IdempotencyKey,
): Promise<PublishInput> {
  const entrypoint = mcpEntrypointForRenderMode(input.render_mode);
  const bytes = new TextEncoder().encode(input.body);
  const sha256 = await sha256Hex(bytes);
  const file: PublishFile = {
    path: entrypoint,
    sizeBytes: bytes.byteLength,
    sha256: sha256 as PublishFile["sha256"],
    contentType: contentTypeForEntrypoint(entrypoint),
    read: () => bytes,
  };
  return {
    files: [file],
    // add_revision has no title field, so it falls back to "Revision". The
    // create-session request title is required, and the server writes the
    // artifact title from it on publish, so this renames the artifact to
    // "Revision" on every add_revision. Pre-existing behavior, tracked for a
    // follow-up fix (make the session title optional so it preserves the
    // existing artifact title for revisions).
    title: ("title" in input && input.title ? input.title : "Revision") as PublishInput["title"],
    entrypoint,
    share: input.share === true,
    idempotencyKey,
  };
}

function contentTypeForEntrypoint(path: string): string {
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callListArtifacts(input: McpListArtifactsInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "artifacts.list",
    query: { cursor: input.cursor },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpListArtifactsOutput);
}

async function callReadArtifact(input: McpReadArtifactInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "agentView.getLatest",
    params: { artifact_id: input.artifact_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, AgentView);
}

async function callListRevisions(input: McpListRevisionsInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "revisions.list",
    params: { artifact_id: input.artifact_id },
    query: { cursor: input.cursor },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpListRevisionsOutput);
}

async function callDeleteArtifact(input: McpDeleteArtifactInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "artifacts.delete",
    params: { artifact_id: input.artifact_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, DeleteArtifactResponse);
}

async function callUpdateDisplayMetadata(
  input: McpUpdateDisplayMetadataInput,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "artifacts.updateDisplayMetadata",
    params: { artifact_id: input.artifact_id },
    bearerToken: deps.bearerToken,
    body: JSON.stringify({ title: input.title }),
  });
  return parseForwardResult(forwarded, DisplayMetadata);
}

async function createAndMintAccessLink(
  input: {
    toolName: "create_share_link" | "create_revision_link";
    toolArgs: Record<string, unknown>;
    artifactId: string;
    createBody: { type: "share" } | { type: "revision"; revision_id: string };
  },
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const idempotencyKey = resolveIdempotencyKey(input.toolName, input.toolArgs, auth, deps);
  const created = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.create",
    params: { artifact_id: input.artifactId },
    bearerToken: deps.bearerToken,
    idempotencyKey,
    body: JSON.stringify(input.createBody),
  });
  if (!created.ok) {
    return created;
  }
  const linkId =
    created.body && typeof created.body === "object" && "id" in created.body && typeof created.body.id === "string"
      ? created.body.id
      : null;
  if (!linkId) {
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  const minted = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.mint",
    params: { access_link_id: linkId },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(minted, AccessLinkSignedUrl);
}

async function callCreateShareLink(
  input: McpCreateShareLinkInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  return createAndMintAccessLink(
    {
      toolName: "create_share_link",
      toolArgs: input,
      artifactId: input.artifact_id,
      createBody: { type: "share" },
    },
    auth,
    deps,
  );
}

async function callCreateRevisionLink(
  input: McpCreateRevisionLinkInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  return createAndMintAccessLink(
    {
      toolName: "create_revision_link",
      toolArgs: input,
      artifactId: input.artifact_id,
      createBody: { type: "revision", revision_id: input.revision_id },
    },
    auth,
    deps,
  );
}

async function callListAccessLinks(input: McpListAccessLinksInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.list",
    params: { artifact_id: input.artifact_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpListAccessLinksOutput);
}

async function callRevokeAccessLink(input: McpRevokeAccessLinkInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.revoke",
    params: { access_link_id: input.access_link_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpRevokeAccessLinkOutput);
}

function parseForwardResult<T>(
  forwarded: ForwardToApiResult,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): McpToolResult {
  if (!forwarded.ok) {
    return forwarded;
  }
  const parsed = schema.safeParse(forwarded.body);
  if (!parsed.success) {
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, result: parsed.data };
}
