import { z } from "zod";
import { ActorType, BundleStatus, RenderMode, SafetyWarningScope, SafetyWarningSeverity } from "./enums.js";
import {
  AccessLinkId,
  ArtifactId,
  FilePath,
  IsoDateTime,
  PlainTextDescription,
  PlainTextTitle,
  RevisionId,
  Sha256Hex,
  UrlString,
  WorkspaceMemberId,
} from "./primitives.js";

export const CreatorReference = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("member"),
    id: WorkspaceMemberId,
    display_name: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal("api_key"),
    id: z.string().min(1),
    name: z.string().min(1).max(200),
  }),
]);
export type CreatorReference = z.infer<typeof CreatorReference>;

export const Manifest = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  revision_number: z.number().int().positive(),
  entrypoint: FilePath,
  render_mode: RenderMode,
  created_at: IsoDateTime,
  creator: CreatorReference.optional(),
});
export type Manifest = z.infer<typeof Manifest>;

export const DisplayMetadata = z.object({
  title: PlainTextTitle,
  description: PlainTextDescription.nullable(),
});
export type DisplayMetadata = z.infer<typeof DisplayMetadata>;

export const FileEntry = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative(),
  sha256: Sha256Hex,
  served_content_type: z.string().min(1).max(200),
  uploaded_at: IsoDateTime,
});
export type FileEntry = z.infer<typeof FileEntry>;

export const SafetyWarning = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  severity: SafetyWarningSeverity,
  scope: SafetyWarningScope,
  file_path: FilePath.nullable(),
  message: z.string().min(1).max(1000),
  detected_at: IsoDateTime,
});
export type SafetyWarning = z.infer<typeof SafetyWarning>;

export const BundleAvailability = z.discriminatedUnion("status", [
  z.object({
    status: z.literal(BundleStatus.enum.disabled),
  }),
  z.object({
    status: z.literal(BundleStatus.enum.pending),
    retry_after_seconds: z.number().int().positive().optional(),
  }),
  z.object({
    status: z.literal(BundleStatus.enum.failed),
  }),
  z.object({
    status: z.literal(BundleStatus.enum.ready),
    url: UrlString,
    size_bytes: z.number().int().nonnegative(),
    generated_at: IsoDateTime,
  }),
]);
export type BundleAvailability = z.infer<typeof BundleAvailability>;

export const AgentView = z.object({
  manifest: Manifest,
  display_metadata: DisplayMetadata,
  files: z.array(FileEntry),
  content_prefix: UrlString,
  safety_warnings: z.array(SafetyWarning),
  bundle: BundleAvailability,
});
export type AgentView = z.infer<typeof AgentView>;

export const ActorReference = z.object({
  type: ActorType,
  id: z.string().min(1),
  display: z.string().min(1).max(200),
});
export type ActorReference = z.infer<typeof ActorReference>;

export const AccessLinkResolvedAgentView = AgentView.extend({
  access_link_id: AccessLinkId,
});
export type AccessLinkResolvedAgentView = z.infer<typeof AccessLinkResolvedAgentView>;
