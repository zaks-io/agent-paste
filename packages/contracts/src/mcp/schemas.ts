import { AccessLinkSignedUrl, AccessLinkType } from "../accessLinks.js";
import { AgentView, DisplayMetadata } from "../agentView.js";
import { ArtifactFileContent, ArtifactListResponse, DeleteArtifactResponse } from "../artifacts.js";
import { Mebibytes, PaginationRequest } from "../common.js";
import {
  AccessLinkId,
  ArtifactId,
  Cursor,
  FilePath,
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

// scopes_supported advertises AuthKit's OAuth scopes (not the read/publish/admin
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

export const McpPublishArtifactInput = z
  .object({
    title: PlainTextTitle,
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpPublishArtifactInput = z.infer<typeof McpPublishArtifactInput>;

export const McpAddRevisionInput = z
  .object({
    artifact_id: ArtifactId.describe(
      "The existing Artifact to revise. Get it from list_artifacts data[].id or read_artifact artifact_id. The new Revision publishes under this Artifact's stable private_url, which live-updates any already-open viewer.",
    ),
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpAddRevisionInput = z.infer<typeof McpAddRevisionInput>;

// One literal old/new replacement, the same shape as Claude's Edit/MultiEdit
// tools. Matching is LITERAL (no regex): old_string must occur exactly once in
// the base unless replace_all is set. Bounded to the same 10 MiB ceiling as a
// publish body so a single oversize string cannot blow the request up.
export const McpEdit = z
  .object({
    old_string: z
      .string()
      .min(1)
      .max(Mebibytes.ten)
      .describe("Exact text to find in the file. Must match once unless replace_all is true."),
    new_string: z.string().max(Mebibytes.ten).describe("Text to replace it with (may be empty to delete the match)."),
    replace_all: z
      .boolean()
      .optional()
      .describe("Replace every occurrence instead of requiring a single unique match."),
  })
  .strict();
export type McpEdit = z.infer<typeof McpEdit>;

export const McpMultiEditInput = z
  .object({
    artifact_id: ArtifactId.describe(
      "The existing Artifact to edit. Get it from list_artifacts data[].id or read_artifact artifact_id. The edited Revision publishes under this Artifact's stable private_url, which live-updates any already-open viewer.",
    ),
    path: FilePath.describe(
      "The stored file to edit within the Artifact (e.g. the entrypoint). Read it first with read_file to get the exact base text the edits must match.",
    ),
    edits: z
      .array(McpEdit)
      .min(1)
      .max(100)
      .describe("Ordered literal edits applied in sequence; each sees the result of the previous one."),
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpMultiEditInput = z.infer<typeof McpMultiEditInput>;

export const McpListArtifactsInput = PaginationRequest.pick({ cursor: true }).strict();
export type McpListArtifactsInput = z.infer<typeof McpListArtifactsInput>;

export const McpReadArtifactInput = z.object({ artifact_id: ArtifactId }).strict();
export type McpReadArtifactInput = z.infer<typeof McpReadArtifactInput>;

export const McpReadFileInput = z
  .object({ artifact_id: ArtifactId, path: FilePath, revision_id: RevisionId.optional() })
  .strict();
export type McpReadFileInput = z.infer<typeof McpReadFileInput>;

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

export const McpVisibility = z.enum(["private", "unlisted"]);
export type McpVisibility = z.infer<typeof McpVisibility>;

export const McpSetVisibilityInput = z.object({ artifact_id: ArtifactId, visibility: McpVisibility }).strict();
export type McpSetVisibilityInput = z.infer<typeof McpSetVisibilityInput>;

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

// Publishing returns one link to hand back to the user: private_url. It opens the
// Artifact in a login-walled browser viewer (`/v/<id>`). Publish is content-only
// and private, with no visibility input. This matches the CLI, which runs the
// same publish path. To change unauthenticated access, call set_visibility.
// Artifact/Revision IDs and content URLs remain available through explicit
// list/read/link tools.
export const McpPublishArtifactOutput = z
  .object({
    title: PlainTextTitle,
    private_url: UrlString,
    expires_at: IsoDateTime,
    upload_stats: McpUploadStats.optional(),
  })
  .strict();
export type McpPublishArtifactOutput = z.infer<typeof McpPublishArtifactOutput>;

export const McpListArtifactsOutput = ArtifactListResponse;
export type McpListArtifactsOutput = z.infer<typeof McpListArtifactsOutput>;

export const McpReadArtifactOutput = AgentView;
export type McpReadArtifactOutput = z.infer<typeof McpReadArtifactOutput>;

export const McpReadFileOutput = ArtifactFileContent;
export type McpReadFileOutput = z.infer<typeof McpReadFileOutput>;

export const McpListRevisionsOutput = RevisionListResponse;
export type McpListRevisionsOutput = z.infer<typeof McpListRevisionsOutput>;

export const McpDeleteArtifactOutput = DeleteArtifactResponse;
export type McpDeleteArtifactOutput = z.infer<typeof McpDeleteArtifactOutput>;

export const McpUpdateDisplayMetadataOutput = DisplayMetadata;
export type McpUpdateDisplayMetadataOutput = z.infer<typeof McpUpdateDisplayMetadataOutput>;

export const McpSetVisibilityPrivateOutput = z
  .object({
    artifact_id: ArtifactId,
    visibility: z.literal("private"),
    private_url: UrlString,
    revoked_access_link_ids: z.array(AccessLinkId),
  })
  .strict();
export type McpSetVisibilityPrivateOutput = z.infer<typeof McpSetVisibilityPrivateOutput>;

export const McpSetVisibilityUnlistedOutput = z
  .object({
    artifact_id: ArtifactId,
    visibility: z.literal("unlisted"),
    access_link_id: AccessLinkId,
    unlisted_url: UrlString,
  })
  .strict();
export type McpSetVisibilityUnlistedOutput = z.infer<typeof McpSetVisibilityUnlistedOutput>;

export const McpSetVisibilityOutput = z.discriminatedUnion("visibility", [
  McpSetVisibilityPrivateOutput,
  McpSetVisibilityUnlistedOutput,
]);
export type McpSetVisibilityOutput = z.infer<typeof McpSetVisibilityOutput>;

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
    scopes: z.array(McpScope).max(MCP_DELEGATED_SCOPES.length),
  })
  .strict();
export type McpWhoamiResponse = z.infer<typeof McpWhoamiResponse>;

export const McpToolName = z.enum([
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
export type McpToolName = z.infer<typeof McpToolName>;
