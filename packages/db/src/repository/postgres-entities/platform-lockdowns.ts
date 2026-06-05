import { platformLockdownQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresPlatformLockdowns(ctx: PostgresContext): Entities["platformLockdowns"] {
  const { drizzle } = ctx;
  return {
    findEffective: (scope, targetId) => platformLockdownQueries.findEffective(drizzle, scope, targetId),
    listEffectivePage: (input) => platformLockdownQueries.listEffectivePage(drizzle, input),
    insert: (lockdown) => platformLockdownQueries.insert(drizzle, lockdown),
    markLifted: (id, input) => platformLockdownQueries.markLifted(drizzle, id, input),
  };
}
