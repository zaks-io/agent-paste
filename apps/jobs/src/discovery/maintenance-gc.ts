import type { SqlExecutor } from "@agent-paste/db";
import { AUDIT_RETENTION_DAYS, IDEMPOTENCY_RETENTION_DAYS, MAINTENANCE_GC_SWEEP_CAP } from "../constants.js";
import { withPlatformScope } from "../db.js";
import type { R2Bucket } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import { archiveAuditRows, deleteAuditRowsByIds, selectExpiringAuditRows } from "./audit-archive.js";
import type { SweepResult } from "./types.js";

export async function runMaintenanceGc(executor: SqlExecutor, now: string, artifacts?: R2Bucket): Promise<SweepResult> {
  const platformExecutor = withPlatformScope(executor);
  const idempotencyCutoff = subtractDays(now, IDEMPOTENCY_RETENTION_DAYS);
  const auditCutoff = subtractDays(now, AUDIT_RETENTION_DAYS);

  let remaining = MAINTENANCE_GC_SWEEP_CAP;
  let cap_hit = false;

  const idempotencyDeleted = await deleteIdempotencyRows(platformExecutor, idempotencyCutoff, remaining);
  remaining -= idempotencyDeleted;
  if (idempotencyDeleted > 0 && remaining === 0) {
    cap_hit = true;
  }

  let auditArchived = 0;
  let auditDeleted = 0;
  if (remaining > 0) {
    const auditLimit = remaining;
    const auditResult = await archiveAndDeleteAuditRows(platformExecutor, artifacts, auditCutoff, auditLimit);
    auditArchived = auditResult.archived;
    auditDeleted = auditResult.deleted;
    remaining -= auditDeleted;
    if (auditDeleted === auditLimit) {
      cap_hit = true;
    }
  }

  const discovered = idempotencyDeleted + auditDeleted;
  logOp("cron.maintenance_gc", {
    idempotency_deleted: idempotencyDeleted,
    audit_archived: auditArchived,
    audit_deleted: auditDeleted,
    cap_hit,
  });
  return { discovered, enqueued: 0, cap_hit };
}

async function archiveAndDeleteAuditRows(
  executor: SqlExecutor,
  artifacts: R2Bucket | undefined,
  cutoff: string,
  limit: number,
): Promise<{ archived: number; deleted: number }> {
  if (limit <= 0) {
    return { archived: 0, deleted: 0 };
  }

  const rows = await selectExpiringAuditRows(executor, cutoff, limit);
  if (rows.length === 0) {
    return { archived: 0, deleted: 0 };
  }

  if (!artifacts?.put) {
    logOpError("cron.audit_archive_binding_missing", { row_count: rows.length });
    return { archived: 0, deleted: 0 };
  }

  const archived = await archiveAuditRows(artifacts, rows);
  const deleted = await deleteAuditRowsByIds(
    executor,
    rows.map((row) => row.id),
  );
  return { archived, deleted };
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

function subtractDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}
