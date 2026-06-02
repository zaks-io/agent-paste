import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localClaimTokens(state: LocalState): Entities["claimTokens"] {
  return {
    async insert(claimToken) {
      state.claimTokens.set(claimToken.id, claimToken);
    },
    async findById(id, workspaceId) {
      const row = state.claimTokens.get(id) ?? null;
      if (!row) {
        return null;
      }
      if (workspaceId && row.workspace_id !== workspaceId) {
        return null;
      }
      return row;
    },
  };
}
