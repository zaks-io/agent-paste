import { FILE_LIST_PAGE_MAX } from "@agent-paste/config";
import * as z from "zod";
import { PageInfo } from "./common.js";
import { ArtifactId, FilePath, PlainTextTitle, RevisionId, Sha256Hex } from "./primitives.js";

export const ArtifactFileListItem = z
  .object({
    path: FilePath,
    size_bytes: z.number().int().nonnegative(),
    sha256: Sha256Hex.nullable(),
    content_type: z.string().min(1).max(200),
    format: z.enum(["single", "chunked-v1"]),
  })
  .strict();
export type ArtifactFileListItem = z.infer<typeof ArtifactFileListItem>;
export const ArtifactFileListResponse = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    file_count: z.number().int().nonnegative(),
    size_bytes: z.number().int().nonnegative(),
    entrypoint: FilePath,
    title: PlainTextTitle,
    items: z.array(ArtifactFileListItem).max(FILE_LIST_PAGE_MAX),
    page_info: PageInfo,
  })
  .strict();
export type ArtifactFileListResponse = z.infer<typeof ArtifactFileListResponse>;
