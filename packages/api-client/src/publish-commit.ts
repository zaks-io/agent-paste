import { type ArtifactId, FilePath, type UploadSessionId } from "@agent-paste/contracts/primitives";
import type {
  AppendUploadFilesRequest,
  CreateUploadSessionRequest,
  SignedUploadTarget,
  UploadSessionFileInput,
} from "@agent-paste/contracts/upload-sessions";
import { isExpiredTarget, uploadTargets } from "./chunked-upload.js";
import type { LocalSource, PublishOutcome, PublishTransport, UploadStats } from "./publish.js";
import type { PublishPlan, PublishPlanInput } from "./publish-plan.js";
import { digestBytes, operationKey, transferRetry } from "./transfer-retry.js";
export function fileEntry(source: LocalSource): UploadSessionFileInput {
  return {
    path: FilePath.parse(source.path),
    size_bytes: source.sizeBytes,
    ...(source.expect ? { expect: source.expect } : {}),
    ...(source.patch
      ? {
          patch: {
            base_sha256: source.patch.baseSha256,
            result_sha256: source.patch.resultSha256,
            format: "unified" as const,
          },
        }
      : { sha256: source.sha256 }),
    ...(source.chunkSha256 ? { chunks: { chunk_bytes: 4194304 as const, sha256: source.chunkSha256 } } : {}),
  };
}
export function publishBatches(plan: PublishPlan): Omit<AppendUploadFilesRequest, "batch_index" | "more_files">[] {
  const entries = [
    ...plan.upserts.map((f) => ({ kind: "files" as const, value: fileEntry(f) })),
    ...plan.deletions.map((d) => ({ kind: "deletions" as const, value: d })),
    ...plan.prefixDeletions.map((d) => ({ kind: "prefix_deletions" as const, value: d })),
  ];
  const batches: Omit<AppendUploadFilesRequest, "batch_index" | "more_files">[] = [];
  let batch: (typeof batches)[number] = { files: [], deletions: [], prefix_deletions: [] };
  let count = 0;
  for (const entry of entries) {
    if (count === 1000 || (entry.kind === "prefix_deletions" && batch.prefix_deletions?.length === 100)) {
      batches.push(batch);
      batch = { files: [], deletions: [], prefix_deletions: [] };
      count = 0;
    }
    if (entry.kind === "files") batch.files.push(entry.value);
    if (entry.kind === "deletions") batch.deletions?.push(entry.value);
    if (entry.kind === "prefix_deletions") batch.prefix_deletions?.push(entry.value);
    count++;
  }
  if (count || !batches.length) batches.push(batch);
  return batches.map(({ files, deletions, prefix_deletions }) => ({
    files,
    ...(deletions?.length ? { deletions } : {}),
    ...(prefix_deletions?.length ? { prefix_deletions } : {}),
  }));
}
export async function publishPlanFingerprint(plan: PublishPlan, input: PublishPlanInput): Promise<string> {
  return digestBytes(
    new TextEncoder().encode(
      JSON.stringify({
        artifact: input.artifactId,
        title: input.title,
        entrypoint: input.entrypoint,
        commit: plan.commit,
        batches: publishBatches(plan),
      }),
    ),
  );
}
export async function executePublish(
  t: PublishTransport,
  plan: PublishPlan,
  input: PublishPlanInput,
): Promise<PublishOutcome> {
  if (input.dryRun) throw new Error("Cannot execute a dry-run plan");
  if (plan.noChange) {
    if (!input.artifactId || !plan.headRevisionId || !t.getAgentView)
      throw new Error("No-change result requires an existing Revision and Agent View transport");
    const view = await transferRetry(() => t.getAgentView!(input.artifactId!, plan.headRevisionId!));
    if (view.revision_id !== plan.headRevisionId) throw new Error("revision_changed_in_no_change_result");
    const totalBytes = input.sources.reduce((n, file) => n + file.sizeBytes, 0);
    return {
      url: view.url,
      title: view.title,
      expiresAt: view.expires_at,
      noChange: true,
      result: {
        artifact_id: view.artifact_id,
        revision_id: view.revision_id,
        title: view.title,
        url: view.url,
        expires_at: view.expires_at,
      },
      uploadStats: {
        totalFiles: input.sources.length,
        totalBytes,
        uploadedFiles: 0,
        uploadedBytes: 0,
        reusedFiles: input.sources.length,
        reusedBytes: totalBytes,
      },
    };
  }
  const batches = publishBatches(plan);
  const fingerprint = await publishPlanFingerprint(plan, input);
  if (input.state && input.state.planFingerprint !== fingerprint)
    throw new Error("local_file_changed: saved transfer plan differs; finish or discard that transfer explicitly");
  const baseKey = input.state?.idempotencyKey ?? input.idempotencyKey;
  const first = batches[0]!;
  const empty = first.files.length + (first.deletions?.length ?? 0) + (first.prefix_deletions?.length ?? 0) === 0;
  // Empty metadata/pin commits seal with a final empty append, as required by create.
  if (empty) batches.push({ files: [] });
  const body: CreateUploadSessionRequest = {
    ...first,
    title: input.title,
    entrypoint: FilePath.parse(input.entrypoint),
    commit: plan.commit,
    more_files: batches.length > 1,
    ...(input.artifactId ? { artifact_id: input.artifactId } : {}),
  };
  const session = await transferRetry(() => t.createUploadSession(body, baseKey as PublishPlanInput["idempotencyKey"]));
  if (input.state && input.state.sessionId !== session.upload_session_id) throw new Error("transfer_session_changed");
  await input.saveState?.({
    sessionId: session.upload_session_id,
    artifactId: session.artifact_id,
    revisionId: session.revision_id,
    idempotencyKey: baseKey,
    planFingerprint: fingerprint,
  });
  const stats: UploadStats = {
    totalFiles: plan.upserts.length,
    totalBytes: plan.bytesToSendMax,
    uploadedFiles: 0,
    uploadedBytes: 0,
    reusedFiles: 0,
    reusedBytes: 0,
  };
  // Always replay ordered batches with their original keys. A crash after the server
  // accepted an append but before saving locally cannot skip or duplicate a batch.
  let targets: SignedUploadTarget[] = session.files;
  const put = async (items: SignedUploadTarget[]) => {
    try {
      await uploadTargets(t, session.upload_session_id, plan.upserts, items, stats, baseKey, input.onProgress);
    } catch (error) {
      if (!isExpiredTarget(error) || !t.targets) throw error;
    }
  };
  if (!t.targets) await put(targets);
  for (let index = 1; index < batches.length; index++) {
    const appendFiles = t.appendFiles;
    if (!appendFiles) throw new Error("Batch transport is required");
    const key = await operationKey(baseKey, `b${index}`);
    const result = await transferRetry(() =>
      appendFiles(
        session.upload_session_id,
        { ...batches[index]!, batch_index: index, more_files: index < batches.length - 1 },
        key,
      ),
    );
    targets = result.files;
    if (!t.targets) await put(targets);
  }
  if (t.targets) await drainTargets(t, session.upload_session_id, put);
  const finalKey = await operationKey(baseKey, "f");
  const finalized = await transferRetry(() => t.finalize(session.upload_session_id as UploadSessionId, finalKey));
  const result = await transferRetry(() =>
    t.publishRevision(finalized.artifact_id as ArtifactId, finalized.revision_id, finalKey, {
      include_retention: true,
    }),
  );
  stats.reusedBytes = Math.max(0, stats.totalBytes - stats.uploadedBytes);
  stats.reusedFiles = Math.max(0, stats.totalFiles - stats.uploadedFiles);
  return { url: result.url, title: result.title, expiresAt: result.expires_at, result, uploadStats: stats };
}

async function drainTargets(
  t: PublishTransport,
  id: UploadSessionId,
  put: (targets: SignedUploadTarget[]) => Promise<void>,
): Promise<void> {
  const targets = t.targets;
  if (!targets) throw new Error("Targets transport is required");
  // Enumerate before mutating: offset/cursor pages can otherwise skip targets
  // whose preceding entries disappeared after a successful PUT.
  for (let round = 0; round <= 5; round++) {
    const outstanding: SignedUploadTarget[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await transferRetry(() => targets(id, { ...(cursor ? { cursor } : {}), limit: 1000 }));
      if (page.status === "expired") throw new Error("upload_session_expired");
      outstanding.push(...page.targets);
      cursor = page.page_info.has_more ? (page.page_info.next_cursor ?? undefined) : undefined;
      if (page.page_info.has_more && (!cursor || seen.has(cursor))) throw new Error("invalid_target_cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (!outstanding.length) return;
    if (round === 5) throw new Error("upload_incomplete");
    await put(outstanding);
  }
}
