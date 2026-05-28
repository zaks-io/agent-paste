import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { AccessLinkSignedUrl, AccessLinkType } from "./accessLinks.js";
import { AgentView, DisplayMetadata } from "./agentView.js";
import { ArtifactListResponse, DeleteArtifactResponse } from "./artifacts.js";
import { type ErrorCode, ErrorCode as ErrorCodeSchema, Mebibytes, PaginationRequest } from "./common.js";
import type { Scope } from "./enums.js";
import {
  AccessLinkId,
  ArtifactId,
  Cursor,
  type FilePath,
  IdempotencyKey,
  PlainTextTitle,
  RevisionId,
  UrlString,
} from "./primitives.js";
import { RevisionListResponse } from "./revisions.js";
import {
  type AppSurface,
  type HttpMethod,
  type IdempotencyRequirement,
  type RouteId,
  routeContractById,
} from "./routes.js";
import { PublishResult } from "./uploadSessions.js";
import { WorkspaceMemberId } from "./web.js";
import { WorkspaceSummary } from "./workspace.js";
import { z } from "./zod.js";

/** OAuth resource indicator for MCP-issued tokens (ADR 0061). */
export const MCP_RESOURCE_INDICATOR = "https://mcp.agent-paste.sh" as const;

/** Delegated OAuth scopes exposed in MCP consent; Member-Only Scopes are excluded. */
export const MCP_DELEGATED_SCOPES = ["write", "read", "share"] as const;

/** Member-Only Scopes that MCP tokens must never carry (ADR 0034, ADR 0061). */
export const MCP_EXCLUDED_MEMBER_ONLY_SCOPES = ["manage_keys", "manage_workspace", "read_audit"] as const;

export const McpScope = z.enum(MCP_DELEGATED_SCOPES);
export type McpScope = z.infer<typeof McpScope>;

/** MCP accepts OAuth bearer tokens only; API keys and dashboard sessions are rejected. */
export type McpAuthRequirement = "mcp_oauth";

export const MCP_REJECTED_AUTH_REQUIREMENTS = ["api_key", "workos_access_token"] as const;

export const McpProtectedResourceMetadata = z
  .object({
    resource: UrlString,
    authorization_servers: z.array(UrlString),
    bearer_methods_supported: z.tuple([z.literal("header")]),
    scopes_supported: z.array(McpScope).length(MCP_DELEGATED_SCOPES.length),
  })
  .strict();
export type McpProtectedResourceMetadata = z.infer<typeof McpProtectedResourceMetadata>;

export const McpPublishRenderMode = z.enum(["text", "markdown", "html"]);
export type McpPublishRenderMode = z.infer<typeof McpPublishRenderMode>;

const mcpTextBody = z.string().min(1).max(Mebibytes.ten);

