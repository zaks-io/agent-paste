import { z } from "zod";
import { UploadSessionStatus } from "./enums.js";
import { ArtifactId, FilePath, IsoDateTime, RevisionId, Sha256Hex, UploadSessionId, UrlString } from "./primitives.js";

export const UploadSessionFileInput = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative(),
  sha256: Sha256Hex.optional(),
});
export type UploadSessionFileInput = z.infer<typeof UploadSessionFileInput>;

export const CreateUploadSessionRequest = z.object({
  artifact_id: ArtifactId.optional(),
  files: z.array(UploadSessionFileInput).min(1).max(500),
});
export type CreateUploadSessionRequest = z.infer<typeof CreateUploadSessionRequest>;

export const SignedUploadTarget = z.object({
  path: FilePath,
  put_url: UrlString,
  required_headers: z.record(z.string(), z.string()),
  expires_at: IsoDateTime,
});
export type SignedUploadTarget = z.infer<typeof SignedUploadTarget>;

export const CreateUploadSessionResponse = z.object({
  session_id: UploadSessionId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  status: z.literal(UploadSessionStatus.enum.pending),
  expires_at: IsoDateTime,
  files: z.array(SignedUploadTarget),
});
export type CreateUploadSessionResponse = z.infer<typeof CreateUploadSessionResponse>;

export const RefreshUploadUrlRequest = z.object({
  path: FilePath,
});
export type RefreshUploadUrlRequest = z.infer<typeof RefreshUploadUrlRequest>;

export const RefreshUploadUrlResponse = z.object({
  file: SignedUploadTarget,
});
export type RefreshUploadUrlResponse = z.infer<typeof RefreshUploadUrlResponse>;

export const FinalizeUploadSessionResponse = z.object({
  session_id: UploadSessionId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  status: z.literal(UploadSessionStatus.enum.finalized),
  file_count: z.number().int().positive(),
  size_bytes: z.number().int().nonnegative(),
  finalized_at: IsoDateTime,
});
export type FinalizeUploadSessionResponse = z.infer<typeof FinalizeUploadSessionResponse>;

export const AbandonUploadSessionResponse = z.object({
  session_id: UploadSessionId,
  status: z.literal(UploadSessionStatus.enum.abandoned),
  abandoned_at: IsoDateTime,
});
export type AbandonUploadSessionResponse = z.infer<typeof AbandonUploadSessionResponse>;
