import {
  MAX_CHUNKS_PER_FILE,
  UPLOAD_BATCH_MAX_DELETIONS,
  UPLOAD_BATCH_MAX_FILES,
  UPLOAD_TARGETS_PAGE_MAX,
} from "@agent-paste/config";
import * as z from "zod";
import { PageInfo } from "./common.js";
import {
  ArtifactId,
  ArtifactReference,
  FilePath,
  IsoDateTime,
  PlainTextTitle,
  RevisionId,
  Sha256Hex,
  UploadSessionId,
  UrlString,
} from "./primitives.js";
import { Retention } from "./retention.js";
import { refineLegacyCreate, refineUploadBatch } from "./upload-guards.js";
import { CommitSpec, UploadDeletion, UploadPrefixDeletion, UploadSessionFileInput } from "./upload-session-inputs.js";

export { Sha256Hex } from "./primitives.js";

export * from "./upload-session-inputs.js";

const batchFields = {
  files: z.array(UploadSessionFileInput).max(UPLOAD_BATCH_MAX_FILES),
  deletions: z.array(UploadDeletion).max(UPLOAD_BATCH_MAX_DELETIONS).optional(),
  prefix_deletions: z.array(UploadPrefixDeletion).max(100).optional(),
};

// Preserve stripping of old render_mode inputs on the existing request.
export const CreateUploadSessionRequest = z
  .object({
    artifact_id: ArtifactReference.optional(),
    base_revision_id: RevisionId.optional(),
    title: PlainTextTitle,
    entrypoint: FilePath,
    deleted_paths: z.array(FilePath).max(100).optional(),
    ...batchFields,
    commit: CommitSpec.optional(),
    more_files: z.boolean().optional(),
  })
  .superRefine((request, ctx) => {
    const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
    refineUploadBatch(request, ctx, request.commit, !request.commit);
    if (request.commit) {
      if (request.base_revision_id !== undefined || request.deleted_paths !== undefined)
        issue(["commit"], "commit excludes base_revision_id and deleted_paths");
      if (request.commit.guard === "paths" && !request.artifact_id)
        issue(["artifact_id"], "paths guard requires artifact_id");
      if (!request.artifact_id && (request.commit.guard !== "snapshot" || request.commit.snapshot?.prefix !== null))
        issue(["commit"], "new artifacts require a whole-tree snapshot");
      if (
        request.files.length + (request.deletions?.length ?? 0) + (request.prefix_deletions?.length ?? 0) === 0 &&
        request.more_files !== true
      )
        issue(["files"], "an empty first batch requires more_files");
    } else {
      refineLegacyCreate(request, ctx);
    }
  });
export type CreateUploadSessionRequest = z.infer<typeof CreateUploadSessionRequest>;
export const AppendUploadFilesRequest = z
  .object({
    batch_index: z.number().int().min(1),
    ...batchFields,
    more_files: z.boolean(),
  })
  .strict()
  .superRefine((batch, ctx) => refineUploadBatch(batch, ctx));
export type AppendUploadFilesRequest = z.infer<typeof AppendUploadFilesRequest>;

