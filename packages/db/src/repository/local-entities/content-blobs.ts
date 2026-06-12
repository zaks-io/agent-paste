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
    async upsert(blob) {
      state.contentBlobs.set(
        keyFor({ workspaceId: blob.workspace_id, sha256: blob.sha256, sizeBytes: blob.size_bytes }),
        blob,
      );
    },
    async deleteUnreferenced(input) {
      const deleted = [];
      for (const [key, blob] of state.contentBlobs) {
        if (deleted.length >= input.limit) {
          break;
        }
        if (isBlobReferenced(state, blob, input.now)) {
          continue;
        }
        state.contentBlobs.delete(key);
        deleted.push(blob);
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
  return Boolean(session?.status === "pending" && new Date(session.expires_at).getTime() > new Date(now).getTime());
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
      if (session?.status === "pending" && new Date(session.expires_at).getTime() > new Date(now).getTime()) {
        return true;
      }
    }
  }
  return false;
}
