import { BundleAvailability } from "./bundle.js";
import { Mebibytes } from "./common.js";
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
  size_bytes: z.number().int().nonnegative().max(Mebibytes.twentyFive),
});
export type UploadSessionFileInput = z.infer<typeof UploadSessionFileInput>;

// TTL is a server-side policy decision derived from the workspace tier, never a
// client input. Clients (CLI, MCP) cannot request or influence artifact lifetime.
export const CreateUploadSessionRequest = z.object({
  artifact_id: ArtifactId.optional(),
  title: PlainTextTitle,
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
  files: z.array(SignedUploadTarget).max(100),
});
export type CreateUploadSessionResponse = z.infer<typeof CreateUploadSessionResponse>;

export const PublishResult = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  title: PlainTextTitle,
  artifact_url: UrlString,
  revision_content_url: UrlString,
  agent_view_url: UrlString,
  expires_at: IsoDateTime,
  bundle: BundleAvailability,
});
export type PublishResult = z.infer<typeof PublishResult>;

export const FinalizeUploadSessionResponse = z.object({
  upload_session_id: UploadSessionId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  status: z.literal("draft"),
  title: PlainTextTitle,
  entrypoint: FilePath,
  file_count: z.number().int().min(1),
  size_bytes: z.number().int().nonnegative(),
});
export type FinalizeUploadSessionResponse = z.infer<typeof FinalizeUploadSessionResponse>;
