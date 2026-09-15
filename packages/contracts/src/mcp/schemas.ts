import * as z from "zod";
import { AgentView, DisplayMetadata } from "../agentView.js";
import { ArtifactFileContent, ArtifactListResponse, DeleteArtifactResponse } from "../artifacts.js";
import { PaginationRequest } from "../common.js";
import {
  ArtifactId,
  ArtifactReference,
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
import { MCP_DELEGATED_SCOPES } from "./constants.js";
import { MAX_MCP_TEXT_CHARACTERS, McpEdit } from "./edit.js";

export { MAX_MCP_TEXT_CHARACTERS, McpEdit } from "./edit.js";

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

const mcpTextBody = z.string().min(1).max(MAX_MCP_TEXT_CHARACTERS);

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
    artifact_id: ArtifactReference.describe(
      "Artifact ID to revise, such as 01234-56789-abcde-fghjd. Full URLs also work. The URL stays the same.",
    ),
    body: mcpTextBody,
    render_mode: McpPublishRenderMode,
    idempotency_key: IdempotencyKey.optional(),
  })
  .strict();
export type McpAddRevisionInput = z.infer<typeof McpAddRevisionInput>;

export const McpMultiEditInput = z
  .object({
    artifact_id: ArtifactReference.describe(
      "Artifact ID to edit, such as 01234-56789-abcde-fghjd. Full URLs also work. The URL stays the same.",
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

export const McpReadArtifactInput = z.object({ artifact_id: ArtifactReference }).strict();
export type McpReadArtifactInput = z.infer<typeof McpReadArtifactInput>;

export const McpReadFileInput = z
  .object({ artifact_id: ArtifactReference, path: FilePath, revision_id: RevisionId.optional() })
  .strict();
export type McpReadFileInput = z.infer<typeof McpReadFileInput>;

export const McpListRevisionsInput = z
  .object({
    artifact_id: ArtifactReference,
    cursor: Cursor.optional(),
  })
  .strict();
export type McpListRevisionsInput = z.infer<typeof McpListRevisionsInput>;

export const McpDeleteArtifactInput = z.object({ artifact_id: ArtifactReference }).strict();
export type McpDeleteArtifactInput = z.infer<typeof McpDeleteArtifactInput>;

export const McpUpdateDisplayMetadataInput = z
  .object({
    artifact_id: ArtifactReference,
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
