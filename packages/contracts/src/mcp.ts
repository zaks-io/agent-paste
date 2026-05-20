import { z } from "zod";
import { AccessLinkDetail, CreateAccessLinkResponse, RevokeAccessLinkResponse } from "./accessLinks.js";
import { AgentView } from "./agentView.js";
import {
  ArtifactSummary,
  DeleteArtifactResponse,
  PublishResult,
  RevisionSummary,
  UpdateDisplayMetadataResponse,
} from "./artifacts.js";
import { McpPublishRenderMode, type Scope } from "./enums.js";
import { ArtifactId, IdempotencyKey, PlainTextDescription, PlainTextTitle, RevisionId } from "./primitives.js";
import { WhoamiResponse } from "./workspace.js";

export const McpPublishArtifactInput = z.object({
  title: PlainTextTitle,
  body: z.string().min(1).max(1_000_000),
  render_mode: McpPublishRenderMode,
  share: z.boolean().default(false),
  idempotency_key: IdempotencyKey.optional(),
});
export type McpPublishArtifactInput = z.infer<typeof McpPublishArtifactInput>;

export const McpAddRevisionInput = McpPublishArtifactInput.extend({
  artifact_id: ArtifactId,
});
export type McpAddRevisionInput = z.infer<typeof McpAddRevisionInput>;

export const McpArtifactIdInput = z.object({
  artifact_id: ArtifactId,
});
export type McpArtifactIdInput = z.infer<typeof McpArtifactIdInput>;

export const McpUpdateDisplayMetadataInput = z.object({
  artifact_id: ArtifactId,
  title: PlainTextTitle.optional(),
  description: PlainTextDescription.nullable().optional(),
});
export type McpUpdateDisplayMetadataInput = z.infer<typeof McpUpdateDisplayMetadataInput>;

export const McpCreateRevisionLinkInput = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
});
export type McpCreateRevisionLinkInput = z.infer<typeof McpCreateRevisionLinkInput>;

export const McpAccessLinkIdInput = z.object({
  access_link_id: z.string().min(1),
});
export type McpAccessLinkIdInput = z.infer<typeof McpAccessLinkIdInput>;

export const McpListInput = z.object({
  cursor: z.string().optional(),
});
export type McpListInput = z.infer<typeof McpListInput>;

export type McpToolContract = {
  name: string;
  requiredScopes: readonly Scope[];
  inputSchemaName: string;
  outputSchemaName: string;
};

export const mcpToolContracts = [
  {
    name: "publish_artifact",
    requiredScopes: ["write", "read", "share"],
    inputSchemaName: "McpPublishArtifactInput",
    outputSchemaName: "PublishResult",
  },
  {
    name: "add_revision",
    requiredScopes: ["write", "read", "share"],
    inputSchemaName: "McpAddRevisionInput",
    outputSchemaName: "PublishResult",
  },
  {
    name: "list_artifacts",
    requiredScopes: ["read"],
    inputSchemaName: "McpListInput",
    outputSchemaName: "ArtifactSummary[]",
  },
  {
    name: "read_artifact",
    requiredScopes: ["read"],
    inputSchemaName: "McpArtifactIdInput",
    outputSchemaName: "AgentView",
  },
  {
    name: "list_revisions",
    requiredScopes: ["read"],
    inputSchemaName: "McpArtifactIdInput",
    outputSchemaName: "RevisionSummary[]",
  },
  {
    name: "delete_artifact",
    requiredScopes: ["write"],
    inputSchemaName: "McpArtifactIdInput",
    outputSchemaName: "DeleteArtifactResponse",
  },
  {
    name: "update_display_metadata",
    requiredScopes: ["write"],
    inputSchemaName: "McpUpdateDisplayMetadataInput",
    outputSchemaName: "UpdateDisplayMetadataResponse",
  },
  {
    name: "create_share_link",
    requiredScopes: ["read", "share"],
    inputSchemaName: "McpArtifactIdInput",
    outputSchemaName: "CreateAccessLinkResponse",
  },
  {
    name: "create_revision_link",
    requiredScopes: ["read", "share"],
    inputSchemaName: "McpCreateRevisionLinkInput",
    outputSchemaName: "CreateAccessLinkResponse",
  },
  {
    name: "list_access_links",
    requiredScopes: ["read", "share"],
    inputSchemaName: "McpArtifactIdInput",
    outputSchemaName: "AccessLinkDetail[]",
  },
  {
    name: "revoke_access_link",
    requiredScopes: ["share"],
    inputSchemaName: "McpAccessLinkIdInput",
    outputSchemaName: "RevokeAccessLinkResponse",
  },
  {
    name: "whoami",
    requiredScopes: [],
    inputSchemaName: "EmptyObject",
    outputSchemaName: "WhoamiResponse",
  },
] as const satisfies readonly McpToolContract[];

export const McpReadArtifactResponse = AgentView;
export const McpPublishArtifactResponse = PublishResult;
export const McpListArtifactsResponse = z.array(ArtifactSummary);
export const McpListRevisionsResponse = z.array(RevisionSummary);
export const McpDeleteArtifactResponse = DeleteArtifactResponse;
export const McpUpdateDisplayMetadataResponse = UpdateDisplayMetadataResponse;
export const McpCreateAccessLinkResponse = CreateAccessLinkResponse;
export const McpListAccessLinksResponse = z.array(AccessLinkDetail);
export const McpRevokeAccessLinkResponse = RevokeAccessLinkResponse;
export const McpWhoamiResponse = WhoamiResponse;
