import {
  AgentView,
  DeleteArtifactResponse,
  DisplayMetadata,
  type McpAddRevisionInput,
  type McpDeleteArtifactInput,
  type McpListArtifactsInput,
  McpListArtifactsOutput,
  type McpListRevisionsInput,
  McpListRevisionsOutput,
  type McpMultiEditInput,
  type McpPublishArtifactInput,
  type McpReadArtifactInput,
  type McpReadFileInput,
  McpReadFileOutput,
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
  if (requiredScopes.length > 0 && requiresEdgeScopePreflight(contract.forwardedCalls)) {
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
    default:
      return {
        ok: false,
        error: mapMcpProtocolError("method_not_found", "tools/call is not implemented yet"),
      };
  }
}

function requiresEdgeScopePreflight(forwardedCalls: readonly { auth: string }[]): boolean {
  return forwardedCalls.filter((call) => call.auth === "mcp_bearer").length > 1;
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

function parseForwardResult<T>(
  forwarded: ForwardToApiResult,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  label: string,
): McpToolResult {
  if (!forwarded.ok) {
    return forwarded;
  }
  return parseResult(forwarded.body, schema, label);
}

function parseResult<T>(
  body: unknown,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  label: string,
): McpToolResult {
  const parsed = parseBody(body, schema, label);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, result: parsed.data };
}

function parseBody<T>(
  body: unknown,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error?: unknown } },
  label: string,
): { ok: true; data: T } | Extract<McpToolResult, { ok: false }> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A forwarded API response or locally assembled payload failed our contract.
    // This is schema drift, not a client error. Log only issue codes and paths,
    // never the raw value; it can carry artifact content or PII.
    console.error("mcp: response schema validation failed", {
      label,
      issues: zodIssueMetadata(parsed.error),
    });
    return { ok: false, error: mapMcpProtocolError("internal_error", "internal_error") };
  }
  return { ok: true, data: parsed.data };
}
