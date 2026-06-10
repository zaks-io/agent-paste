import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localUploadSessionFiles(state: LocalState): Entities["uploadSessionFiles"] {
  return {
    async insert(sessionId, file) {
      state.uploadSessionFiles.set(`${sessionId}:${file.path}`, file);
    },
    async listForSession(sessionId) {
      return [...state.uploadSessionFiles.values()].filter((file) => file.upload_session_id === sessionId);
    },
    async recordUpload(input) {
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
