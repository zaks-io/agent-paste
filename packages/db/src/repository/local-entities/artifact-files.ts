import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localArtifactFiles(state: LocalState): Entities["artifactFiles"] {
  return {
    async insert(artifactId, revisionId, file, fallbackUploadedAt) {
      state.artifactFiles.set(`${artifactId}:${revisionId}:${file.path}`, {
        ...file,
        artifact_id: artifactId,
        revision_id: revisionId,
        uploaded_at: file.uploaded_at ?? fallbackUploadedAt,
      });
    },
    async listForArtifact(artifactId, revisionId) {
      return [...state.artifactFiles.values()].filter(
        (file) => file.artifact_id === artifactId && (revisionId === undefined || file.revision_id === revisionId),
      );
    },
  };
}
