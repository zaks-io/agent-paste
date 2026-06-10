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
  };
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
