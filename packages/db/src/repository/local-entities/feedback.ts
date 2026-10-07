import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localFeedback(state: LocalState): Entities["feedback"] {
  return {
    async insert(row) {
      state.feedback.set(row.id, structuredClone(row));
    },
    async findById(id) {
      return state.feedback.get(id) ?? null;
    },
  };
}