export const McpPublishArtifactInput = z
  .object({
    title: PlainTextTitle,
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    share: z.boolean().optional(),
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpPublishArtifactInput = z.infer<typeof McpPublishArtifactInput>;

export const McpAddRevisionInput = z
  .object({
    artifact_id: ArtifactId,
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    share: z.boolean().optional(),
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpAddRevisionInput = z.infer<typeof McpAddRevisionInput>;

export const McpListArtifactsInput = PaginationRequest.pick({ cursor: true }).strict();
export type McpListArtifactsInput = z.infer<typeof McpListArtifactsInput>;

export const McpReadArtifactInput = z.object({ artifact_id: ArtifactId }).strict();
export type McpReadArtifactInput = z.infer<typeof McpReadArtifactInput>;

export const McpListRevisionsInput = z
  .object({
    artifact_id: ArtifactId,
    cursor: Cursor.optional(),
  })
  .strict();
export type McpListRevisionsInput = z.infer<typeof McpListRevisionsInput>;

export const McpDeleteArtifactInput = z.object({ artifact_id: ArtifactId }).strict();
export type McpDeleteArtifactInput = z.infer<typeof McpDeleteArtifactInput>;

export const McpUpdateDisplayMetadataInput = z
  .object({
    artifact_id: ArtifactId,
    title: PlainTextTitle,
  })
  .strict();
export type McpUpdateDisplayMetadataInput = z.infer<typeof McpUpdateDisplayMetadataInput>;

export const McpCreateShareLinkInput = z.object({ artifact_id: ArtifactId }).strict();
export type McpCreateShareLinkInput = z.infer<typeof McpCreateShareLinkInput>;

export const McpCreateRevisionLinkInput = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
  })
  .strict();
export type McpCreateRevisionLinkInput = z.infer<typeof McpCreateRevisionLinkInput>;

export const McpListAccessLinksInput = z.object({ artifact_id: ArtifactId }).strict();
export type McpListAccessLinksInput = z.infer<typeof McpListAccessLinksInput>;

export const McpRevokeAccessLinkInput = z.object({ access_link_id: AccessLinkId }).strict();
export type McpRevokeAccessLinkInput = z.infer<typeof McpRevokeAccessLinkInput>;

export const McpWhoamiInput = z.object({}).strict();
export type McpWhoamiInput = z.infer<typeof McpWhoamiInput>;

export const McpPublishArtifactOutput = PublishResult.extend({
  revision_link_id: AccessLinkId,
  revision_link_url: UrlString,
  share_link_url: UrlString.optional(),
}).strict();
export type McpPublishArtifactOutput = z.infer<typeof McpPublishArtifactOutput>;

/** Suffix for publish-chain revision-link idempotency records (distinct from share-link). */
export const MCP_PUBLISH_REVISION_LINK_IDEMPOTENCY_SUFFIX = ":revision-link" as const;

/** Suffix for publish-chain share-link idempotency records (distinct from revision-link). */
export const MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX = ":share-link" as const;

/** Derives an access-link create idempotency key from the publish tool key (ADR 0061, AP-84 seam). */
export function mcpPublishAccessLinkIdempotencyKey(
  toolIdempotencyKey: IdempotencyKey,
  kind: "revision" | "share",
): IdempotencyKey {
  const suffix =
    kind === "revision" ? MCP_PUBLISH_REVISION_LINK_IDEMPOTENCY_SUFFIX : MCP_PUBLISH_SHARE_LINK_IDEMPOTENCY_SUFFIX;
  return IdempotencyKey.parse(`${toolIdempotencyKey}${suffix}`);
}

export const McpListArtifactsOutput = ArtifactListResponse;
export type McpListArtifactsOutput = z.infer<typeof McpListArtifactsOutput>;

export const McpReadArtifactOutput = AgentView;
export type McpReadArtifactOutput = z.infer<typeof McpReadArtifactOutput>;

export const McpListRevisionsOutput = RevisionListResponse;
export type McpListRevisionsOutput = z.infer<typeof McpListRevisionsOutput>;

export const McpDeleteArtifactOutput = DeleteArtifactResponse;
export type McpDeleteArtifactOutput = z.infer<typeof McpDeleteArtifactOutput>;

export const McpUpdateDisplayMetadataOutput = DisplayMetadata;
export type McpUpdateDisplayMetadataOutput = z.infer<typeof McpUpdateDisplayMetadataOutput>;

export const McpCreateShareLinkOutput = AccessLinkSignedUrl;
export type McpCreateShareLinkOutput = z.infer<typeof McpCreateShareLinkOutput>;

export const McpCreateRevisionLinkOutput = AccessLinkSignedUrl;
export type McpCreateRevisionLinkOutput = z.infer<typeof McpCreateRevisionLinkOutput>;

export const McpAccessLinkRow = z
  .object({
    id: AccessLinkId,
    type: AccessLinkType,
    artifact_id: ArtifactId,
    revision_id: RevisionId.nullable(),
    created_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }).nullable(),
    revoked_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type McpAccessLinkRow = z.infer<typeof McpAccessLinkRow>;

export const McpListAccessLinksOutput = z
  .object({
    artifact_id: ArtifactId,
    items: z.array(McpAccessLinkRow),
  })
  .strict();
export type McpListAccessLinksOutput = z.infer<typeof McpListAccessLinksOutput>;

export const McpRevokeAccessLinkOutput = z
  .object({
    access_link_id: AccessLinkId,
    revoked_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type McpRevokeAccessLinkOutput = z.infer<typeof McpRevokeAccessLinkOutput>;

export const McpWhoamiResponse = z
  .object({
    workspace_member: z.object({
      id: WorkspaceMemberId,
      email: z.string().email(),
    }),
    workspace: WorkspaceSummary,
    scopes: z.array(McpScope),
  })
  .strict();
export type McpWhoamiResponse = z.infer<typeof McpWhoamiResponse>;

export const McpToolName = z.enum([
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
export type McpToolName = z.infer<typeof McpToolName>;

export const mcpToolInputSchemas = {
  publish_artifact: McpPublishArtifactInput,
  add_revision: McpAddRevisionInput,
  list_artifacts: McpListArtifactsInput,
  read_artifact: McpReadArtifactInput,
  list_revisions: McpListRevisionsInput,
  delete_artifact: McpDeleteArtifactInput,
  update_display_metadata: McpUpdateDisplayMetadataInput,
  create_share_link: McpCreateShareLinkInput,
  create_revision_link: McpCreateRevisionLinkInput,
  list_access_links: McpListAccessLinksInput,
  revoke_access_link: McpRevokeAccessLinkInput,
  whoami: McpWhoamiInput,
} as const satisfies Record<McpToolName, z.ZodTypeAny>;

export const mcpToolOutputSchemas = {
  publish_artifact: McpPublishArtifactOutput,
  add_revision: McpPublishArtifactOutput,
  list_artifacts: McpListArtifactsOutput,
  read_artifact: McpReadArtifactOutput,
  list_revisions: McpListRevisionsOutput,
  delete_artifact: McpDeleteArtifactOutput,
  update_display_metadata: McpUpdateDisplayMetadataOutput,
  create_share_link: McpCreateShareLinkOutput,
  create_revision_link: McpCreateRevisionLinkOutput,
  list_access_links: McpListAccessLinksOutput,
  revoke_access_link: McpRevokeAccessLinkOutput,
  whoami: McpWhoamiResponse,
} as const satisfies Record<McpToolName, z.ZodTypeAny>;

export type McpToolInputSchemaName = keyof typeof mcpToolInputSchemas;
export type McpToolOutputSchemaName = keyof typeof mcpToolOutputSchemas;

export const McpProtocolErrorCode = z.enum([
  "invalid_token",
  "insufficient_scope",
  "invalid_params",
  "internal_error",
  "method_not_found",
]);
export type McpProtocolErrorCode = z.infer<typeof McpProtocolErrorCode>;

export const McpToolErrorCode = z.enum([...ErrorCodeSchema.options, ...McpProtocolErrorCode.options]);
export type McpToolErrorCode = z.infer<typeof McpToolErrorCode>;

export type McpForwardedAuth = "mcp_bearer" | "signed_upload_url";

export type McpForwardedIdempotencyKey = "same_as_tool";

export type McpForwardedCall = {
  routeId: RouteId;
  auth: McpForwardedAuth;
  idempotencyKey?: McpForwardedIdempotencyKey;
  optional?: boolean;
};

export type McpResolvedForwardedCall = McpForwardedCall & {
  app: AppSurface;
  method: HttpMethod;
  path: string;
  idempotency: IdempotencyRequirement;
};

export type McpToolIdempotency = "none" | "derived" | "optional_override";

export type McpToolContract = {
  name: McpToolName;
  description: string;
  auth: McpAuthRequirement;
  requiredScopes: readonly McpScope[];
  idempotency: McpToolIdempotency;
  inputSchema: McpToolInputSchemaName;
  outputSchema: McpToolOutputSchemaName;
  forwardedCalls: readonly McpForwardedCall[];
  errors: readonly McpToolErrorCode[];
};

export const MCP_JSONRPC_VERSION = "2.0" as const;
export const MCP_JSONRPC_APPLICATION_ERROR = -32_000;
export const MCP_JSONRPC_INVALID_PARAMS = -32_602;
export const MCP_JSONRPC_METHOD_NOT_FOUND = -32_601;

export const McpJsonRpcId = z.union([z.string(), z.number(), z.null()]);
export type McpJsonRpcId = z.infer<typeof McpJsonRpcId>;

export const McpJsonRpcRequest = z
  .object({
    jsonrpc: z.literal(MCP_JSONRPC_VERSION),
    id: McpJsonRpcId.optional(),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type McpJsonRpcRequest = z.infer<typeof McpJsonRpcRequest>;

export const McpToolCallParams = z
  .object({
    name: McpToolName,
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type McpToolCallParams = z.infer<typeof McpToolCallParams>;

export const McpJsonRpcErrorData = z
  .object({
    code: McpToolErrorCode,
    message: z.string(),
    request_id: z.string().min(1).optional(),
    docs: z.string().url().optional(),
  })
  .strict();
export type McpJsonRpcErrorData = z.infer<typeof McpJsonRpcErrorData>;

export const McpJsonRpcError = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: McpJsonRpcErrorData.optional(),
  })
  .strict();
export type McpJsonRpcError = z.infer<typeof McpJsonRpcError>;

export type McpMappedToolError = {
  code: McpToolErrorCode;
  message: string;
  jsonRpcCode: number;
  httpStatus: number;
  requestId?: string;
  docs?: string;
};

const publishChainErrors = [
  "invalid_request",
  "artifact_not_found",
  "draft_revision_conflict",
  "entrypoint_not_in_revision",
  "file_count_cap_exceeded",
  "file_size_cap_exceeded",
  "idempotency_in_flight",
  "invalid_idempotency_key",
  "revision_retained",
  "revision_size_cap_exceeded",
  "revision_unpublished",
  "storage_unavailable",
  "unexpected_upload_object",
  "upload_incomplete",
  "upload_session_expired",
  "upload_session_not_found",
  "usage_policy_exceeded",
  "rate_limited_actor",
  "rate_limited_workspace",
  "database_unavailable",
] as const satisfies readonly McpToolErrorCode[];

const readErrors = [
  "forbidden",
  "not_found",
  "artifact_not_found",
  "revision_retained",
  "revision_unpublished",
  "invalid_cursor",
  "rate_limited_actor",
  "database_unavailable",
] as const satisfies readonly McpToolErrorCode[];

const shareLinkErrors = [
  "forbidden",
  "not_found",
  "artifact_not_found",
  "invalid_request",
  "rate_limited_actor",
  "database_unavailable",
] as const satisfies readonly McpToolErrorCode[];

export const mcpToolContracts = [
  {
    name: "publish_artifact",
    description:
      "Publish a new text-only artifact, mint the required Revision Link, and optionally mint a Share Link when share is true.",
    auth: "mcp_oauth",
    requiredScopes: ["write", "read", "share"],
    idempotency: "optional_override",
    inputSchema: "publish_artifact",
    outputSchema: "publish_artifact",
    forwardedCalls: [
      {
        routeId: "uploadSessions.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "uploadSessions.putFile",
        auth: "signed_upload_url",
      },
      {
        routeId: "uploadSessions.finalize",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "revisions.publish",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
      },
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
        optional: true,
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
        optional: true,
      },
    ],
    errors: publishChainErrors,
  },
  {
    name: "add_revision",
    description:
      "Add and publish a text-only revision, mint the required Revision Link, and optionally mint a Share Link when share is true.",
    auth: "mcp_oauth",
    requiredScopes: ["write", "read", "share"],
    idempotency: "optional_override",
    inputSchema: "add_revision",
    outputSchema: "add_revision",
    forwardedCalls: [
      {
        routeId: "uploadSessions.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "uploadSessions.putFile",
        auth: "signed_upload_url",
      },
      {
        routeId: "uploadSessions.finalize",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "revisions.publish",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
      },
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
        optional: true,
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
        optional: true,
      },
    ],
    errors: publishChainErrors,
  },
  {
    name: "list_artifacts",
    description: "List artifacts in the authenticated workspace.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "list_artifacts",
    outputSchema: "list_artifacts",
    forwardedCalls: [
      {
        routeId: "artifacts.list",
        auth: "mcp_bearer",
      },
    ],
    errors: readErrors,
  },
  {
    name: "read_artifact",
    description: "Read the latest Agent View for an artifact without inlining file bytes.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "read_artifact",
    outputSchema: "read_artifact",
    forwardedCalls: [
      {
        routeId: "agentView.getLatest",
        auth: "mcp_bearer",
      },
    ],
    errors: readErrors,
  },
  {
    name: "list_revisions",
    description: "List revisions for an artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["read"],
    idempotency: "none",
    inputSchema: "list_revisions",
    outputSchema: "list_revisions",
    forwardedCalls: [
      {
        routeId: "revisions.list",
        auth: "mcp_bearer",
      },
    ],
    errors: readErrors,
  },
  {
    name: "delete_artifact",
    description: "Delete an artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["write"],
    idempotency: "none",
    inputSchema: "delete_artifact",
    outputSchema: "delete_artifact",
    forwardedCalls: [
      {
        routeId: "artifacts.delete",
        auth: "mcp_bearer",
      },
    ],
    errors: ["forbidden", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "update_display_metadata",
    description: "Update artifact display title (description updates are not supported in this phase).",
    auth: "mcp_oauth",
    requiredScopes: ["write"],
    idempotency: "none",
    inputSchema: "update_display_metadata",
    outputSchema: "update_display_metadata",
    forwardedCalls: [
      {
        routeId: "artifacts.updateDisplayMetadata",
        auth: "mcp_bearer",
      },
    ],
    errors: ["forbidden", "invalid_request", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "create_share_link",
    description: "Create and mint a Share Link for the latest published revision.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "derived",
    inputSchema: "create_share_link",
    outputSchema: "create_share_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "create_revision_link",
    description: "Create and mint a Revision Link for a specific revision.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "derived",
    inputSchema: "create_revision_link",
    outputSchema: "create_revision_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.create",
        auth: "mcp_bearer",
        idempotencyKey: "same_as_tool",
      },
      {
        routeId: "accessLinks.mint",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "list_access_links",
    description: "List Share Links and Revision Links for an artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "none",
    inputSchema: "list_access_links",
    outputSchema: "list_access_links",
    forwardedCalls: [
      {
        routeId: "accessLinks.list",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "revoke_access_link",
    description: "Revoke a Share Link or Revision Link.",
    auth: "mcp_oauth",
    requiredScopes: ["share"],
    idempotency: "none",
    inputSchema: "revoke_access_link",
    outputSchema: "revoke_access_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.revoke",
        auth: "mcp_bearer",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "whoami",
    description: "Return the authenticated workspace member, workspace, and granted MCP scopes.",
    auth: "mcp_oauth",
    requiredScopes: [],
    idempotency: "none",
    inputSchema: "whoami",
    outputSchema: "whoami",
    forwardedCalls: [
      {
        routeId: "mcp.whoami",
        auth: "mcp_bearer",
      },
    ],
    errors: ["database_unavailable"] as const,
  },
] as const satisfies readonly McpToolContract[];

export function resolveMcpForwardedCall(call: McpForwardedCall): McpResolvedForwardedCall {
  const route = routeContractById(call.routeId);
  return {
    ...call,
    app: route.app,
    method: route.method,
    path: route.path,
    idempotency: route.idempotency,
  };
}

export function resolveMcpForwardedCalls(tool: McpToolContract): McpResolvedForwardedCall[] {
  return tool.forwardedCalls.map(resolveMcpForwardedCall);
}

export const MCP_API_ERROR_HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  not_authenticated: 401,
  invalid_auth: 401,
  forbidden: 403,
  invalid_request: 400,
  invalid_cursor: 400,
  invalid_idempotency_key: 400,
  invalid_content_length: 400,
  artifact_not_found: 404,
  not_found: 404,
  revision_unpublished: 404,
  upload_session_not_found: 404,
  api_key_not_found: 404,
  idempotency_in_flight: 409,
  draft_revision_conflict: 409,
  revision_retained: 410,
  usage_policy_exceeded: 429,
  rate_limited_actor: 429,
  rate_limited_workspace: 429,
  rate_limited_artifact: 429,
  database_unavailable: 503,
  storage_unavailable: 503,
};

export function mcpEntrypointForRenderMode(renderMode: McpPublishRenderMode): FilePath {
  switch (renderMode) {
    case "html":
      return "index.html" as FilePath;
    case "markdown":
      return "index.md" as FilePath;
    case "text":
      return "content.txt" as FilePath;
  }
}

export function mcpProtectedResourceMetadata(
  input: { resource?: string; authorizationServers?: readonly string[] } = {},
): McpProtectedResourceMetadata {
  return McpProtectedResourceMetadata.parse({
    resource: input.resource ?? MCP_RESOURCE_INDICATOR,
    authorization_servers: [...(input.authorizationServers ?? [])],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_DELEGATED_SCOPES],
  });
}

export function mcpWwwAuthenticateHeader(resource = MCP_RESOURCE_INDICATOR): string {
  const resourceMetadata = `${resource}/.well-known/oauth-protected-resource`;
  return `Bearer realm="mcp.agent-paste.sh", error="invalid_token", resource_metadata="${resourceMetadata}"`;
}

export function mcpTokenHasRequiredScopes(granted: readonly McpScope[], required: readonly McpScope[]): boolean {
  const grantedSet = new Set(granted);
  return required.every((scope) => grantedSet.has(scope));
}

const mcpScopeSet = new Set<string>(MCP_DELEGATED_SCOPES);
const excludedMemberOnlyScopeSet = new Set<string>(MCP_EXCLUDED_MEMBER_ONLY_SCOPES);

/** Parse the OAuth `scope` claim into delegated MCP scopes only. */
export function parseMcpScopeClaim(value: unknown): McpScope[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  const scopes: McpScope[] = [];
  for (const part of value.split(/\s+/u)) {
    if (mcpScopeSet.has(part)) {
      scopes.push(McpScope.parse(part));
    }
  }
  return scopes;
}

/** True when the claim includes Member-Only Scopes that MCP tokens must never carry. */
export function mcpScopeClaimIncludesMemberOnlyScopes(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  return value.split(/\s+/u).some((part) => excludedMemberOnlyScopeSet.has(part));
}

/** Map delegated MCP scopes to API route scopes for service-binding forwarding (ADR 0034). */
export function mcpScopesToApiScopes(mcpScopes: readonly McpScope[]): Scope[] {
  const apiScopes: Scope[] = [];
  if (mcpScopes.includes("write")) {
    apiScopes.push("publish");
  }
  if (mcpScopes.includes("read")) {
    apiScopes.push("read");
  }
  if (mcpScopes.includes("share")) {
    apiScopes.push("admin");
  }
  return apiScopes;
}

const MCP_IDEMPOTENCY_SEGMENT_MAX = 64;

function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (const unit of text) {
    hash ^= unit.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable, Idempotency-Key-safe segment for token sub or JSON-RPC request id. */
export function mcpIdempotencySegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
  if (
    sanitized.length >= 1 &&
    sanitized.length <= MCP_IDEMPOTENCY_SEGMENT_MAX &&
    /^[A-Za-z0-9._:-]+$/.test(sanitized)
  ) {
    return sanitized;
  }
  return `h${fnv1a32Hex(value)}`;
}

export function deriveMcpIdempotencyKey(input: {
  tokenSub: string;
  jsonRpcId: string | number;
  toolName: McpToolName;
}): IdempotencyKey {
  const sub = mcpIdempotencySegment(input.tokenSub);
  const rpc = mcpIdempotencySegment(String(input.jsonRpcId));
  return IdempotencyKey.parse(`mcp:${sub}:${rpc}:${input.toolName}`);
}

export function mcpToolContractByName(name: McpToolName): McpToolContract {
  const contract = mcpToolContracts.find((entry) => entry.name === name);
  if (!contract) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  return contract;
}

export function mapApiErrorToMcp(error: {
  code: ErrorCode;
  message: string;
  requestId?: string;
  docs?: string;
}): McpMappedToolError {
  return {
    code: error.code,
    message: error.message,
    jsonRpcCode: MCP_JSONRPC_APPLICATION_ERROR,
    httpStatus: MCP_API_ERROR_HTTP_STATUS[error.code] ?? 500,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.docs ? { docs: error.docs } : {}),
  };
}

export function mapMcpProtocolError(code: McpProtocolErrorCode, message: string): McpMappedToolError {
  const httpStatus =
    code === "invalid_token"
      ? 401
      : code === "insufficient_scope"
        ? 403
        : code === "invalid_params"
          ? 400
          : code === "method_not_found"
            ? 404
            : 500;
  const jsonRpcCode =
    code === "invalid_params"
      ? MCP_JSONRPC_INVALID_PARAMS
      : code === "method_not_found"
        ? MCP_JSONRPC_METHOD_NOT_FOUND
        : MCP_JSONRPC_APPLICATION_ERROR;

  return {
    code,
    message,
    jsonRpcCode,
    httpStatus,
  };
}

export function toMcpJsonRpcError(error: McpMappedToolError): McpJsonRpcError {
  return {
    code: error.jsonRpcCode,
    message: error.message,
    data: {
      code: error.code,
      message: error.message,
      ...(error.requestId ? { request_id: error.requestId } : {}),
      ...(error.docs ? { docs: error.docs } : {}),
    },
  };
}

export type McpToolListEntry = {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** MCP `tools/list` descriptors derived from Zod input schemas (ADR 0061). */
export function buildMcpToolList(): { tools: McpToolListEntry[] } {
  const registry = new OpenAPIRegistry();
  for (const tool of mcpToolContracts) {
    registry.register(`McpInput_${tool.name}`, mcpToolInputSchemas[tool.name]);
  }
  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "agent-paste-mcp-tools", version: "0.1.0" },
  });
  const schemas = document.components?.schemas ?? {};
  return {
    tools: mcpToolContracts.map((tool) => {
      const schema = schemas[`McpInput_${tool.name}`];
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: (schema ?? { type: "object" }) as Record<string, unknown>,
      };
    }),
  };
}
