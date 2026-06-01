import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localSafetyWarnings(state: LocalState): Entities["safetyWarnings"] {
  return {
    async listForRevision(workspaceId, revisionId) {
      return [...state.safetyWarnings.values()]
        .filter((warning) => warning.workspace_id === workspaceId && warning.revision_id === revisionId)
        .sort((left, right) => {
          const scope = left.scope.localeCompare(right.scope);
          if (scope !== 0) {
            return scope;
          }
          const filePath = (left.file_path ?? "").localeCompare(right.file_path ?? "");
          if (filePath !== 0) {
            return filePath;
          }
          const code = left.code.localeCompare(right.code);
          if (code !== 0) {
            return code;
          }
          const scannerId = left.scanner_id.localeCompare(right.scanner_id);
          return scannerId === 0 ? left.id.localeCompare(right.id) : scannerId;
        });
    },
  };
}
