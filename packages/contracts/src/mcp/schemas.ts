import { AgentView, DisplayMetadata } from "../agentView.js";
import { ArtifactFileContent, ArtifactListResponse, DeleteArtifactResponse } from "../artifacts.js";
import { Mebibytes, PaginationRequest } from "../common.js";
import {
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
      "The existing Artifact to revise. Get it from list_artifacts data[].id. The new Revision publishes under this Artifact's stable url.",
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
      "The existing Artifact to edit. Get it from list_artifacts data[].id. The edited Revision publishes under this Artifact's stable url.",
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

// Publishing returns one top-level capability URL. It is stable across revisions
// and is the only browser link the agent needs to hand back.
export const McpPublishArtifactOutput = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    title: PlainTextTitle,
    url: UrlString,
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
  "whoami",
]);
export type McpToolName = z.infer<typeof McpToolName>;
