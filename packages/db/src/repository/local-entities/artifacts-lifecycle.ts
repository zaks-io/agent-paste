import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localArtifactLifecycleMethods(
  state: LocalState,
): Pick<Entities["artifacts"], "listExpiring" | "expireBatch"> {
  return {
    async listExpiring(now, limit) {
      const nowMs = new Date(now).getTime();
      return [...state.artifacts.values()]
        .filter(
          (artifact) =>
            artifact.status === "active" && !artifact.pinned_at && new Date(artifact.expires_at).getTime() <= nowMs,
        )
        .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
        .slice(0, limit)
        .map((artifact) => ({ id: artifact.id }));
    },
    async expireBatch(now, ids) {
      for (const id of ids) {
        const artifact = state.artifacts.get(id);
        if (artifact) {
          artifact.status = "expired";
          artifact.deleted_at = now;
          artifact.delete_reason = "expired";
          artifact.updated_at = now;
        }
      }
    },
  };
}
