import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localMembers(state: LocalState): Entities["members"] {
  return {
    async insert(member) {
      state.workspaceMembers.set(member.id, member);
    },
    async findById(id) {
      return state.workspaceMembers.get(id) ?? null;
    },
    async findByWorkOsUserId(workosUserId) {
      return [...state.workspaceMembers.values()].find((member) => member.workos_user_id === workosUserId) ?? null;
    },
    async updateSeen(id, input) {
      const member = state.workspaceMembers.get(id);
      if (!member) {
        return null;
      }
      member.email = input.email;
      member.last_seen_at = input.lastSeenAt;
      return member;
    },
  };
}
