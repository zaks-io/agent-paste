import {
  AccessLinkSignedUrl,
  AgentView,
  DeleteArtifactResponse,
  DisplayMetadata,
  type IdempotencyKey,
  type McpAddRevisionInput,
  type McpCreateRevisionLinkInput,
  type McpDeleteArtifactInput,
  type McpListAccessLinksInput,
  McpListAccessLinksOutput,
  type McpListArtifactsInput,
  McpListArtifactsOutput,
  type McpListRevisionsInput,
  McpListRevisionsOutput,
  type McpMakePublicInput,
  type McpMultiEditInput,
  type McpPublishArtifactInput,
  type McpReadArtifactInput,
  type McpReadFileInput,
  McpReadFileOutput,
  type McpRevokeAccessLinkInput,
  McpRevokeAccessLinkOutput,
  type McpScope,
  McpToolCallParams,
  type McpUpdateDisplayMetadataInput,
  McpWhoamiResponse,
  mapMcpProtocolError,
  mcpTokenHasRequiredScopes,
  mcpToolContractByName,
  mcpToolInputSchemas,
} from "@agent-paste/contracts";
import type { McpAuthContext } from "./auth.js";
import { type ForwardToApiResult, forwardToApiRoute } from "./forward.js";
import { publishViaSharedModule, resolveIdempotencyKey, textPublishInput } from "./publish-helpers.js";
import { callAddRevision, callMultiEdit } from "./revise-tools.js";
import type { McpToolDeps, McpToolResult } from "./tool-deps.js";
import { zodIssueMetadata } from "./zod-issue-metadata.js";

export type { McpToolDeps, McpToolResult } from "./tool-deps.js";

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

  const requiredScopes = contract.requiredScopes;
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
    case "multi_edit":
      return callMultiEdit(inputParsed.data as McpMultiEditInput, auth, deps);
    case "list_artifacts":
      return callListArtifacts(inputParsed.data as McpListArtifactsInput, deps);
    case "read_artifact":
      return callReadArtifact(inputParsed.data as McpReadArtifactInput, deps);
    case "read_file":
      return callReadFile(inputParsed.data as McpReadFileInput, deps);
    case "list_revisions":
      return callListRevisions(inputParsed.data as McpListRevisionsInput, deps);
    case "delete_artifact":
      return callDeleteArtifact(inputParsed.data as McpDeleteArtifactInput, deps);
    case "update_display_metadata":
      return callUpdateDisplayMetadata(inputParsed.data as McpUpdateDisplayMetadataInput, deps);
    case "make_public":
      return callMakePublic(inputParsed.data as McpMakePublicInput, auth, deps);
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

async function callWhoami(deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "mcp.whoami",
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpWhoamiResponse, "mcp.whoami");
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

async function callListArtifacts(input: McpListArtifactsInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "artifacts.list",
    query: { cursor: input.cursor },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpListArtifactsOutput, "artifacts.list");
}

async function callReadArtifact(input: McpReadArtifactInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "agentView.getLatest",
    params: { artifact_id: input.artifact_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, AgentView, "agentView.getLatest");
}

async function callReadFile(input: McpReadFileInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "artifacts.fileContent",
    params: { artifact_id: input.artifact_id },
    query: { path: input.path, revision_id: input.revision_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpReadFileOutput, "artifacts.fileContent");
}

async function callListRevisions(input: McpListRevisionsInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "revisions.list",
    params: { artifact_id: input.artifact_id },
    query: { cursor: input.cursor },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpListRevisionsOutput, "revisions.list");
}

async function callDeleteArtifact(input: McpDeleteArtifactInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "artifacts.delete",
    params: { artifact_id: input.artifact_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, DeleteArtifactResponse, "artifacts.delete");
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
  return parseForwardResult(forwarded, DisplayMetadata, "artifacts.updateDisplayMetadata");
}

async function createAndMintAccessLink(
  input: {
    toolName: "make_public" | "create_revision_link";
    toolArgs: Record<string, unknown>;
    artifactId: string;
    createBody: { type: "share" } | { type: "revision"; revision_id: string };
  },
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  const idempotencyKey = resolveIdempotencyKey(input.toolName, input.toolArgs, auth, deps);
  const first = await createThenMint(input, idempotencyKey, deps);
  if (first.ok || input.createBody.type !== "share") {
    // Only share links get the salted retry. A reused idempotency key can replay a
    // create whose link was revoked since (make_public, revoke_access_link,
    // make_public again with the same key), leaving mint pointed at a dead link.
    // Retrying on a salted key re-runs the create, which reuses the artifact's one
    // active share link or mints a new one — idempotent, no duplicate. Revision
    // links do NOT dedupe on create, so a blind retry there would insert a second
    // link for the same revision; they return the original failure instead.
    return first;
  }
  return createThenMint(input, `${idempotencyKey}:r` as IdempotencyKey, deps);
}

async function createThenMint(
  input: { artifactId: string; createBody: { type: "share" } | { type: "revision"; revision_id: string } },
  idempotencyKey: IdempotencyKey,
  deps: McpToolDeps,
): Promise<McpToolResult> {
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
  return parseForwardResult(minted, AccessLinkSignedUrl, "accessLinks.mint");
}

async function callMakePublic(
  input: McpMakePublicInput,
  auth: McpAuthContext,
  deps: McpToolDeps,
): Promise<McpToolResult> {
  return createAndMintAccessLink(
    {
      toolName: "make_public",
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
  return parseForwardResult(forwarded, McpListAccessLinksOutput, "accessLinks.list");
}

async function callRevokeAccessLink(input: McpRevokeAccessLinkInput, deps: McpToolDeps): Promise<McpToolResult> {
  const forwarded = await forwardToApiRoute({
    api: deps.api,
    routeId: "accessLinks.revoke",
    params: { access_link_id: input.access_link_id },
    bearerToken: deps.bearerToken,
  });
  return parseForwardResult(forwarded, McpRevokeAccessLinkOutput, "accessLinks.revoke");
}

function parseForwardResult<T>(
  forwarded: ForwardToApiResult,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  label: string,
): McpToolResult {
  if (!forwarded.ok) {
    return forwarded;
  }
  const parsed = schema.safeParse(forwarded.body);
  if (!parsed.success) {
    // The upstream API returned 200 but the body failed our contract. This is a
    // deploy-skew / schema-drift bug, not a client error. Log loudly: a silent
    // internal_error here is undebuggable in production. Log only issue codes and
    // paths, never the raw error — the failing value can carry artifact content/PII.
    console.error("mcp: response schema validation failed", {
      label,
      issues: zodIssueMetadata(parsed.error),
    });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, result: parsed.data };
}
