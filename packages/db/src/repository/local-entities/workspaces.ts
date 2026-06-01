import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localWorkspaces(state: LocalState): Entities["workspaces"] {
  return {
    async insert(workspace) {
      state.workspaces.set(workspace.id, workspace);
    },
    async findById(id) {
      return state.workspaces.get(id) ?? null;
    },
    async listAll() {
      return [...state.workspaces.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
    },
    async update(id, input) {
      const workspace = state.workspaces.get(id);
      if (workspace) {
        workspace.name = input.name;
        workspace.auto_deletion_days = input.autoDeletionDays;
        workspace.updated_at = input.updatedAt;
      }
    },
  };
}
