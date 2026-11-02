import { SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import type { UsagePolicyConfig } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import type { RevisionReconstructor, UploadSession } from "../../types.js";
import type { Entities } from "../ports.js";
import { reconstructPatchedFiles } from "./upload-patch-workflow.js";
export async function finalizeGuardedSession(
  entities: Entities,
  session: UploadSession,
  input: {
    now: string;
    resolveUsagePolicy: () => Promise<UsagePolicyConfig>;
    revisionReconstructor?: RevisionReconstructor;
  },
) {
  if (session.status !== "ready" && session.status !== "finalized") {
    if (session.status !== "pending" || Date.parse(session.expires_at) <= Date.parse(input.now))
      repositoryError("upload_session_expired");
    if (!session.sealed_at) repositoryError("invalid_request");
    const files = await entities.uploadSessionFiles.listForSession(session.id);
    if (files.some((f) => (f.content_format === "chunked-v1" ? !f.verified_at : !f.uploaded_at)))
      repositoryError("upload_incomplete");
    const baseFiles = new Map(
      files.map((f) => [f.path, { ...f, sha256: f.expect_sha256 ?? null, size_bytes: f.expect_size_bytes ?? 0 }]),
    );
    const reconstructed = await reconstructPatchedFiles({
      session,
      sessionFiles: files,
      baseFiles,
      reconstructor: input.revisionReconstructor,
      maxResultBytes: SINGLE_PUT_MAX_BYTES,
    });
    const policy = await input.resolveUsagePolicy();
    for (const [path, result] of reconstructed) {
      if (result.size_bytes > Math.min(policy.file_size_cap_bytes, SINGLE_PUT_MAX_BYTES))
        repositoryError("file_size_cap_exceeded");
      const source = files.find((f) => f.path === path);
      if (!source) throw new Error("missing patched source");
      await entities.contentBlobs.upsert({
        workspace_id: session.workspace_id,
        sha256: result.sha256 as string,
        size_bytes: result.size_bytes,
        r2_key: result.r2_key,
        created_at: input.now,
        updated_at: input.now,
      });
      await entities.persistent.updateFile(session.id, {
        ...source,
        ...result,
        uploaded_at: input.now,
        verified_at: input.now,
        patch_base_sha256: null,
        patch_result_sha256: null,
      });
    }
    await entities.persistent.updateSession({ ...session, status: "ready" });
  }
  const deletions = await entities.persistent.listDeletions(session.id);
  return {
    status: "ready" as const,
    upload_session_id: session.id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    file_count: session.file_count,
    deletion_count: deletions.length,
  };
}
