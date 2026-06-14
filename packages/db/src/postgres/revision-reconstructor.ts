import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  applyUnifiedDiff,
  readRevisionFileObjectBytes,
  readWorkspaceBlobBytes,
  type WorkspaceBlobR2,
  writeWorkspaceBlob,
} from "@agent-paste/storage";
import { RevisionReconstructionConflict, type RevisionReconstructor } from "../types.js";

// ADR 0087 Stage 4: builds the reconstructor that applies an agent-uploaded unified diff
// to a base blob and stores the whole result as an ordinary content-addressed blob,
// SYNCHRONOUSLY at finalize and BEFORE the new Revision commits. A clean patch yields a
// blob the rest of the system treats like any other; a patch that cannot apply throws an
// agent-visible conflict (failing the same finalize call), so a broken revision never
// reaches draft, let alone published. Infra failures (missing ring/R2, decrypt errors)
// propagate as-is and the db layer maps them to a retryable error, never a conflict.
export function revisionReconstructorFromEnv(env: {
  ARTIFACTS?: WorkspaceBlobR2;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
}): RevisionReconstructor | undefined {
  const ring = artifactBytesEncryptionRingFromEnv(env);
  const artifacts = env.ARTIFACTS;
  if (!ring || !artifacts) {
    return undefined;
  }
  return {
    async reconstruct(input) {
      // Apply + hash-verify EVERY patched file before any PUT, so a multi-file batch
      // with one conflict writes zero blobs (no orphaned partial results).
      const applied: Array<{ path: string; sha256: string; resultBytes: Uint8Array }> = [];
      for (const file of input.files) {
        const baseBytes = await readWorkspaceBlobBytes({
          r2: artifacts,
          workspaceId: input.workspaceId,
          sha256: file.baseSha256,
          ring,
        });
        const diffBytes = await readRevisionFileObjectBytes({
          r2: artifacts,
          objectKey: file.diffObjectKey,
          workspaceId: input.workspaceId,
          ring,
        });
        const result = await applyUnifiedDiff({
          baseBytes,
          diffBytes,
          expectedBaseSha256: file.baseSha256,
          expectedResultSha256: file.resultSha256,
        });
        if (!result.ok) {
          throw new RevisionReconstructionConflict(file.path, result.reason);
        }
        applied.push({ path: file.path, sha256: file.resultSha256, resultBytes: result.result });
      }

      const files: Array<{ path: string; sha256: string; r2Key: string; sizeBytes: number }> = [];
      for (const entry of applied) {
        const written = await writeWorkspaceBlob({
          r2: artifacts,
          workspaceId: input.workspaceId,
          sha256: entry.sha256,
          plaintext: entry.resultBytes,
          ring,
        });
        files.push({
          path: entry.path,
          sha256: entry.sha256,
          r2Key: written.key,
          sizeBytes: entry.resultBytes.byteLength,
        });
      }
      return { files };
    },
  };
}
