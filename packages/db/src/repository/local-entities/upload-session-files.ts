import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function blobKey(input: { workspaceId: string; sha256: string; sizeBytes: number }) {
  return `${input.workspaceId}:${input.sha256}:${input.sizeBytes}`;
}

export function localUploadSessionFiles(state: LocalState): Entities["uploadSessionFiles"] {
  return {
    async insert(sessionId, file) {
      state.uploadSessionFiles.set(`${sessionId}:${file.path}`, file);
    },
    async insertMany(sessionId, files) {
      for (const file of files) {
        state.uploadSessionFiles.set(`${sessionId}:${file.path}`, file);
      }
    },
    async listForSession(sessionId) {
      return [...state.uploadSessionFiles.values()].filter((file) => file.upload_session_id === sessionId);
    },
    async recordUpload(input) {
      if (input.workspaceId && input.sha256 && input.objectKey && typeof input.sizeBytes === "number") {
        state.contentBlobs.set(
          blobKey({ workspaceId: input.workspaceId, sha256: input.sha256, sizeBytes: input.sizeBytes }),
          {
            workspace_id: input.workspaceId,
            sha256: input.sha256,
            size_bytes: input.sizeBytes,
            r2_key: input.objectKey,
            created_at: input.uploadedAt,
            updated_at: input.uploadedAt,
          },
        );
      }
      for (const file of state.uploadSessionFiles.values()) {
        if (file.upload_session_id !== input.sessionId) {
          continue;
        }
        if (input.sha256 ? file.sha256 !== input.sha256 : file.path !== input.path) {
          continue;
        }
        if (input.objectKey && file.r2_key !== input.objectKey) {
          continue;
        }
        if (typeof input.sizeBytes === "number" && file.size_bytes !== input.sizeBytes) {
          continue;
        }
        file.uploaded_at = input.uploadedAt;
      }
    },
  };
}
