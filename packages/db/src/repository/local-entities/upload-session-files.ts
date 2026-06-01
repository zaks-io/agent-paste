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
      const file = state.uploadSessionFiles.get(`${input.sessionId}:${input.path}`);
      if (file) {
        file.uploaded_at = input.uploadedAt;
      }
    },
  };
}
