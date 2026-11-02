import { repositoryError } from "../../repository-error.js";
import type { RevisionReconstructor, StoredFile, UploadSession } from "../../types.js";
import { RevisionReconstructionConflict } from "../../types.js";
import { contentTypeForPath } from "../../validation.js";
// Validate the patched files against the base tree and reconstruct each result blob
// (ADR 0089 Stage 4). The diff base must match the base Revision's file (defense before
// the applier re-checks the hash); a patch that cannot apply throws an agent-visible
// conflict, failing finalize so a broken revision never reaches draft. Returns a blob
// StoredFile per patched path to replace the diff placeholder in the merged tree.
export async function reconstructPatchedFiles(input: {
  session: UploadSession;
  sessionFiles: StoredFile[];
  baseFiles: Map<string, StoredFile>;
  reconstructor: RevisionReconstructor | undefined;
  maxResultBytes?: number;
}): Promise<Map<string, StoredFile>> {
  const { session, sessionFiles, baseFiles } = input;
  const requests: Array<{ path: string; diffObjectKey: string; baseSha256: string; resultSha256: string }> = [];
  for (const file of sessionFiles) {
    if (!file.patch_base_sha256 || !file.patch_result_sha256) {
      continue;
    }
    const baseFile = baseFiles.get(file.path);
    if (!baseFile || baseFile.sha256 !== file.patch_base_sha256) {
      repositoryError("patch_base_mismatch");
    }
    requests.push({
      path: file.path,
      diffObjectKey: file.r2_key,
      baseSha256: file.patch_base_sha256,
      resultSha256: file.patch_result_sha256,
    });
  }
  const reconstructed = new Map<string, StoredFile>();
  if (requests.length === 0) {
    return reconstructed;
  }
  if (!input.reconstructor) {
    // The capability is wired in every real worker (upload) + the local harness; its
    // absence is an infra/config failure, not an agent error.
    repositoryError("storage_unavailable");
  }
  let result: Awaited<ReturnType<RevisionReconstructor["reconstruct"]>>;
  try {
    result = await input.reconstructor.reconstruct({
      workspaceId: session.workspace_id,
      files: requests,
      ...(input.maxResultBytes === undefined ? {} : { maxResultBytes: input.maxResultBytes }),
    });
  } catch (error) {
    // A patch that cannot apply is an agent-fixable conflict carrying the path + reason
    // in the message; any other failure (R2/decrypt/ring) is infra and stays retryable.
    if (error instanceof RevisionReconstructionConflict) {
      repositoryError("patch_conflict", { cause: error });
    }
    throw error;
  }
  const bySha = new Map(sessionFiles.filter((f) => f.patch_result_sha256).map((f) => [f.path, f]));
  for (const file of result.files) {
    const source = bySha.get(file.path);
    reconstructed.set(file.path, {
      workspace_id: session.workspace_id,
      artifact_id: session.artifact_id,
      revision_id: session.revision_id,
      upload_session_id: session.id,
      path: file.path,
      size_bytes: file.sizeBytes,
      content_type: source?.content_type ?? contentTypeForPath(file.path),
      r2_key: file.r2Key,
      sha256: file.sha256,
      storage_kind: "blob",
      uploaded_at: session.finalized_at,
    });
  }
  return reconstructed;
}
