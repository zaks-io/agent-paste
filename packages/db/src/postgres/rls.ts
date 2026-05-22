import type { SqlExecutor } from "../types.js";
import { bindDrizzleToExecutor, drizzleForExecutor } from "./drizzle.js";

export type RlsScope = { kind: "workspace"; workspaceId: string } | { kind: "platform" };

export function rlsExecutor(base: SqlExecutor, scope: RlsScope): SqlExecutor {
  const wrapped: SqlExecutor = {
    async query(sql, params) {
      return base.transaction(async (tx) => {
        await applyScope(tx, scope);
        return tx.query(sql, params ?? []);
      });
    },
    async transaction(run) {
      return base.transaction(async (tx) => {
        await applyScope(tx, scope);
        const bound = drizzleForExecutor(tx);
        if (bound) {
          bindDrizzleToExecutor(tx, bound);
        }
        return run(tx);
      });
    },
  };
  const inheritedDrizzle = drizzleForExecutor(base);
  if (inheritedDrizzle) {
    bindDrizzleToExecutor(wrapped, inheritedDrizzle);
  }
  return wrapped;
}

async function applyScope(tx: SqlExecutor, scope: RlsScope) {
  if (scope.kind === "workspace") {
    await tx.query("select set_config('app.workspace_id', $1, true)", [scope.workspaceId]);
    await tx.query("select set_config('app.platform', '', true)");
    return;
  }
  await tx.query("select set_config('app.platform', 'on', true)");
  await tx.query("select set_config('app.workspace_id', '', true)");
}
