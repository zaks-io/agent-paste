import type { ArtifactFileListItem } from "@agent-paste/contracts/artifact-files";
import type { RevisionReadGrant } from "@agent-paste/contracts/read-grants";
import type { PullInput, PullPlan, PullStore, PullTransport } from "./pull-plan.js";
import { errorFields, runConcurrent, transferRetry } from "./transfer-retry.js";
export async function pullFiles(
  t: PullTransport,
  store: PullStore,
  plan: PullPlan,
  input: PullInput,
): Promise<{ revision_id: string; downloaded: number; skipped: number }> {
  if (plan.conflicts.length)
    throw Object.assign(new Error(`Local files differ; pass --overwrite: ${plan.conflicts.join(", ")}`), {
      code: "local_conflict",
      details: { paths: plan.conflicts },
    });
  if (input.dryRun) return { revision_id: plan.grant.revision_id, downloaded: 0, skipped: plan.skipped };
  let grant = plan.grant;
  let refreshing: Promise<void> | undefined;
  const refresh = () =>
    (refreshing ??= (async () => {
      const next = await t.readGrant(grant.artifact_id, plan.grant.revision_id);
      if (next.revision_id !== plan.grant.revision_id || next.artifact_id !== plan.grant.artifact_id)
        throw new Error("revision_changed_in_read_grant");
      grant = next;
    })().finally(() => {
      refreshing = undefined;
    }));
  const get = async (path: string, headers: Record<string, string>) => {
    const fetchFile = () =>
      t.fetchContent(`${grant.content_base_url}${path.split("/").map(encodeURIComponent).join("/")}`, headers);
    try {
      return await fetchFile();
    } catch (error) {
      if (!expiredGrant(error, grant)) throw error;
      await refresh();
      return fetchFile();
    }
  };
  await runConcurrent(plan.files, async (file) => {
    if (!file.sha256) throw new Error(`No full-file digest for ${file.path}; cannot verify this legacy download`);
    await transferRetry(() => downloadFile(get, store, file, grant.revision_id, Boolean(input.overwrite)));
  });
  return { revision_id: grant.revision_id, downloaded: plan.files.length, skipped: plan.skipped };
}
function expiredGrant(error: unknown, grant: RevisionReadGrant) {
  const { status } = errorFields(error);
  return (status === 401 || status === 403 || status === 404) && Date.now() >= Date.parse(grant.expires_at);
}
type ContentGet = (path: string, headers: Record<string, string>) => Promise<Response>;
async function downloadFile(
  get: ContentGet,
  store: PullStore,
  file: ArtifactFileListItem,
  revisionId: string,
  overwrite: boolean,
) {
  let partial = await store.partial(file.path);
  if (
    partial &&
    (partial.revisionId !== revisionId || partial.sha256 !== file.sha256 || partial.sizeBytes > file.size_bytes)
  ) {
    await store.removePartial(file.path);
    partial = null;
  }
  const start = partial?.sizeBytes ?? 0;
  if (start === file.size_bytes && partial) return finish(store, file, overwrite);
  const headers: Record<string, string> =
    partial && start ? { Range: `bytes=${start}-`, "If-Range": partial.etag } : {};
  const response = await get(file.path, headers);
  const etag = response.headers.get("etag");
  const resume = start > 0 && response.status === 206;
  try {
    validateResponse(response, file, start, partial?.etag, etag, resume);
  } catch (error) {
    await response.body?.cancel();
    await store.removePartial(file.path);
    throw error;
  }
  const writable = await store.begin(file.path, { etag: etag as string, revisionId, sha256: file.sha256 }, resume);
  try {
    await streamFile(response, writable, resume ? start : 0, file.size_bytes);
  } catch (error) {
    if ((error as Error).message === "file_digest_mismatch") await store.removePartial(file.path);
    throw error;
  } finally {
    await writable.close();
  }
  await finish(store, file, overwrite);
}
function validateResponse(
  response: Response,
  file: ArtifactFileListItem,
  start: number,
  oldEtag: string | undefined,
  etag: string | null,
  resume: boolean,
) {
  if (!etag || etag.startsWith("W/")) throw new Error("missing_strong_content_etag");
  if (response.status !== 200 && !resume) throw new Error("unexpected_content_status");
  if (
    resume &&
    (etag !== oldEtag ||
      response.headers.get("content-range") !== `bytes ${start}-${file.size_bytes - 1}/${file.size_bytes}`)
  )
    throw new Error("invalid_content_range");
}
async function streamFile(
  response: Response,
  writable: { write(bytes: Uint8Array): Promise<void> },
  start: number,
  size: number,
) {
  if (!response.body) throw new TypeError("missing_content_body");
  const reader = response.body.getReader();
  let count = start;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > size) {
        await reader.cancel();
        throw new Error("file_digest_mismatch");
      }
      await writable.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}
async function finish(store: PullStore, file: ArtifactFileListItem, overwrite: boolean): Promise<void> {
  const actual = await store.verifyPartial(file.path);
  if (actual.sizeBytes !== file.size_bytes || actual.sha256 !== file.sha256) {
    await store.removePartial(file.path);
    throw new Error(`file_digest_mismatch: ${file.path}`);
  }
  await store.commit(file.path, overwrite);
}
