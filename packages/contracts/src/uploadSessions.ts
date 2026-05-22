import { Mebibytes, Seconds } from "./common.js";
import { UploadSessionStatus } from "./enums.js";
import {
  ArtifactId,
  FilePath,
  IsoDateTime,
  PlainTextTitle,
  RevisionId,
  UploadSessionId,
  UrlString,
} from "./primitives.js";
import { z } from "./zod.js";

export const UploadSessionFileInput = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative().max(Mebibytes.ten),
});
export type UploadSessionFileInput = z.infer<typeof UploadSessionFileInput>;

export const CreateUploadSessionRequest = z.object({
  title: PlainTextTitle,
  ttl_seconds: z.number().int().min(Seconds.oneDay).max(Seconds.ninetyDays).default(Seconds.thirtyDays),
  entrypoint: FilePath,
  files: z.array(UploadSessionFileInput).min(1).max(100),
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
  upload_session_id: UploadSessionId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  status: z.literal(UploadSessionStatus.enum.pending),
  expires_at: IsoDateTime,
  files: z.array(SignedUploadTarget),
});
export type CreateUploadSessionResponse = z.infer<typeof CreateUploadSessionResponse>;

export const PublishResult = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  title: PlainTextTitle,
  view_url: UrlString,
  agent_view_url: UrlString,
  expires_at: IsoDateTime,
});
export type PublishResult = z.infer<typeof PublishResult>;

export const FinalizeUploadSessionResponse = PublishResult;
export type FinalizeUploadSessionResponse = z.infer<typeof FinalizeUploadSessionResponse>;
