import { EMPTY_TREE_SNAPSHOT_SHA256 } from "@agent-paste/contracts";
import { createdByFromActor } from "../../created-by.js";
import { createId } from "../../id.js";
import {
  DEFAULT_UPLOAD_SESSION_TTL_MS,
  ephemeralArtifactTtlSeconds,
  isEphemeralWorkspace,
  type UsagePolicyConfig,
} from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import { toUploadSessionRecord } from "../../transforms.js";
import type { ApiActor, StoredFile, UploadSession } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import type { PersistentHostingRepository } from "../persistent-hosting-repository.js";
import type { Entities } from "../ports.js";
import type { CreateUploadSessionRequest } from "../upload-session-lifecycle.js";
import { insertGuardedBatch } from "./guarded-upload-batch.js";
import { checkStorageGrowth, storageUsageInEntities } from "./storage-usage-workflow.js";

export function requirePending(session: UploadSession | null, now: string): UploadSession {
  if (!session) repositoryError("upload_session_not_found");
  if (Date.parse(session.expires_at) <= Date.parse(now) || session.status !== "pending")
    repositoryError("upload_session_expired");
  return session;
}
export async function sessionRecord(e: Entities, s: UploadSession, files?: StoredFile[]) {
  return toUploadSessionRecord(
    s,
    files ?? (await e.uploadSessionFiles.listForSession(s.id)),
    await e.persistent.listChunks(s.id),
  );
}
export async function createGuardedSession(
  e: Entities,
  input: {
    actor: ApiActor;
    request: CreateUploadSessionRequest;
    now: string;
    usagePolicy: UsagePolicyConfig;
    workspace: { claimed_at: string | null };
  },
) {
  const { request: r, actor, now, usagePolicy: policy } = input;
  const commit = r.commit;
  if (!commit) throw new Error("guarded create requires commit");
  const artifact = r.artifact_id ? await e.artifacts.findById(r.artifact_id, actor.workspace_id) : null;
  if (r.artifact_id && (!artifact || artifact.status !== "active")) repositoryError("artifact_not_found");
  if (
    !artifact &&
    (commit.guard !== "snapshot" ||
      commit.snapshot?.prefix !== null ||
      commit.snapshot.sha256 !== EMPTY_TREE_SNAPSHOT_SHA256)
  )
    repositoryError("invalid_request");
  if (commit.pin && isEphemeralWorkspace(input.workspace)) repositoryError("forbidden");
  const by = createdByFromActor(actor);
  const s: UploadSession = {
    id: createId("upl"),
    workspace_id: actor.workspace_id,
    artifact_id: artifact?.id ?? createId("art"),
    revision_id: createId("rev"),
    status: "pending",
    title: r.title ?? artifact?.title ?? "untitled",
    entrypoint: r.entrypoint ?? artifact?.entrypoint ?? "index.html",
    artifact_expires_at: new Date(
      Date.parse(now) +
        (isEphemeralWorkspace(input.workspace) ? ephemeralArtifactTtlSeconds(policy) : policy.default_ttl_seconds) *
          1000,
    ).toISOString(),
    file_count: r.files.length,
    size_bytes: r.files.reduce((a, f) => a + f.size_bytes, 0),
    ...by,
    expires_at: new Date(Date.parse(now) + DEFAULT_UPLOAD_SESSION_TTL_MS).toISOString(),
    created_at: now,
    finalized_at: null,
    base_revision_id: null,
    deleted_paths: [],
    commit_guard: commit.guard,
    commit_snapshot_prefix: commit.snapshot?.prefix ?? null,
    commit_snapshot_sha256: commit.snapshot?.sha256 ?? null,
    pin_on_commit: commit.pin ?? false,
    sealed_at: r.more_files ? null : now,
    next_batch_index: 1,
  };
  if (!r.more_files && r.files.length + (r.deletions?.length ?? 0) + (r.prefix_deletions?.length ?? 0) === 0)
    repositoryError("invalid_request");
  await e.uploadSessions.insert(s);
  const files = await insertGuardedBatch(e, s, r, 0, now, policy);
  return sessionRecord(e, s, files);
}
export function appendUploadFiles(
  ctx: RepositoryCoreContext,
  input: Parameters<PersistentHostingRepository["appendUploadFiles"]>[0],
) {
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "upload.session.append",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now: input.now,
    },
    async (e) => {
      await e.persistent.lockWorkspace(input.actor.workspace_id);
      const s = requirePending(await e.uploadSessions.findById(input.sessionId, input.actor.workspace_id), input.now);
      if (!s.commit_guard || s.sealed_at || input.request.batch_index !== (s.next_batch_index ?? 1))
        repositoryError("invalid_request", { details: { expected_batch_index: s.next_batch_index ?? 1 } });
      const before = await storageUsageInEntities(ctx, e, s.workspace_id, input.now);
      const ws = await ctx.mustWorkspace(e, s.workspace_id);
      const files = await insertGuardedBatch(
        e,
        s,
        input.request,
        input.request.batch_index,
        input.now,
        ctx.usagePolicyFor(ws),
      );
      const updated = {
        ...s,
        file_count: s.file_count + files.length,
        size_bytes: s.size_bytes + files.reduce((a, f) => a + f.size_bytes, 0),
        sealed_at: input.request.more_files ? null : input.now,
        next_batch_index: (s.next_batch_index ?? 1) + 1,
      };
      await e.persistent.updateSession(updated);
      checkStorageGrowth(before, await storageUsageInEntities(ctx, e, s.workspace_id, input.now));
      return sessionRecord(e, updated, files);
    },
  );
}
