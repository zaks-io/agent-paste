import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { repositoryError } from "../../repository-error.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import type { PersistentHostingRepository } from "../persistent-hosting-repository.js";
import { requirePending } from "./guarded-session-workflow.js";

export async function recordUploadedChunk(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["recordUploadedChunk"]>[0],
) {
  await ctx.uow.command(
    {
      actor: { type: "system", id: "upload", workspaceId: i.workspaceId },
      operation: "upload.chunk.record",
      idempotencyKey: `${i.sessionId}:${i.path}:${i.chunkIndex}`,
      scope: workspaceScope(i.workspaceId),
      now: i.uploadedAt,
    },
    async (e) => {
      await e.persistent.lockWorkspace(i.workspaceId);
      const s = requirePending(await e.uploadSessions.findById(i.sessionId, i.workspaceId), i.uploadedAt);
      if (!s.commit_guard) repositoryError("invalid_request");
      const chunk = (await e.persistent.listChunks(s.id, i.path)).find((c) => c.chunk_index === i.chunkIndex);
      if (
        !chunk ||
        chunk.sha256 !== i.sha256 ||
        chunk.size_bytes !== i.sizeBytes ||
        i.objectKey !== workspaceBlobObjectKeyFor({ workspaceId: i.workspaceId, sha256: i.sha256 })
      )
        repositoryError("invalid_request");
      await e.contentBlobs.upsert({
        workspace_id: i.workspaceId,
        sha256: i.sha256,
        size_bytes: i.sizeBytes,
        r2_key: i.objectKey,
        content_format: "single",
        r2_cleanup_eligible: i.r2CleanupEligible ?? true,
        created_at: i.uploadedAt,
        updated_at: i.uploadedAt,
      });
      await e.persistent.markChunkUploaded(s.id, i.path, i.chunkIndex, i.uploadedAt);
      return null;
    },
  );
}
export function getChunkedFileForCompletion(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["getChunkedFileForCompletion"]>[0],
) {
  return ctx.uow.read(workspaceScope(i.actor.workspace_id), async (e) => {
    const s = await e.uploadSessions.findById(i.sessionId, i.actor.workspace_id);
    if (!s) return null;
    if (s.status === "expired" || Date.parse(s.expires_at) <= Date.now()) repositoryError("upload_session_expired");
    const f = (await e.uploadSessionFiles.listForSession(s.id)).find((f) => f.path === i.path);
    if (!f || f.content_format !== "chunked-v1" || !f.sha256) return null;
    const chunks = await e.persistent.listChunks(s.id, f.path);
    return {
      sizeBytes: f.size_bytes,
      sha256: f.sha256,
      verifiedAt: f.verified_at ?? null,
      chunks: chunks.map((c) => ({ sha256: c.sha256, sizeBytes: c.size_bytes, uploaded: !!c.uploaded_at })),
    };
  });
}
export async function recordChunkedFileVerified(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["recordChunkedFileVerified"]>[0],
) {
  await ctx.uow.command(
    {
      actor: workspaceCommandActor(i.actor),
      operation: "upload.file.verify",
      idempotencyKey: `${i.sessionId}:${i.path}`,
      scope: workspaceScope(i.actor.workspace_id),
      now: i.now,
    },
    async (e) => {
      await e.persistent.lockWorkspace(i.actor.workspace_id);
      const s = requirePending(await e.uploadSessions.findById(i.sessionId, i.actor.workspace_id), i.now);
      const f = (await e.uploadSessionFiles.listForSession(s.id)).find((f) => f.path === i.path);
      if (!f || f.content_format !== "chunked-v1" || !f.sha256) repositoryError("invalid_request");
      if (f.verified_at) return null;
      const chunks = await e.persistent.listChunks(s.id, f.path);
      if (!chunks.length || chunks.some((c) => !c.uploaded_at)) repositoryError("upload_incomplete");
      await e.contentBlobs.upsert({
        workspace_id: s.workspace_id,
        sha256: f.sha256,
        size_bytes: f.size_bytes,
        r2_key: f.r2_key,
        content_format: "chunked-v1",
        created_at: i.now,
        updated_at: i.now,
      });
      await e.persistent.insertBlobChunks(
        chunks.map((c) => ({
          workspace_id: s.workspace_id,
          sha256: f.sha256 as string,
          size_bytes: f.size_bytes,
          chunk_index: c.chunk_index,
          chunk_sha256: c.sha256,
          chunk_size_bytes: c.size_bytes,
        })),
      );
      await e.persistent.updateFile(s.id, { ...f, uploaded_at: i.now, verified_at: i.now });
      return null;
    },
  );
}

export function completeUploadFiles(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["completeUploadFiles"]>[0],
) {
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(i.actor),
      operation: "upload.files.complete",
      idempotencyKey: i.idempotencyKey,
      scope: workspaceScope(i.actor.workspace_id),
      now: i.now,
    },
    async (e) => {
      await e.persistent.lockWorkspace(i.actor.workspace_id);
      const s = await e.uploadSessions.findById(i.sessionId, i.actor.workspace_id);
      if (!s) repositoryError("upload_session_not_found");
      if (s.status === "expired" || Date.parse(s.expires_at) <= Date.parse(i.now))
        repositoryError("upload_session_expired");
      const stored = new Map((await e.uploadSessionFiles.listForSession(s.id)).map((f) => [f.path, f]));
      const files = [...new Set(i.paths)].map((path) => {
        const f = stored.get(path);
        if (!f || f.content_format !== "chunked-v1" || !f.sha256 || !f.verified_at)
          repositoryError("upload_incomplete");
        return {
          path: path as import("@agent-paste/contracts").FilePath,
          status: "verified" as const,
          sha256: f.sha256,
          size_bytes: f.size_bytes,
        };
      });
      return { upload_session_id: s.id as import("@agent-paste/contracts").UploadSessionId, files };
    },
  );
}
