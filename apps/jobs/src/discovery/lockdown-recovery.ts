import { type SqlExecutor, withSqlQuerySource, writePlatformLockdownDenylist } from "@agent-paste/db";
import { withPlatformScope } from "../db.js";
import type { Env } from "../env.js";
import { logOp, logOpError } from "../op-log.js";

export const LOCKDOWN_RECOVERY_PAGE_SIZE = 200;

type LockdownRow = { id: string; scope: "workspace" | "artifact"; target_id: string };

export async function runLockdownRecoveryDiscovery(
  executor: SqlExecutor,
  env: Env,
): Promise<{ discovered: number; restored: number }> {
  if (!env.DENYLIST) {
    logOpError("cron.lockdown_recovery.denylist_missing", {});
    return { discovered: 0, restored: 0 };
  }

  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/discovery/lockdown-recovery.ts",
      functionName: "runLockdownRecoveryDiscovery",
      namespace: "apps.jobs.src.discovery.lockdown-recovery",
    },
    async () => {
      const platform = withPlatformScope(executor);
      let cursor = "";
      let discovered = 0;
      let restored = 0;
      // Visit every page each tick. A fixed first-page cap would starve older
      // lockdowns because successful recovery does not change their DB state.
      while (true) {
        const page = await platform.query<LockdownRow>(
          `select id, scope, target_id from platform_lockdowns
           where lifted_at is null and id > $1
           order by id asc limit $2`,
          [cursor, LOCKDOWN_RECOVERY_PAGE_SIZE],
        );
        discovered += page.rows.length;
        for (const row of page.rows) {
          try {
            const written = await platform.transaction(async (tx) => {
              // Serialize recovery with markLifted. If lift commits first, skip;
              // if recovery wins, lift removes the marker after this transaction.
              const active = await tx.query<LockdownRow>(
                `select id, scope, target_id from platform_lockdowns
                 where id = $1 and lifted_at is null for update`,
                [row.id],
              );
              const lockdown = active.rows[0];
              if (!lockdown) return false;
              const succeeded = await writePlatformLockdownDenylist(env, lockdown.scope, lockdown.target_id);
              if (!succeeded) throw new Error("lockdown_denylist_write_failed");
              return true;
            });
            if (written) restored += 1;
          } catch (error) {
            logOpError("cron.lockdown_recovery.lockdown_failed", {
              lockdown_id: row.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const last = page.rows.at(-1);
        if (!last || page.rows.length < LOCKDOWN_RECOVERY_PAGE_SIZE) break;
        cursor = last.id;
      }
      logOp("cron.lockdown_recovery", { discovered, restored });
      return { discovered, restored };
    },
  );
}
