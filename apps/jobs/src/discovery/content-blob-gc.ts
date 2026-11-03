import { collectContentBlobGarbage, type SqlExecutor } from "@agent-paste/db";
import { CONTENT_BLOB_GC_SWEEP_CAP } from "../constants.js";
import { withPlatformScope } from "../db.js";
import { logOp } from "../op-log.js";
import type { SweepResult } from "./types.js";

export async function runContentBlobGc(
  executor: SqlExecutor,
  now: string,
  bucket?: { delete(keys: string[]): Promise<unknown> },
): Promise<SweepResult> {
  const result = await collectContentBlobGarbage(withPlatformScope(executor), {
    now,
    limit: CONTENT_BLOB_GC_SWEEP_CAP,
    ...(bucket ? { deleteObjects: (keys: string[]) => bucket.delete(keys) } : {}),
  });
  const cap_hit = result.marked.length === CONTENT_BLOB_GC_SWEEP_CAP;
  logOp("cron.content_blob_gc", { discovered: result.marked.length, deleted_rows: result.deleted, cap_hit });
  return { discovered: result.marked.length, enqueued: 0, cap_hit };
}
