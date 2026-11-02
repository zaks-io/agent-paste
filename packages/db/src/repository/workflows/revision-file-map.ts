import { CHUNK_BYTES } from "@agent-paste/config";
import { type RevisionFileMapEntry, type RevisionFileMapV1, serializeRevisionFileMap } from "@agent-paste/storage";
import { repositoryError } from "../../repository-error.js";
import type { StoredFile } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import type { Entities } from "../ports.js";

export async function writeRevisionFileMap(
  ctx: RepositoryCoreContext,
  e: Entities,
  i: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    entrypoint: string;
    files: StoredFile[];
    now: string;
  },
) {
  if (!ctx.options.fileMapStore) repositoryError("storage_unavailable");
  const files: RevisionFileMapEntry[] = [];
  for (const f of [...i.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const common = { path: f.path, size_bytes: f.size_bytes, sha256: f.sha256 ?? null, content_type: f.content_type };
    if (f.content_format === "chunked-v1") {
      if (!f.sha256) repositoryError("storage_unavailable");
      const chunks = await e.persistent.listBlobChunks(i.workspaceId, f.sha256, f.size_bytes);
      if (!chunks.length) repositoryError("storage_unavailable");
      files.push({
        ...common,
        sha256: f.sha256,
        format: "chunked-v1",
        chunk_bytes: CHUNK_BYTES,
        chunks: chunks.map((c) => c.chunk_sha256),
      });
    } else files.push({ ...common, format: "single", object_key: f.r2_key });
  }
  const map: RevisionFileMapV1 = {
    version: 1,
    workspace_id: i.workspaceId,
    artifact_id: i.artifactId,
    revision_id: i.revisionId,
    entrypoint: i.entrypoint,
    files,
  };
  // Validate and bound the map before invoking external storage.
  const bytes = serializeRevisionFileMap(map);
  const stored = await ctx.options.fileMapStore.write(map);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  const sha = [...digest].map((v) => v.toString(16).padStart(2, "0")).join("");
  if (stored.size_bytes !== bytes.byteLength || stored.sha256 !== sha) repositoryError("storage_unavailable");
  await e.contentBlobs.upsert({
    workspace_id: i.workspaceId,
    sha256: stored.sha256,
    size_bytes: stored.size_bytes,
    r2_key: stored.r2_key,
    content_format: "single",
    created_at: i.now,
    updated_at: i.now,
  });
  await e.persistent.setFileMap(i.revisionId, stored.sha256, stored.size_bytes);
  return { sha256: stored.sha256, size_bytes: stored.size_bytes };
}
export function fileChanges(before: StoredFile[], after: StoredFile[]) {
  const old = new Map(before.map((f) => [f.path, f]));
  const next = new Map(after.map((f) => [f.path, f]));
  let added = 0,
    changed = 0,
    removed = 0;
  for (const f of after) {
    const p = old.get(f.path);
    if (!p) added++;
    else if (!sameFile(p, f)) changed++;
  }
  for (const f of before) if (!next.has(f.path)) removed++;
  return { added, changed, removed };
}
export function sameFile(a: StoredFile, b: StoredFile) {
  return (
    a.sha256 === b.sha256 &&
    (a.sha256 != null || a.r2_key === b.r2_key) &&
    a.size_bytes === b.size_bytes &&
    (a.content_format ?? "single") === (b.content_format ?? "single") &&
    a.content_type === b.content_type
  );
}
export function bundleStatusFor(files: StoredFile[], enabled: boolean): "disabled" | "pending" {
  return enabled &&
    !files.some((f) => f.content_format === "chunked-v1") &&
    files.reduce((a, f) => a + f.size_bytes, 0) <= 16 * 1024 * 1024
    ? "pending"
    : "disabled";
}
