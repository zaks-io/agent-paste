import type { SqlExecutor } from "@agent-paste/db";
import { AUDIT_RETENTION_DAYS, IDEMPOTENCY_RETENTION_DAYS, MAINTENANCE_GC_SWEEP_CAP } from "../constants.js";
import { logOp } from "../op-log.js";
import type { SweepResult } from "./types.js";

export async function runMaintenanceGc(executor: SqlExecutor, now: string): Promise<SweepResult> {
  const idempotencyCutoff = subtractDays(now, IDEMPOTENCY_RETENTION_DAYS);
  const auditCutoff = subtractDays(now, AUDIT_RETENTION_DAYS);

  const idempotency = await executor.query<{ id: string }>(
    `delete from idempotency_records
     where status = 'completed'
       and completed_at is not null
       and completed_at < $1
     returning workspace_id::text || ':' || actor_id || ':' || operation || ':' || idempotency_key as id`,
    [idempotencyCutoff],
  );

  const audit = await executor.query<{ id: string }>(
    `delete from operation_events
     where occurred_at < $1
     returning id`,
    [auditCutoff],
  );

  const discovered = idempotency.rows.length + audit.rows.length;
  const cap_hit = discovered >= MAINTENANCE_GC_SWEEP_CAP;
  logOp("cron.maintenance_gc", {
    idempotency_deleted: idempotency.rows.length,
    audit_deleted: audit.rows.length,
    cap_hit,
  });
  return { discovered, enqueued: 0, cap_hit };
}

function subtractDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}
