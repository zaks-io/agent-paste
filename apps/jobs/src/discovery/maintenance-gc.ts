import type { SqlExecutor } from "@agent-paste/db";
import { AUDIT_RETENTION_DAYS, IDEMPOTENCY_RETENTION_DAYS, MAINTENANCE_GC_SWEEP_CAP } from "../constants.js";
import { logOp } from "../op-log.js";
import type { SweepResult } from "./types.js";

export async function runMaintenanceGc(executor: SqlExecutor, now: string): Promise<SweepResult> {
  const idempotencyCutoff = subtractDays(now, IDEMPOTENCY_RETENTION_DAYS);
  const auditCutoff = subtractDays(now, AUDIT_RETENTION_DAYS);

  let remaining = MAINTENANCE_GC_SWEEP_CAP;
  let cap_hit = false;

  const idempotencyDeleted = await deleteIdempotencyRows(executor, idempotencyCutoff, remaining);
  remaining -= idempotencyDeleted;
  if (idempotencyDeleted > 0 && remaining === 0) {
    cap_hit = true;
  }

  let auditDeleted = 0;
  if (remaining > 0) {
    const auditLimit = remaining;
    auditDeleted = await deleteAuditRows(executor, auditCutoff, auditLimit);
    remaining -= auditDeleted;
    if (auditDeleted === auditLimit) {
      cap_hit = true;
    }
  }

  const discovered = idempotencyDeleted + auditDeleted;
  logOp("cron.maintenance_gc", {
    idempotency_deleted: idempotencyDeleted,
    audit_deleted: auditDeleted,
    cap_hit,
  });
  return { discovered, enqueued: 0, cap_hit };
}

async function deleteIdempotencyRows(executor: SqlExecutor, cutoff: string, limit: number): Promise<number> {
  if (limit <= 0) {
    return 0;
  }
  const result = await executor.query<{ id: string }>(
    `delete from idempotency_records
     where ctid in (
       select ctid
       from idempotency_records
       where status = 'completed'
         and completed_at is not null
         and completed_at < $1
       limit $2
     )
     returning workspace_id::text || ':' || actor_id || ':' || operation || ':' || idempotency_key as id`,
    [cutoff, limit],
  );
  return result.rows.length;
}

async function deleteAuditRows(executor: SqlExecutor, cutoff: string, limit: number): Promise<number> {
  if (limit <= 0) {
    return 0;
  }
  const result = await executor.query<{ id: string }>(
    `delete from operation_events
     where ctid in (
       select ctid
       from operation_events
       where occurred_at < $1
       limit $2
     )
     returning id`,
    [cutoff, limit],
  );
  return result.rows.length;
}

function subtractDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}
