import { AccessLinkSignedUrl, AccessLinkType } from "../accessLinks.js";
import { AgentView, DisplayMetadata } from "../agentView.js";
import { ArtifactListResponse, DeleteArtifactResponse } from "../artifacts.js";
import { Mebibytes, PaginationRequest } from "../common.js";
import {
  AccessLinkId,
  ArtifactId,
  Cursor,
  IdempotencyKey,
  IsoDateTime,
  PlainTextTitle,
  RevisionId,
  UrlString,
} from "../primitives.js";
import { RevisionListResponse } from "../revisions.js";
import { WorkspaceMemberId } from "../web.js";
import { WorkspaceSummary } from "../workspace.js";
import { z } from "../zod.js";
import { MCP_DELEGATED_SCOPES } from "./constants.js";

export const McpScope = z.enum(MCP_DELEGATED_SCOPES);
export type McpScope = z.infer<typeof McpScope>;

// scopes_supported advertises AuthKit's OAuth scopes (not the write/read/share
// capability vocabulary). The MCP client SDK reads this and sends it at
// /authorize; it must be AuthKit-supported scopes or the SDK falls back to its
// own default and AuthKit returns invalid_scope. Capability is still derived in
// api from the member (ADR 0079).
export const McpProtectedResourceMetadata = z
  .object({
    resource: UrlString,
    resource_name: z.string().min(1).max(80).optional(),
    authorization_servers: z.array(UrlString).max(10),
    bearer_methods_supported: z.tuple([z.literal("header")]),
    scopes_supported: z.array(z.string()).min(1).max(20),
  })
  .strict();
export type McpProtectedResourceMetadata = z.infer<typeof McpProtectedResourceMetadata>;

export const McpPublishRenderMode = z.enum(["text", "markdown", "html"]);
export type McpPublishRenderMode = z.infer<typeof McpPublishRenderMode>;

const mcpTextBody = z.string().min(1).max(Mebibytes.ten);
const mcpPublishShareDefault = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Defaults to false. Set true only when the user explicitly asks for a public/shareable Access Link: the tool creates or reuses a Share Link and returns its Access Link Signed URL as access_link_url.",
  );

export const McpPublishArtifactInput = z
  .object({
    title: PlainTextTitle,
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    share: mcpPublishShareDefault,
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpPublishArtifactInput = z.infer<typeof McpPublishArtifactInput>;

export const McpAddRevisionInput = z
  .object({
    artifact_id: ArtifactId,
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    share: mcpPublishShareDefault,
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

export const McpUploadStats = z
  .object({
    total_files: z.number().int().nonnegative(),
    total_bytes: z.number().int().nonnegative(),
    uploaded_files: z.number().int().nonnegative(),
    uploaded_bytes: z.number().int().nonnegative(),
    reused_files: z.number().int().nonnegative(),
    reused_bytes: z.number().int().nonnegative(),
  })
  .strict();
export type McpUploadStats = z.infer<typeof McpUploadStats>;

// MCP publish output is intentionally narrower than the REST PublishResult. The
// tool result is usually fed back into an assistant response, so it exposes only
// the user-facing live URL plus minimal publish metadata. Artifact IDs, Revision
// IDs, direct content URLs, and Agent View URLs remain available through
// explicit list/read/link tools.
export const McpPublishArtifactOutput = z
  .object({
    title: PlainTextTitle,
    access_link_url: UrlString.optional(),
    expires_at: IsoDateTime,
    upload_stats: McpUploadStats.optional(),
  })
  .strict();
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
    items: z.array(McpAccessLinkRow).max(100),
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
    scopes: z.array(McpScope).max(MCP_DELEGATED_SCOPES.length),
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
