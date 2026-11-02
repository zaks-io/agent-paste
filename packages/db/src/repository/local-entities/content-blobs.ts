import { CONTENT_BLOB_GC_AGE_MS } from "../../queries/content-blob-gc.js";
import { repositoryError } from "../../repository-error.js";
import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function keyFor(input: { workspaceId: string; sha256: string; sizeBytes: number }) {
  return `${input.workspaceId}:${input.sha256}:${input.sizeBytes}`;
}

export function localContentBlobs(state: LocalState): Entities["contentBlobs"] {
  return {
    async find(input) {
      return state.contentBlobs.get(keyFor(input)) ?? null;
    },
    async findReusableAndTouch(workspaceId, files, updatedAt) {
      const reusable = [];
      for (const file of files) {
        const key = keyFor({ workspaceId, sha256: file.sha256, sizeBytes: file.sizeBytes });
        const blob = state.contentBlobs.get(key);
        if (blob?.gc_state === "deleting") repositoryError("blob_cleanup_in_progress");
        if (blob) {
          const touched = { ...blob, updated_at: updatedAt };
          state.contentBlobs.set(key, touched);
          reusable.push(touched);
        }
      }
      return reusable;
    },
    async upsert(blob) {
      upsertLocalBlob(state, blob);
    },
    async upsertMany(blobs) {
      for (const blob of blobs) upsertLocalBlob(state, blob);
    },
    async deleteUnreferenced(input) {
      // Age floor mirroring the Postgres query: a blob touched within the last
      // upload-session TTL may be referenced by an in-flight session create
      // this reader cannot see yet.
      const ageFloorMs = new Date(input.now).getTime() - CONTENT_BLOB_GC_AGE_MS;
      const deleted = [];
      for (const [key, blob] of state.contentBlobs) {
        if (deleted.length >= input.limit) {
          break;
        }
        if (blob.gc_state !== "deleting" && new Date(blob.updated_at).getTime() >= ageFloorMs) {
          continue;
        }
        if (isBlobReferenced(state, blob, input.now)) {
          continue;
        }
        const marked = { ...blob, gc_state: "deleting" as const, gc_marked_at: blob.gc_marked_at ?? input.now };
        state.contentBlobs.set(key, marked);
        if (blob.content_format === "chunked-v1" || blob.r2_cleanup_eligible !== true) {
          state.contentBlobs.delete(key);
          for (const c of state.contentBlobChunks.values())
            if (c.workspace_id === blob.workspace_id && c.sha256 === blob.sha256 && c.size_bytes === blob.size_bytes)
              state.contentBlobChunks.delete(`${c.workspace_id}:${c.sha256}:${c.size_bytes}:${c.chunk_index}`);
        }
        deleted.push(marked);
      }
      return deleted;
    },
    async listForReparent(workspaceId, now) {
      const blobs = new Map<string, { sha256: string; size_bytes: number; r2_key: string }>();
      for (const file of state.artifactFiles.values()) {
        if (isLiveArtifactBlobForReparent(state, file, workspaceId)) {
          collectReparentBlob(blobs, file);
        }
      }
      for (const file of state.uploadSessionFiles.values()) {
        if (isLiveSessionBlobForReparent(state, file, workspaceId, now)) {
          collectReparentBlob(blobs, file);
        }
      }
      return [...blobs.values()];
    },
  };
}

function collectReparentBlob(
  blobs: Map<string, { sha256: string; size_bytes: number; r2_key: string }>,
  file: {
    sha256?: string | null;
    size_bytes: number;
    r2_key: string;
  },
) {
  if (!file.sha256) {
    return;
  }
  blobs.set(`${file.sha256}:${file.size_bytes}`, {
    sha256: file.sha256,
    size_bytes: file.size_bytes,
    r2_key: file.r2_key,
  });
}

export function isLiveArtifactBlobForReparent(
  state: LocalState,
  file: {
    workspace_id: string;
    artifact_id?: string;
    revision_id?: string;
    sha256?: string | null;
    storage_kind?: string;
  },
  workspaceId: string,
) {
  if (file.workspace_id !== workspaceId || file.storage_kind !== "blob" || !file.sha256) {
    return false;
  }
  const revision = file.revision_id ? state.revisions.get(file.revision_id) : null;
  const artifact = file.artifact_id ? state.artifacts.get(file.artifact_id) : null;
  return Boolean(
    revision && artifact?.status === "active" && (revision.status === "draft" || revision.status === "published"),
  );
}

