import { z } from "zod";
import { AgentView, BundleAvailability, DisplayMetadata, FileEntry, SafetyWarning } from "./agentView.js";
import { PageInfo } from "./common.js";
import { AccessLinkType, ArtifactStatus, DeletionReason, RenderMode, RevisionStatus } from "./enums.js";
import {
  ArtifactId,
  FilePath,
  IsoDateTime,
  PlainTextDescription,
  PlainTextTitle,
  RevisionId,
  UrlString,
} from "./primitives.js";

export const ArtifactSummary = z.object({
  id: ArtifactId,
  status: ArtifactStatus,
  display_metadata: DisplayMetadata,
  published_revision_id: RevisionId.nullable(),
  latest_revision_number: z.number().int().nonnegative(),
  pinned: z.boolean(),
  access_link_lockdown_active: z.boolean(),
  bundle: BundleAvailability.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  last_published_at: IsoDateTime.nullable(),
  auto_delete_at: IsoDateTime.nullable(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;

export const ArtifactDetail = ArtifactSummary.extend({
  private_link: UrlString.nullable(),
  files: z.array(FileEntry).optional(),
  safety_warnings: z.array(SafetyWarning),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;

export const ArtifactListResponse = z.object({
  data: z.array(ArtifactSummary),
  page_info: PageInfo,
});
export type ArtifactListResponse = z.infer<typeof ArtifactListResponse>;

export const RevisionSummary = z.object({
  id: RevisionId,
  artifact_id: ArtifactId,
  revision_number: z.number().int().positive(),
  status: RevisionStatus,
  entrypoint: FilePath,
  render_mode: RenderMode,
  file_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  bundle: BundleAvailability,
  created_at: IsoDateTime,
  published_at: IsoDateTime.nullable(),
  retained_at: IsoDateTime.nullable(),
});
export type RevisionSummary = z.infer<typeof RevisionSummary>;

export const RevisionListResponse = z.object({
  data: z.array(RevisionSummary),
  page_info: PageInfo,
});
export type RevisionListResponse = z.infer<typeof RevisionListResponse>;

export const PublishRequest = z.object({
  revision_id: RevisionId,
  entrypoint: FilePath.optional(),
  render_mode: RenderMode.optional(),
  display_metadata: z
    .object({
      title: PlainTextTitle.optional(),
      description: PlainTextDescription.nullable().optional(),
    })
    .optional(),
  share: z.boolean().default(false),
});
export type PublishRequest = z.infer<typeof PublishRequest>;

export const PublishResult = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  private_link: UrlString,
  revision_link: UrlString,
  share_link: UrlString.nullable(),
  agent_view_link: UrlString,
  bundle: BundleAvailability,
  safety_warnings: z.array(SafetyWarning),
});
export type PublishResult = z.infer<typeof PublishResult>;

export const UpdateDisplayMetadataRequest = z.object({
  title: PlainTextTitle.optional(),
  description: PlainTextDescription.nullable().optional(),
});
export type UpdateDisplayMetadataRequest = z.infer<typeof UpdateDisplayMetadataRequest>;

export const UpdateDisplayMetadataResponse = z.object({
  artifact_id: ArtifactId,
  display_metadata: DisplayMetadata,
  updated_at: IsoDateTime,
});
export type UpdateDisplayMetadataResponse = z.infer<typeof UpdateDisplayMetadataResponse>;

export const DeleteArtifactRequest = z.object({
  reason: DeletionReason.default("user"),
});
export type DeleteArtifactRequest = z.infer<typeof DeleteArtifactRequest>;

export const DeleteArtifactResponse = z.object({
  artifact_id: ArtifactId,
  deleted_at: IsoDateTime,
});
export type DeleteArtifactResponse = z.infer<typeof DeleteArtifactResponse>;

export const AccessLinkLockdownResponse = z.object({
  artifact_id: ArtifactId,
  active: z.boolean(),
  changed_at: IsoDateTime.nullable(),
});
export type AccessLinkLockdownResponse = z.infer<typeof AccessLinkLockdownResponse>;

export const PinArtifactResponse = z.object({
  artifact_id: ArtifactId,
  pinned: z.boolean(),
  changed_at: IsoDateTime,
});
export type PinArtifactResponse = z.infer<typeof PinArtifactResponse>;

export const GetArtifactAgentViewResponse = AgentView;
export type GetArtifactAgentViewResponse = z.infer<typeof GetArtifactAgentViewResponse>;

export const CreateRevisionLinkRequest = z.object({
  type: z.literal(AccessLinkType.enum.revision),
  revision_id: RevisionId,
  expires_at: IsoDateTime.nullable().optional(),
});
export type CreateRevisionLinkRequest = z.infer<typeof CreateRevisionLinkRequest>;

export const CreateShareLinkRequest = z.object({
  type: z.literal(AccessLinkType.enum.share),
  expires_at: IsoDateTime.nullable().optional(),
});
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequest>;

export const DiscardDraftRevisionResponse = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  discarded_at: IsoDateTime,
});
export type DiscardDraftRevisionResponse = z.infer<typeof DiscardDraftRevisionResponse>;
