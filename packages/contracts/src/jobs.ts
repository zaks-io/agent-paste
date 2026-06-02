import { ArtifactId, RevisionId, WorkspaceId } from "./primitives.js";
import { z } from "./zod.js";

export const BytePurgeReason = z.enum(["deletion", "retention", "upload_cleanup"]);
export type BytePurgeReason = z.infer<typeof BytePurgeReason>;

export const BytePurgeMessage = z.object({
  type: z.literal("byte.purge.v1"),
  workspace_id: WorkspaceId,
  artifact_id: ArtifactId,
  revision_id: RevisionId.nullable(),
  upload_session_id: z.string().nullable(),
  prefixes: z.array(z.string().min(1)).min(1),
  reason: BytePurgeReason,
});
export type BytePurgeMessage = z.infer<typeof BytePurgeMessage>;

export const SafetyScanMessage = z.object({
  type: z.literal("safety.scan.v1"),
  workspace_id: WorkspaceId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  scanner_id: z.string().min(1),
  scanner_version: z.string().min(1),
  requested_at: z.string().datetime(),
});
export type SafetyScanMessage = z.infer<typeof SafetyScanMessage>;

export const DEFAULT_SAFETY_SCANNER_ID = "builtin_content";
export const DEFAULT_SAFETY_SCANNER_VERSION = "1";

/** Async scanner for unclaimed ephemeral tiers (Llama Guard 3 + URL Scanner). */
export const EPHEMERAL_SAFETY_SCANNER_ID = "ephemeral_tier";
export const EPHEMERAL_SAFETY_SCANNER_VERSION = "1";

export const BundleGenerateReason = z.enum(["publish"]);
export type BundleGenerateReason = z.infer<typeof BundleGenerateReason>;

export const BundleGenerateMessage = z.object({
  type: z.literal("bundle.generate.v1"),
  workspace_id: WorkspaceId,
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  requested_at: z.string().datetime(),
  reason: BundleGenerateReason,
});
export type BundleGenerateMessage = z.infer<typeof BundleGenerateMessage>;

export const JobsQueueMessage = z.discriminatedUnion("type", [
  BytePurgeMessage,
  SafetyScanMessage,
  BundleGenerateMessage,
]);
export type JobsQueueMessage = z.infer<typeof JobsQueueMessage>;

export function parseJobsQueueMessage(body: unknown): JobsQueueMessage {
  return JobsQueueMessage.parse(body);
}
