import type { PlatformLockdown } from "../../types.js";
import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function compareLockdownsForWeb(left: PlatformLockdown, right: PlatformLockdown) {
  const setAt = right.set_at.localeCompare(left.set_at);
  return setAt === 0 ? right.id.localeCompare(left.id) : setAt;
}

export function localPlatformLockdowns(state: LocalState): Entities["platformLockdowns"] {
  return {
    async findEffective(scope, targetId) {
      return (
        [...state.platformLockdowns.values()].find(
          (lockdown) => lockdown.scope === scope && lockdown.target_id === targetId && lockdown.lifted_at === null,
        ) ?? null
      );
    },
    async listEffectivePage(input) {
      const cursorSetAt = input.cursor ? input.cursor.setAt.toISOString() : null;
      const cursorId = input.cursor?.id ?? null;
      return [...state.platformLockdowns.values()]
        .filter((lockdown) => lockdown.lifted_at === null)
        .filter(
          (lockdown) =>
            cursorSetAt === null ||
            cursorId === null ||
            lockdown.set_at < cursorSetAt ||
            (lockdown.set_at === cursorSetAt && lockdown.id < cursorId),
        )
        .sort(compareLockdownsForWeb)
        .slice(0, input.limit);
    },
    async insert(lockdown) {
      const effective = [...state.platformLockdowns.values()].some(
        (existing) =>
          existing.scope === lockdown.scope && existing.target_id === lockdown.target_id && existing.lifted_at === null,
      );
      if (effective) {
        return false;
      }
      state.platformLockdowns.set(lockdown.id, lockdown);
      return true;
    },
    async markLifted(id, input) {
      const lockdown = state.platformLockdowns.get(id);
      if (!lockdown || lockdown.lifted_at !== null) {
        return false;
      }
      lockdown.lifted_at = input.liftedAt;
      lockdown.lifted_by = input.liftedBy;
      return true;
    },
  };
}
