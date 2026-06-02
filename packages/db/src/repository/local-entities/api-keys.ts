import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localApiKeys(state: LocalState): Entities["apiKeys"] {
  return {
    async insert(apiKey) {
      state.apiKeys.set(apiKey.id, apiKey);
    },
    async findById(id) {
      return state.apiKeys.get(id) ?? null;
    },
    async findByPublicId(publicId) {
      return [...state.apiKeys.values()].find((apiKey) => apiKey.public_id === publicId) ?? null;
    },
    async listForWorkspace(workspaceId) {
      return [...state.apiKeys.values()]
        .filter((apiKey) => apiKey.workspace_id === workspaceId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at));
    },
    async updateLastUsedAt(id, lastUsedAt) {
      const apiKey = state.apiKeys.get(id);
      if (apiKey) {
        apiKey.last_used_at = lastUsedAt;
      }
    },
    async updateRevokedAt(id, revokedAt) {
      const apiKey = state.apiKeys.get(id);
      if (apiKey && apiKey.revoked_at === null) {
        apiKey.revoked_at = revokedAt;
      }
    },
    async revokeAllForWorkspace(workspaceId, revokedAt) {
      for (const apiKey of state.apiKeys.values()) {
        if (apiKey.workspace_id === workspaceId && apiKey.revoked_at === null) {
          apiKey.revoked_at = revokedAt;
        }
      }
    },
  };
}
