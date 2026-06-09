import type { SqlExecutor } from "@agent-paste/db";
import type { R2Bucket } from "../env.js";

export type AuditEventRow = {
  id: string;
  workspace_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  request_id: string | null;
  occurred_at: string;
};

export async function selectExpiringAuditRows(
  executor: SqlExecutor,
  cutoff: string,
  limit: number,
): Promise<AuditEventRow[]> {
  if (limit <= 0) {
    return [];
  }
  const result = await executor.query<AuditEventRow>(
    `select id,
            workspace_id::text as workspace_id,
            actor_type,
            actor_id,
            action,
            target_type,
            target_id,
            details,
            request_id,
            occurred_at
     from operation_events
     where occurred_at < $1
     order by occurred_at asc, id asc
     limit $2`,
    [cutoff, limit],
  );
  return result.rows;
}

export async function archiveAuditRows(bucket: R2Bucket, rows: AuditEventRow[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const putObject = bucket.put;
  if (!putObject) {
    throw new Error("audit_archive_r2_put_unavailable");
  }

  const groups = groupRowsByPartitionDate(rows);
  let archived = 0;
  for (const [partition, partitionRows] of groups) {
    archived += await archivePartitionRows(putObject, bucket, partition, partitionRows);
  }
  return archived;
}

export async function deleteAuditRowsByIds(executor: SqlExecutor, ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const result = await executor.query<{ id: string }>(
    `delete from operation_events
     where id = any($1::text[])
     returning id`,
    [ids],
  );
  return result.rows.length;
}

function groupRowsByPartitionDate(rows: AuditEventRow[]): Map<string, AuditEventRow[]> {
  const groups = new Map<string, AuditEventRow[]>();
  for (const row of rows) {
    const partition = partitionDateFromOccurredAt(row.occurred_at);
    const existing = groups.get(partition);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(partition, [row]);
    }
  }
  return groups;
}

function partitionDateFromOccurredAt(occurredAt: string): string {
  const date = new Date(occurredAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

async function archivePartitionRows(
  putObject: NonNullable<R2Bucket["put"]>,
  bucket: R2Bucket,
  partition: string,
  rows: AuditEventRow[],
): Promise<number> {
  const sortedRows = [...rows].sort((left, right) => left.id.localeCompare(right.id));
  const batchId = await hashBatchIds(sortedRows.map((row) => row.id));
  const key = `audit/${partition}/${batchId}.ndjson`;

  if (bucket.get) {
    const existing = await bucket.get(key);
    if (existing) {
      return sortedRows.length;
    }
  }

  const body = sortedRows.map((row) => JSON.stringify(serializeAuditEventRow(row))).join("\n") + "\n";
  await putObject(key, new TextEncoder().encode(body), {
    httpMetadata: { contentType: "application/x-ndjson" },
  });
  return sortedRows.length;
}

function serializeAuditEventRow(row: AuditEventRow): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    details: row.details,
    request_id: row.request_id,
    occurred_at: row.occurred_at,
  };
}

async function hashBatchIds(ids: string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join("\n")));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
