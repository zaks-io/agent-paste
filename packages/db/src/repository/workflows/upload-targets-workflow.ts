import { UPLOAD_TARGETS_PAGE_MAX } from "@agent-paste/config";
import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { repositoryError } from "../../repository-error.js";
import type { StoredFile, UploadSessionChunk } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { workspaceScope } from "../core-helpers.js";
import type { PersistentHostingRepository } from "../persistent-hosting-repository.js";
import type { UploadTarget, UploadTargetsPage } from "../persistent-hosting-types.js";

export function listUploadTargets(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["listUploadTargets"]>[0],
): Promise<UploadTargetsPage> {
  return ctx.uow.read(workspaceScope(i.actor.workspace_id), async (e) => {
    if (!Number.isInteger(i.limit) || i.limit < 1 || i.limit > UPLOAD_TARGETS_PAGE_MAX)
      repositoryError("invalid_pagination_limit");
    const s = await e.uploadSessions.findById(i.sessionId, i.actor.workspace_id);
    if (!s) repositoryError("upload_session_not_found");
    const files = await e.uploadSessionFiles.listForSession(s.id);
    const chunks = await e.persistent.listChunks(s.id);
    const { targets, remaining } = collectTargets(files, chunks, s.workspace_id);
    const expired = Date.parse(s.expires_at) <= Date.parse(i.now) || s.status === "expired" || s.status === "failed";
    const writable = !expired && s.status === "pending";
    const page = pageTargets(targets, s.id, i.cursor, i.limit);
    return {
      upload_session_id: s.id,
      workspace_id: s.workspace_id,
      artifact_id: s.artifact_id,
      revision_id: s.revision_id,
      status: expired ? "expired" : (s.status as UploadTargetsPage["status"]),
      sealed: s.commit_guard ? !!s.sealed_at : true,
      expires_at: s.expires_at,
      remaining,
      targets: writable ? page.targets : [],
      page_info: writable ? page.page_info : { has_more: false, next_cursor: null },
    };
  });
}
function targetIndex(t: UploadTarget) {
  return "chunk_index" in t ? t.chunk_index : -1;
}
function collectTargets(files: StoredFile[], chunks: UploadSessionChunk[], workspaceId: string) {
  const targets: UploadTarget[] = [];
  const remaining = { files: 0, chunks: 0, bytes: 0, unverified_files: 0 };
  const byPath = new Map<string, UploadSessionChunk[]>();
  for (const c of chunks) {
    const list = byPath.get(c.path) ?? [];
    list.push(c);
    byPath.set(c.path, list);
  }
  for (const f of files) {
    if (f.content_format === "chunked-v1") {
      if (f.verified_at) continue;
      remaining.unverified_files++;
      const missing = (byPath.get(f.path) ?? []).filter((c) => !c.uploaded_at);
      remaining.chunks += missing.length;
      remaining.bytes += missing.reduce((n, c) => n + c.size_bytes, 0);
      if (!missing.length) targets.push({ status: "verify_required", path: f.path });
      for (const c of missing)
        targets.push({
          status: "chunk_upload_required",
          path: f.path,
          chunk_index: c.chunk_index,
          sha256: c.sha256,
          size_bytes: c.size_bytes,
          object_key: workspaceBlobObjectKeyFor({ workspaceId, sha256: c.sha256 }),
        });
    } else if (!f.uploaded_at) {
      remaining.files++;
      remaining.bytes += f.size_bytes;
      targets.push({
        status: "upload_required",
        path: f.path,
        object_key: f.r2_key,
        size_bytes: f.size_bytes,
        sha256: f.sha256 ?? null,
      });
    }
  }
  targets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : targetIndex(a) - targetIndex(b)));
  return { targets, remaining };
}
function parseCursor(cursor: string | undefined, sessionId: string): [string, number] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(decodeURIComponent(atob(cursor)));
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      v[0] !== sessionId ||
      typeof v[1] !== "string" ||
      !Number.isInteger(v[2])
    )
      throw new Error();
    return [v[1], v[2]];
  } catch {
    repositoryError("invalid_cursor");
  }
}
function pageTargets(targets: UploadTarget[], sessionId: string, cursor: string | undefined, limit: number) {
  const after = parseCursor(cursor, sessionId);
  const rest = after
    ? targets.filter((t) => t.path > after[0] || (t.path === after[0] && targetIndex(t) > after[1]))
    : targets;
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  const more = rest.length > page.length;
  return {
    targets: page,
    page_info: {
      has_more: more,
      next_cursor:
        more && last ? btoa(encodeURIComponent(JSON.stringify([sessionId, last.path, targetIndex(last)]))) : null,
    },
  };
}
