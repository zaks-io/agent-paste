import { PageInfo } from "./common.js";
import { ArtifactId, FilePath, IsoDateTime, RevisionId } from "./primitives.js";
import { z } from "./zod.js";

export const RevisionStatus = z.enum(["draft", "published", "retained"]);
export type RevisionStatus = z.infer<typeof RevisionStatus>;

export const RenderMode = z.enum(["html", "markdown", "text", "image", "audio", "video"]);
export type RenderMode = z.infer<typeof RenderMode>;

export const RevisionSummary = z.object({
  revision_id: RevisionId,
  revision_number: z.number().int().positive().nullable(),
  status: RevisionStatus,
  entrypoint: FilePath,
  render_mode: RenderMode,
  file_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  created_at: IsoDateTime,
  published_at: IsoDateTime.nullable(),
});
export type RevisionSummary = z.infer<typeof RevisionSummary>;

export const RevisionListResponse = z.object({
  artifact_id: ArtifactId,
  items: z.array(RevisionSummary),
  page_info: PageInfo,
});
export type RevisionListResponse = z.infer<typeof RevisionListResponse>;
