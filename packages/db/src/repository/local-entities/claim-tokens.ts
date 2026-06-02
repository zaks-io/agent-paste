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
    async findByPublicId(publicId) {
      return [...state.claimTokens.values()].find((row) => row.public_id === publicId) ?? null;
    },
    async markRedeemed(id, redeemedAt) {
      const row = state.claimTokens.get(id);
      if (!row || row.redeemed_at !== null) {
        return false;
      }
      row.redeemed_at = redeemedAt;
      return true;
    },
  };
}
