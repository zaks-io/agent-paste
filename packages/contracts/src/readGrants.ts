import * as z from "zod";
import { ArtifactId, IsoDateTime, RevisionId, UrlString } from "./primitives.js";
export const RevisionReadGrant = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    file_count: z.number().int().nonnegative(),
    size_bytes: z.number().int().nonnegative(),
    content_base_url: UrlString,
    expires_at: IsoDateTime,
  })
  .strict();
export type RevisionReadGrant = z.infer<typeof RevisionReadGrant>;
