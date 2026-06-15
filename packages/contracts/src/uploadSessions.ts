import { BundleAvailability } from "./bundle.js";
import { Mebibytes } from "./common.js";
import { UploadSessionStatus } from "./enums.js";
import {
  ArtifactId,
  FilePath,
  IsoDateTime,
  PlainTextTitle,
  RevisionId,
  Sha256Hex,
  UploadSessionId,
  UrlString,
} from "./primitives.js";
import { RenderMode } from "./revisions.js";
import { z } from "./zod.js";

// Re-exported from primitives so existing importers (@agent-paste/contracts
// Sha256Hex) keep working; agentView.ts and artifacts.ts also need it.
export { Sha256Hex } from "./primitives.js";

// A changed file may arrive as a patch against a base Revision's file (ADR 0089)
// instead of whole bytes. When present, the bytes uploaded for this file entry are
// the diff (so the entry's size_bytes/sha256 describe the diff), base_sha256 is the
// digest of the file in the base Revision the diff applies to, and result_sha256 is
// the digest of the whole reconstructed file the server must produce and verify.
// Only the unified-diff text format is supported; binary changes upload whole bytes.
export const UploadSessionFilePatch = z.object({
  base_sha256: Sha256Hex,
  format: z.literal("unified"),
  result_sha256: Sha256Hex,
});
export type UploadSessionFilePatch = z.infer<typeof UploadSessionFilePatch>;

export const UploadSessionFileInput = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative().max(Mebibytes.twentyFive),
  sha256: Sha256Hex.optional(),
  patch: UploadSessionFilePatch.optional(),
});
export type UploadSessionFileInput = z.infer<typeof UploadSessionFileInput>;

// TTL is a server-side policy decision derived from the workspace tier, never a
// client input. Clients (CLI, MCP) cannot request or influence artifact lifetime.
// render_mode is an explicit client override; when absent the server infers it
// from the entrypoint extension at publish time.
// base_revision_id turns this into a partial-manifest publish (ADR 0089): files
// lists only changed/added paths, deleted_paths drops paths, and every other path
// inherits from the base Revision by reference. deleted_paths and per-file patches
// are only meaningful against a base. Structural checks live here; the stateful
// checks and the tree-inheritance merge (base is a published Revision in the same
// workspace/artifact, only blob-backed paths inherit, deleted path exists in the
// base, patch base_sha256 matches the base file) run server-side at finalize.
export const CreateUploadSessionRequest = z
  .object({
    artifact_id: ArtifactId.optional(),
    base_revision_id: RevisionId.optional(),
    title: PlainTextTitle,
    entrypoint: FilePath,
    render_mode: RenderMode.optional(),
    deleted_paths: z.array(FilePath).max(100).optional(),
    // A whole publish needs at least one file; a partial-manifest delta against a base
    // may send zero files (a delete-only revise inherits the rest), so the min(1) check
    // is conditional and lives in the superRefine below, not on the array.
    files: z.array(UploadSessionFileInput).max(100),
  })
  .superRefine((request, ctx) => {
    if (request.base_revision_id === undefined) {
      if (request.files.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files"],
          message: "files must contain at least one entry without base_revision_id",
        });
      }
      if (request.deleted_paths !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deleted_paths"],
          message: "deleted_paths requires base_revision_id",
        });
      }
      const patchedIndex = request.files.findIndex((file) => file.patch !== undefined);
      if (patchedIndex !== -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", patchedIndex, "patch"],
          message: "patch requires base_revision_id",
        });
      }
    } else if (request.files.length === 0 && (request.deleted_paths?.length ?? 0) === 0) {
      // A partial-manifest delta must change something: zero files AND zero deletions
      // would commit a Revision identical to its base, which is a client mistake.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "a base_revision_id delta needs at least one changed file or deleted path",
      });
    }
    const deleted = new Set(request.deleted_paths ?? []);
    if (deleted.size !== (request.deleted_paths?.length ?? 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deleted_paths"],
        message: "deleted_paths must be unique",
      });
    }
    request.files.forEach((file, index) => {
      if (deleted.has(file.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "path"],
          message: "a path cannot be both uploaded and deleted",
        });
      }
      // A patch carries the diff's own digest; a whole-file sha256 on the same
      // entry is contradictory (the bytes are a diff, not the content-addressed
      // file), so reject it rather than silently dropping one.
      if (file.patch !== undefined && file.sha256 !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "sha256"],
          message: "a patched file cannot also declare a whole-file sha256",
        });
      }
    });
  });
export type CreateUploadSessionRequest = z.infer<typeof CreateUploadSessionRequest>;

export const UploadRequiredTarget = z.object({
  status: z.literal("upload_required"),
  path: FilePath,
  put_url: UrlString,
  required_headers: z.record(z.string(), z.string()),
  expires_at: IsoDateTime,
});
export type UploadRequiredTarget = z.infer<typeof UploadRequiredTarget>;

export const ReusedUploadTarget = z.object({
  status: z.literal("reused"),
  path: FilePath,
});
export type ReusedUploadTarget = z.infer<typeof ReusedUploadTarget>;

export const SignedUploadTarget = z.discriminatedUnion("status", [UploadRequiredTarget, ReusedUploadTarget]);
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
  // The PRIVATE viewer link a publish returns: a login-walled clean viewer for
  // the owning workspace member (`/v/<artifactId>`), the only link publish emits.
  // Unlisted sharing is a separate, explicit visibility step that mints a
  // revocable Share Link.
  private_url: UrlString,
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