export function isLiveSessionBlobForReparent(
  state: LocalState,
  file: {
    workspace_id: string;
    upload_session_id?: string;
    sha256?: string | null;
    storage_kind?: string;
    uploaded_at?: string | null;
  },
  workspaceId: string,
  now: string,
) {
  if (file.workspace_id !== workspaceId || file.storage_kind !== "blob" || !file.sha256 || !file.uploaded_at) {
    return false;
  }
  const session = file.upload_session_id ? state.uploadSessions.get(file.upload_session_id) : null;
  return Boolean(
    session &&
      ["pending", "ready"].includes(session.status) &&
      new Date(session.expires_at).getTime() > new Date(now).getTime(),
  );
}

function isBlobReferenced(
  state: LocalState,
  blob: { workspace_id: string; sha256: string; size_bytes: number },
  now: string,
) {
  for (const file of state.artifactFiles.values()) {
    if (
      file.workspace_id === blob.workspace_id &&
      file.sha256 === blob.sha256 &&
      file.size_bytes === blob.size_bytes &&
      file.storage_kind === "blob"
    ) {
      const revision = file.revision_id ? state.revisions.get(file.revision_id) : null;
      const artifact = file.artifact_id ? state.artifacts.get(file.artifact_id) : null;
      if (
        revision &&
        artifact?.status === "active" &&
        (revision.status === "draft" || revision.status === "published")
      ) {
        return true;
      }
    }
  }
  for (const file of state.uploadSessionFiles.values()) {
    if (
      file.workspace_id === blob.workspace_id &&
      file.sha256 === blob.sha256 &&
      file.size_bytes === blob.size_bytes &&
      file.storage_kind === "blob"
    ) {
      const session = file.upload_session_id ? state.uploadSessions.get(file.upload_session_id) : null;
      if (
        session &&
        ["pending", "ready"].includes(session.status) &&
        new Date(session.expires_at).getTime() > new Date(now).getTime()
      ) {
        return true;
      }
    }
  }
  return isChunkOrMapReferenced(state, blob, now);
}

function isChunkOrMapReferenced(
  state: LocalState,
  blob: { workspace_id: string; sha256: string; size_bytes: number },
  now: string,
) {
  for (const chunk of state.uploadSessionChunks.values()) {
    const session = state.uploadSessions.get(chunk.upload_session_id);
    if (
      chunk.workspace_id === blob.workspace_id &&
      chunk.sha256 === blob.sha256 &&
      chunk.size_bytes === blob.size_bytes &&
      session &&
      ["pending", "ready"].includes(session.status) &&
      Date.parse(session.expires_at) > Date.parse(now)
    )
      return true;
  }
  for (const c of state.contentBlobChunks.values()) {
    const parent = state.contentBlobs.get(`${c.workspace_id}:${c.sha256}:${c.size_bytes}`);
    if (
      c.workspace_id === blob.workspace_id &&
      c.chunk_sha256 === blob.sha256 &&
      c.chunk_size_bytes === blob.size_bytes &&
      parent &&
      parent.gc_state !== "deleting"
    )
      return true;
  }
  for (const r of state.revisions.values())
    if (
      r.workspace_id === blob.workspace_id &&
      r.file_map_sha256 === blob.sha256 &&
      r.file_map_size_bytes === blob.size_bytes &&
      ["draft", "published"].includes(r.status) &&
      state.artifacts.get(r.artifact_id)?.status === "active"
    )
      return true;
  return false;
}

function upsertLocalBlob(state: LocalState, blob: import("../../types.js").ContentBlob) {
  const key = keyFor({ workspaceId: blob.workspace_id, sha256: blob.sha256, sizeBytes: blob.size_bytes });
  const old = state.contentBlobs.get(key);
  if (old?.gc_state === "deleting") repositoryError("blob_cleanup_in_progress");
  state.contentBlobs.set(key, {
    ...blob,
    created_at: old?.created_at ?? blob.created_at,
    content_format: old && old.content_format !== "chunked-v1" ? "single" : (blob.content_format ?? "single"),
    gc_state: "live",
    r2_cleanup_eligible: old ? (old.r2_cleanup_eligible ?? false) : (blob.r2_cleanup_eligible ?? true),
  });
}
