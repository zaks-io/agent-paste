import { REVISION_FILE_ENTRY_BYTES } from "@agent-paste/config";
import type { LocalState } from "../local-state.js";
import type { PersistentEntities } from "../persistent-ports.js";

export function localPersistent(s: LocalState): PersistentEntities {
  return {
    async lockWorkspace() {},
    async lockArtifact() {},
    async updateSession(row) {
      s.uploadSessions.set(row.id, { ...row });
    },
    async updateFile(sid, row) {
      s.uploadSessionFiles.set(`${sid}:${row.path}`, { ...row });
    },
    async insertChunks(rows) {
      for (const r of rows) s.uploadSessionChunks.set(`${r.upload_session_id}:${r.path}:${r.chunk_index}`, { ...r });
    },
    async listChunks(sid, path) {
      return [...s.uploadSessionChunks.values()]
        .filter((c) => c.upload_session_id === sid && (path === undefined || c.path === path))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.chunk_index - b.chunk_index));
    },
    async markChunkUploaded(sid, path, index, now) {
      const k = `${sid}:${path}:${index}`;
      const r = s.uploadSessionChunks.get(k);
      if (r) s.uploadSessionChunks.set(k, { ...r, uploaded_at: now });
    },
    async insertDeletions(rows) {
      for (const r of rows) s.uploadSessionDeletions.set(`${r.upload_session_id}:${r.kind}:${r.path}`, { ...r });
    },
    async listDeletions(sid) {
      return [...s.uploadSessionDeletions.values()].filter((c) => c.upload_session_id === sid);
    },
    async insertBlobChunks(rows) {
      for (const r of rows) {
        const k = `${r.workspace_id}:${r.sha256}:${r.size_bytes}:${r.chunk_index}`;
        if (!s.contentBlobChunks.get(k)) s.contentBlobChunks.set(k, { ...r });
      }
    },
    async listBlobChunks(ws, sha, size) {
      return [...s.contentBlobChunks.values()]
        .filter((c) => c.workspace_id === ws && c.sha256 === sha && c.size_bytes === size)
        .sort((a, b) => a.chunk_index - b.chunk_index);
    },
    async setFileMap(id, sha, size) {
      const r = s.revisions.get(id);
      if (r) s.revisions.set(id, { ...r, file_map_sha256: sha, file_map_size_bytes: size });
    },
    async storageUsage(ws, now) {
      const breakdown = { blob_bytes: 0, legacy_file_bytes: 0, bundle_bytes: 0, file_entry_bytes: 0 };
      const live = (id: string | undefined) => {
        const r = id ? s.revisions.get(id) : null;
        return r && ["draft", "published"].includes(r.status) && s.artifacts.get(r.artifact_id)?.status === "active";
      };
      for (const b of s.contentBlobs.values())
        if (b.workspace_id === ws && b.content_format !== "chunked-v1") breakdown.blob_bytes += b.size_bytes;
      for (const f of s.artifactFiles.values())
        if (f.workspace_id === ws && f.storage_kind !== "blob" && live(f.revision_id))
          breakdown.legacy_file_bytes += f.size_bytes;
      for (const r of s.revisions.values())
        if (r.workspace_id === ws && live(r.id)) {
          breakdown.file_entry_bytes += r.file_count * REVISION_FILE_ENTRY_BYTES;
          if (r.bundle_status === "ready") breakdown.bundle_bytes += r.bundle_size_bytes ?? 0;
        }
      const reserved_bytes = reservedBytes(s, ws, now);
      return { breakdown, reserved_bytes };
    },
  };
}

function reservedBytes(s: LocalState, ws: string, now: string) {
  const active = (id: string | undefined) => {
    const r = id ? s.uploadSessions.get(id) : null;
    return r && ["pending", "ready"].includes(r.status) && Date.parse(r.expires_at) > Date.parse(now);
  };
  let reserved_bytes = 0;
  for (const f of s.uploadSessionFiles.values())
    if (f.workspace_id === ws && f.content_format !== "chunked-v1") {
      const session = f.upload_session_id ? s.uploadSessions.get(f.upload_session_id) : null;
      const staged = session && session.status !== "finalized" && f.storage_kind !== "blob" && f.uploaded_at;
      if (staged || (!f.uploaded_at && active(f.upload_session_id))) reserved_bytes += f.size_bytes;
    }
  for (const c of s.uploadSessionChunks.values())
    if (c.workspace_id === ws && !c.uploaded_at && active(c.upload_session_id)) reserved_bytes += c.size_bytes;
  return reserved_bytes;
}