export const UploadRequiredTarget = z.object({
  status: z.literal("upload_required"),
  path: FilePath,
  put_url: UrlString,
  required_headers: z.record(z.string(), z.string()),
  expires_at: IsoDateTime,
});
export type UploadRequiredTarget = z.infer<typeof UploadRequiredTarget>;
export const ReusedUploadTarget = z.object({ status: z.literal("reused"), path: FilePath });
export type ReusedUploadTarget = z.infer<typeof ReusedUploadTarget>;
export const ChunkUploadTarget = UploadRequiredTarget.extend({
  status: z.literal("chunk_upload_required"),
  chunk_index: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CHUNKS_PER_FILE - 1),
}).strict();
export type ChunkUploadTarget = z.infer<typeof ChunkUploadTarget>;
export const VerifyRequiredTarget = z.object({ status: z.literal("verify_required"), path: FilePath }).strict();
export type VerifyRequiredTarget = z.infer<typeof VerifyRequiredTarget>;
export const SignedUploadTarget = z.discriminatedUnion("status", [
  UploadRequiredTarget,
  ReusedUploadTarget,
  ChunkUploadTarget,
  VerifyRequiredTarget,
]);
export type SignedUploadTarget = z.infer<typeof SignedUploadTarget>;
export const CreateUploadSessionResponse = z.object({
  upload_session_id: UploadSessionId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  status: z.literal("pending"),
  expires_at: IsoDateTime,
  files: z.array(SignedUploadTarget).max(2000),
  sealed: z.boolean().optional(),
  next_batch_index: z.number().int().min(1).optional(),
});
export type CreateUploadSessionResponse = z.infer<typeof CreateUploadSessionResponse>;
export const AppendUploadFilesResponse = z
  .object({
    upload_session_id: UploadSessionId,
    sealed: z.boolean(),
    next_batch_index: z.number().int().min(1),
    files: z.array(SignedUploadTarget).max(2000),
  })
  .strict();
export type AppendUploadFilesResponse = z.infer<typeof AppendUploadFilesResponse>;
export const UploadSessionTargetsResponse = z
  .object({
    upload_session_id: UploadSessionId,
    status: z.enum(["pending", "ready", "finalized", "expired"]),
    sealed: z.boolean(),
    expires_at: IsoDateTime,
    remaining: z
      .object({
        files: z.number().int().nonnegative(),
        chunks: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative(),
        unverified_files: z.number().int().nonnegative(),
      })
      .strict(),
    targets: z
      .array(z.union([UploadRequiredTarget, ChunkUploadTarget, VerifyRequiredTarget]))
      .max(UPLOAD_TARGETS_PAGE_MAX),
    page_info: PageInfo,
  })
  .strict();
export type UploadSessionTargetsResponse = z.infer<typeof UploadSessionTargetsResponse>;
export const CompleteUploadFilesRequest = z.object({ paths: z.array(FilePath).min(1).max(64) }).strict();
export type CompleteUploadFilesRequest = z.infer<typeof CompleteUploadFilesRequest>;
export const CompleteUploadFilesResponse = z
  .object({
    upload_session_id: UploadSessionId,
    files: z
      .array(
        z
          .object({
            path: FilePath,
            status: z.literal("verified"),
            sha256: Sha256Hex,
            size_bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type CompleteUploadFilesResponse = z.infer<typeof CompleteUploadFilesResponse>;

export const PublishResult = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    title: PlainTextTitle,
    url: UrlString,
    expires_at: IsoDateTime,
  })
  .strict();
export type PublishResult = z.infer<typeof PublishResult>;
export const PublishResultV2 = PublishResult.extend({
  revision_number: z.number().int().positive(),
  retention: Retention,
  pinned_at: IsoDateTime.nullable(),
  effective_expires_at: IsoDateTime.nullable(),
  no_change: z.boolean(),
  changes: z
    .object({
      added: z.number().int().nonnegative(),
      changed: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    })
    .strict(),
}).strict();
export type PublishResultV2 = z.infer<typeof PublishResultV2>;
export const PublishRevisionResponse = z.union([PublishResult, PublishResultV2]);
export type PublishRevisionResponse = z.infer<typeof PublishRevisionResponse>;
export const DraftUploadSessionResponse = z.object({
  upload_session_id: UploadSessionId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  status: z.literal("draft"),
  title: PlainTextTitle,
  entrypoint: FilePath,
  file_count: z.number().int().min(1),
  size_bytes: z.number().int().nonnegative(),
});
export const ReadyUploadSessionResponse = z
  .object({
    status: z.literal("ready"),
    upload_session_id: UploadSessionId,
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    file_count: z.number().int().nonnegative(),
    deletion_count: z.number().int().nonnegative(),
  })
  .strict();
export const FinalizeUploadSessionResponse = z.discriminatedUnion("status", [
  DraftUploadSessionResponse,
  ReadyUploadSessionResponse,
]);
export type FinalizeUploadSessionResponse = z.infer<typeof FinalizeUploadSessionResponse>;
