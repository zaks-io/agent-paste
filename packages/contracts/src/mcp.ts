import { AccessLinkSignedUrl, AccessLinkType } from "./accessLinks.js";
import { AgentView, DisplayMetadata } from "./agentView.js";
import { ArtifactListResponse, DeleteArtifactResponse } from "./artifacts.js";
import { type ErrorCode, ErrorCode as ErrorCodeSchema, Mebibytes, PaginationRequest } from "./common.js";
import {
  AccessLinkId,
  ArtifactId,
  Cursor,
  type FilePath,
  IdempotencyKey,
  PlainTextDescription,
  PlainTextTitle,
  RevisionId,
  UrlString,
} from "./primitives.js";
import { RevisionListResponse } from "./revisions.js";
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
    title: PlainTextTitle.optional(),
    description: PlainTextDescription.nullable().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.description !== undefined, {
    message: "At least one of title or description is required",
  });
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
  share_link_url: UrlString.optional(),
}).strict();
export type McpPublishArtifactOutput = z.infer<typeof McpPublishArtifactOutput>;

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

export type McpForwardedIdempotency = "none" | "required" | "same_as_tool";

export type McpForwardedCall = {
  routeId: string;
  app: "api" | "upload";
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  auth: McpForwardedAuth;
  idempotency: McpForwardedIdempotency;
  optional?: boolean;
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
    description: "Publish a new text-only artifact and optionally mint a Share Link.",
    auth: "mcp_oauth",
    requiredScopes: ["write", "read", "share"],
    idempotency: "optional_override",
    inputSchema: "publish_artifact",
    outputSchema: "publish_artifact",
    forwardedCalls: [
      {
        routeId: "uploadSessions.create",
        app: "upload",
        method: "POST",
        path: "/v1/upload-sessions",
        auth: "mcp_bearer",
        idempotency: "same_as_tool",
      },
      {
        routeId: "uploadSessions.putFile",
        app: "upload",
        method: "PUT",
        path: "/v1/upload-sessions/{upload_session_id}/files/{path}",
        auth: "signed_upload_url",
        idempotency: "none",
      },
      {
        routeId: "uploadSessions.finalize",
        app: "upload",
        method: "POST",
        path: "/v1/upload-sessions/{upload_session_id}/finalize",
        auth: "mcp_bearer",
        idempotency: "same_as_tool",
      },
      {
        routeId: "revisions.publish",
        app: "api",
        method: "POST",
        path: "/v1/artifacts/{artifact_id}/revisions/{revision_id}/publish",
        auth: "mcp_bearer",
        idempotency: "same_as_tool",
      },
      {
        routeId: "accessLinks.createShare",
        app: "api",
        method: "POST",
        path: "/v1/artifacts/{artifact_id}/access-links",
        auth: "mcp_bearer",
        idempotency: "none",
        optional: true,
      },
      {
        routeId: "accessLinks.mint",
        app: "api",
        method: "POST",
        path: "/v1/access-links/{access_link_id}/mint",
        auth: "mcp_bearer",
        idempotency: "required",
        optional: true,
      },
    ],
    errors: publishChainErrors,
  },
  {
    name: "add_revision",
    description: "Add and publish a text-only revision on an existing artifact.",
    auth: "mcp_oauth",
    requiredScopes: ["write", "read", "share"],
    idempotency: "optional_override",
    inputSchema: "add_revision",
    outputSchema: "add_revision",
    forwardedCalls: [
      {
        routeId: "uploadSessions.create",
        app: "upload",
        method: "POST",
        path: "/v1/upload-sessions",
        auth: "mcp_bearer",
        idempotency: "same_as_tool",
      },
      {
        routeId: "uploadSessions.putFile",
        app: "upload",
        method: "PUT",
        path: "/v1/upload-sessions/{upload_session_id}/files/{path}",
        auth: "signed_upload_url",
        idempotency: "none",
      },
      {
        routeId: "uploadSessions.finalize",
        app: "upload",
        method: "POST",
        path: "/v1/upload-sessions/{upload_session_id}/finalize",
        auth: "mcp_bearer",
        idempotency: "same_as_tool",
      },
      {
        routeId: "revisions.publish",
        app: "api",
        method: "POST",
        path: "/v1/artifacts/{artifact_id}/revisions/{revision_id}/publish",
        auth: "mcp_bearer",
        idempotency: "same_as_tool",
      },
      {
        routeId: "accessLinks.createShare",
        app: "api",
        method: "POST",
        path: "/v1/artifacts/{artifact_id}/access-links",
        auth: "mcp_bearer",
        idempotency: "none",
        optional: true,
      },
      {
        routeId: "accessLinks.mint",
        app: "api",
        method: "POST",
        path: "/v1/access-links/{access_link_id}/mint",
        auth: "mcp_bearer",
        idempotency: "required",
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
        app: "api",
        method: "GET",
        path: "/v1/artifacts",
        auth: "mcp_bearer",
        idempotency: "none",
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
        app: "api",
        method: "GET",
        path: "/v1/artifacts/{artifact_id}/agent-view",
        auth: "mcp_bearer",
        idempotency: "none",
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
        app: "api",
        method: "GET",
        path: "/v1/artifacts/{artifact_id}/revisions",
        auth: "mcp_bearer",
        idempotency: "none",
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
        app: "api",
        method: "DELETE",
        path: "/v1/artifacts/{artifact_id}",
        auth: "mcp_bearer",
        idempotency: "none",
      },
    ],
    errors: ["forbidden", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "update_display_metadata",
    description: "Update artifact display metadata.",
    auth: "mcp_oauth",
    requiredScopes: ["write"],
    idempotency: "none",
    inputSchema: "update_display_metadata",
    outputSchema: "update_display_metadata",
    forwardedCalls: [
      {
        routeId: "artifacts.updateDisplayMetadata",
        app: "api",
        method: "PATCH",
        path: "/v1/artifacts/{artifact_id}/display-metadata",
        auth: "mcp_bearer",
        idempotency: "none",
      },
    ],
    errors: ["forbidden", "invalid_request", "not_found", "artifact_not_found", "database_unavailable"] as const,
  },
  {
    name: "create_share_link",
    description: "Create and mint a Share Link for the latest published revision.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "none",
    inputSchema: "create_share_link",
    outputSchema: "create_share_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.createShare",
        app: "api",
        method: "POST",
        path: "/v1/artifacts/{artifact_id}/access-links",
        auth: "mcp_bearer",
        idempotency: "none",
      },
      {
        routeId: "accessLinks.mint",
        app: "api",
        method: "POST",
        path: "/v1/access-links/{access_link_id}/mint",
        auth: "mcp_bearer",
        idempotency: "required",
      },
    ],
    errors: shareLinkErrors,
  },
  {
    name: "create_revision_link",
    description: "Create and mint a Revision Link for a specific revision.",
    auth: "mcp_oauth",
    requiredScopes: ["read", "share"],
    idempotency: "none",
    inputSchema: "create_revision_link",
    outputSchema: "create_revision_link",
    forwardedCalls: [
      {
        routeId: "accessLinks.createRevision",
        app: "api",
        method: "POST",
        path: "/v1/artifacts/{artifact_id}/access-links",
        auth: "mcp_bearer",
        idempotency: "none",
      },
      {
        routeId: "accessLinks.mint",
        app: "api",
        method: "POST",
        path: "/v1/access-links/{access_link_id}/mint",
        auth: "mcp_bearer",
        idempotency: "required",
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
        app: "api",
        method: "GET",
        path: "/v1/artifacts/{artifact_id}/access-links",
        auth: "mcp_bearer",
        idempotency: "none",
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
        app: "api",
        method: "POST",
        path: "/v1/access-links/{access_link_id}/revoke",
        auth: "mcp_bearer",
        idempotency: "none",
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
        routeId: "whoami.get",
        app: "api",
        method: "GET",
        path: "/v1/whoami",
        auth: "mcp_bearer",
        idempotency: "none",
      },
    ],
    errors: ["database_unavailable"] as const,
  },
] as const satisfies readonly McpToolContract[];

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

export function deriveMcpIdempotencyKey(input: {
  tokenSub: string;
  jsonRpcId: string | number;
  toolName: McpToolName;
}): IdempotencyKey {
  const sanitizedSub = input.tokenSub.replace(/[^A-Za-z0-9._:-]/g, "_");
  return `mcp:${sanitizedSub}:${input.jsonRpcId}:${input.toolName}` as IdempotencyKey;
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
