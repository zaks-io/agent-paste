import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localUploadSessions(state: LocalState): Entities["uploadSessions"] {
  return {
    async insert(session) {
      state.uploadSessions.set(session.id, session);
    },
    async findById(sessionId, workspaceId) {
      const session = state.uploadSessions.get(sessionId);
      if (!session || (workspaceId && session.workspace_id !== workspaceId)) {
        return null;
      }
      return session;
    },
    async findByRevisionId(revisionId, workspaceId) {
      const session = [...state.uploadSessions.values()].find(
        (candidate) => candidate.revision_id === revisionId && (!workspaceId || candidate.workspace_id === workspaceId),
      );
      return session ?? null;
    },
    async markFinalized(sessionId, finalizedAt) {
      const session = state.uploadSessions.get(sessionId);
      if (session) {
        session.status = "finalized";
        session.finalized_at = finalizedAt;
      }
    },
    async listExpiring(now, limit) {
      const nowMs = new Date(now).getTime();
      return [...state.uploadSessions.values()]
        .filter(
          (session) => ["pending", "ready"].includes(session.status) && new Date(session.expires_at).getTime() <= nowMs,
        )
        .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
        .slice(0, limit)
        .map((session) => ({ id: session.id }));
    },
    async expireBatch(now, ids) {
      for (const id of ids) {
        const session = state.uploadSessions.get(id);
        if (
          session &&
          ["pending", "ready"].includes(session.status) &&
          Date.parse(session.expires_at) <= Date.parse(now)
        ) {
          session.status = "expired";
        }
      }
    },
  };
}
