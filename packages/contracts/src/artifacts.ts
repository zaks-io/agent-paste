import { PageInfo } from "./common.js";
import { ArtifactStatus } from "./enums.js";
import { ArtifactId, FilePath, IsoDateTime, PlainTextTitle, RevisionId } from "./primitives.js";
import { z } from "./zod.js";

export const ArtifactSummary = z.object({
  id: ArtifactId,
  revision_id: RevisionId,
  status: ArtifactStatus,
  title: PlainTextTitle,
  entrypoint: FilePath,
  file_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  expires_at: IsoDateTime,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
  delete_reason: z.string().nullable(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;

export const ArtifactFile = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  uploaded_at: IsoDateTime,
});
export type ArtifactFile = z.infer<typeof ArtifactFile>;

export const ArtifactDetail = ArtifactSummary.extend({
  files: z.array(ArtifactFile),
  operation_event_ids: z.array(z.string()),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;

export const ArtifactListResponse = z.object({
  data: z.array(ArtifactSummary),
  page_info: PageInfo,
});
export type ArtifactListResponse = z.infer<typeof ArtifactListResponse>;

export const DeleteArtifactResponse = z.object({
  artifact_id: ArtifactId,
  deleted_at: IsoDateTime,
});
export type DeleteArtifactResponse = z.infer<typeof DeleteArtifactResponse>;
