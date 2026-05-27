import { BytePurgeMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import { UPLOAD_CLEANUP_SWEEP_CAP } from "../constants.js";
import { withPlatformScope } from "../db.js";
import type { QueueBinding } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import type { SweepResult } from "./types.js";

type ExpiredSessionRow = {
  id: string;
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
};

type SessionFileRow = {
  r2_key: string;
};

export async function runUploadCleanupDiscovery(
  executor: SqlExecutor,
  queue: QueueBinding,
  now: string,
): Promise<SweepResult> {
  const platformExecutor = withPlatformScope(executor);
  const limit = UPLOAD_CLEANUP_SWEEP_CAP + 1;
  const sessions = await platformExecutor.query<ExpiredSessionRow>(
    `select id, workspace_id, artifact_id, revision_id
     from upload_sessions
     where status = 'pending' and expires_at <= $1
     order by expires_at asc
     limit $2`,
    [now, limit],
  );
  const cap_hit = sessions.rows.length > UPLOAD_CLEANUP_SWEEP_CAP;
  const batch = sessions.rows.slice(0, UPLOAD_CLEANUP_SWEEP_CAP);
  if (batch.length === 0) {
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }

  let enqueued = 0;
  for (const session of batch) {
    try {
      const files = await platformExecutor.query<SessionFileRow>(
        `select r2_key
         from upload_session_files
         where upload_session_id = $1`,
        [session.id],
      );
      const prefixes = uniquePrefixes(files.rows.map((row) => row.r2_key));
      if (prefixes.length > 0) {
        const message = BytePurgeMessage.parse({
          type: "byte.purge.v1",
          workspace_id: session.workspace_id,
          artifact_id: session.artifact_id,
          revision_id: session.revision_id,
          upload_session_id: session.id,
          prefixes,
          reason: "upload_cleanup",
        });
        await queue.send(message);
        enqueued += 1;
      }
      await expireUploadSession(platformExecutor, session.id, now);
    } catch (error) {
      logOpError("cron.upload_cleanup.session_failed", {
        upload_session_id: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logOp("cron.upload_cleanup", { discovered: batch.length, enqueued, cap_hit });
  return { discovered: batch.length, enqueued, cap_hit };
}

async function expireUploadSession(executor: SqlExecutor, sessionId: string, now: string): Promise<void> {
  await executor.query(
    `update upload_sessions
     set status = 'expired'
     where id = $1 and status = 'pending' and expires_at <= $2`,
    [sessionId, now],
  );
}

function uniquePrefixes(keys: string[]): string[] {
  const prefixes = new Set<string>();
  for (const key of keys) {
    const slash = key.lastIndexOf("/");
    prefixes.add(slash >= 0 ? `${key.slice(0, slash + 1)}` : key);
  }
  return [...prefixes];
}
