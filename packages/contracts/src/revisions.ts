import * as z from "zod";
import { PageInfo } from "./common.js";
import { ArtifactId, FilePath, IsoDateTime, RevisionId } from "./primitives.js";

export const RevisionStatus = z.enum(["draft", "published", "retained"]);
export type RevisionStatus = z.infer<typeof RevisionStatus>;

export const RevisionSummary = z.object({
  revision_id: RevisionId,
  revision_number: z.number().int().positive().nullable(),
  status: RevisionStatus,
  entrypoint: FilePath,
  file_count: z.number().int().min(1),
  size_bytes: z.number().int().nonnegative(),
  created_at: IsoDateTime,
  published_at: IsoDateTime.nullable(),
});
export type RevisionSummary = z.infer<typeof RevisionSummary>;

export const RevisionListResponse = z.object({
  artifact_id: ArtifactId,
  items: z.array(RevisionSummary).max(100),
  page_info: PageInfo,
});
export type RevisionListResponse = z.infer<typeof RevisionListResponse>;

// Retention fields are returned only when explicitly requested, so strict legacy clients keep parsing.
export const PublishRevisionRequest = z.object({ include_retention: z.literal(true).optional() }).strict();
export type PublishRevisionRequest = z.infer<typeof PublishRevisionRequest>;
