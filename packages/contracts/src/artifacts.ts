import { Mebibytes, PageInfo } from "./common.js";
import { ArtifactStatus } from "./enums.js";
import { ArtifactId, FilePath, IsoDateTime, PlainTextTitle, RevisionId, Sha256Hex } from "./primitives.js";
import { z } from "./zod.js";

export const ArtifactSummary = z.object({
  id: ArtifactId,
  // Null until the artifact's first Revision is published (drafts / in-flight
  // uploads have no Published Revision yet). Matches the nullable DB column and
  // WebArtifactRow.latest_revision_id.
  revision_id: RevisionId.nullable(),
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
  files: z.array(ArtifactFile).max(100),
  operation_event_ids: z.array(z.string()).max(100),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;

export const ArtifactListResponse = z.object({
  data: z.array(ArtifactSummary).max(100),
  page_info: PageInfo,
});
export type ArtifactListResponse = z.infer<typeof ArtifactListResponse>;

export const DeleteArtifactResponse = z.object({
  artifact_id: ArtifactId,
  deleted_at: IsoDateTime,
});
export type DeleteArtifactResponse = z.infer<typeof DeleteArtifactResponse>;

// A member reading one stored file's decrypted plaintext so an agent can diff
// against it to produce a unified-diff patch revise (ADR 0089).
// `is_binary` is byte-derived (true binary only); `content_type` is path-derived,
// so they may disagree (e.g. binary saved as .txt) — `is_binary` is authoritative
// for deciding whether `body` is patchable text. `body` is the decoded UTF-8 text
// and is present iff the file is text AND <= 10 MiB. When `body` is absent and
// `is_binary` is false, the file is text but too large to inline: fetch it via the
// signed content url or upload a whole blob (never a patch). `sha256` is the
// plaintext content address an agent declares as a patch's `base_sha256`.
export const ArtifactFileContent = z
  .object({
    path: FilePath,
    sha256: Sha256Hex,
    size_bytes: z.number().int().nonnegative(),
    content_type: z.string().min(1).max(200),
    is_binary: z.boolean(),
    body: z.string().max(Mebibytes.ten).optional(),
  })
  .strict();
export type ArtifactFileContent = z.infer<typeof ArtifactFileContent>;
