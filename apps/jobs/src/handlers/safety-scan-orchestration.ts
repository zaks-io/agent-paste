import { shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import type { SafetyScanMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { withWorkspaceScope } from "../db.js";
import type { Env } from "../env.js";
import { logOp } from "../op-log.js";
import { isEphemeralScannerId } from "../safety/ephemeral-scanner.js";
import { resolveSafetyScanner } from "../safety/resolve-scanner.js";
import { runEphemeralUrlScanner } from "./safety-ephemeral-url-scan.js";
import { loadScannerFiles } from "./safety-scan-files.js";
import { replaceSafetyWarnings } from "./safety-warning-storage.js";

type RevisionRow = {
  status: string;
  artifact_status: string;
};

export type SafetyScanSkipReason = "missing_revision" | ReturnType<typeof shouldSkipRevisionQueueWork>;

export type SafetyScanMessageResult = {
  warning_count: number;
  added: number;
  removed: number;
  unchanged: number;
};

export async function processSafetyScanMessage(
  payload: SafetyScanMessage,
  env: Env,
  executor: SqlExecutor,
): Promise<SafetyScanMessageResult | null> {
  const scoped = withWorkspaceScope(executor, payload.workspace_id);
  const skipReason = await resolveSafetyScanSkipReason(scoped, payload);
  if (skipReason) {
    if (skipReason !== "missing_revision") {
      logOp("queue.safety_scan.skipped", {
        revision_id: payload.revision_id,
        reason: skipReason,
      });
    }
    return null;
  }

  const getObject = env.ARTIFACTS?.get;
  if (!getObject) {
    throw new Error("artifacts_bucket_missing");
  }
  const encryptionRing = artifactBytesEncryptionRingFromEnv(env);
  if (!encryptionRing) {
    throw new Error("artifact_bytes_ring_missing");
  }

  const scannerFiles = await loadScannerFiles(scoped, {
    workspaceId: payload.workspace_id,
    artifactId: payload.artifact_id,
    revisionId: payload.revision_id,
    getObject,
    encryptionRing,
  });
  const scanner = resolveSafetyScanner(env, payload.scanner_id);
  const warnings = await scanner.scan(scannerFiles);
  const result = await replaceSafetyWarnings(scoped, {
    workspaceId: payload.workspace_id,
    artifactId: payload.artifact_id,
    revisionId: payload.revision_id,
    scannerId: payload.scanner_id,
    scannerVersion: payload.scanner_version,
    warnings,
    now: payload.requested_at,
  });
  if (isEphemeralScannerId(payload.scanner_id)) {
    await runEphemeralUrlScanner(scoped, env, {
      workspaceId: payload.workspace_id,
      artifactId: payload.artifact_id,
      revisionId: payload.revision_id,
      requestedAt: payload.requested_at,
    });
  }
  logOp("queue.safety_scan.completed", {
    revision_id: payload.revision_id,
    scanner_id: payload.scanner_id,
    scanner_version: payload.scanner_version,
    warning_count: result.warning_count,
    added: result.added,
    removed: result.removed,
    unchanged: result.unchanged,
  });
  return result;
}

async function resolveSafetyScanSkipReason(
  scoped: SqlExecutor,
  payload: SafetyScanMessage,
): Promise<SafetyScanSkipReason | null> {
  const state = await loadRevisionState(scoped, payload.workspace_id, payload.revision_id);
  if (!state) {
    return "missing_revision";
  }
  const skip = shouldSkipRevisionQueueWork({
    revisionStatus: state.status,
    artifactStatus: state.artifact_status,
  });
  return skip ?? null;
}

async function loadRevisionState(
  executor: SqlExecutor,
  workspaceId: string,
  revisionId: string,
): Promise<RevisionRow | null> {
  const result = await executor.query<RevisionRow>(
    `select r.status, a.status as artifact_status
     from revisions r
     inner join artifacts a on a.id = r.artifact_id
     where r.workspace_id = $1 and r.id = $2`,
    [workspaceId, revisionId],
  );
  return result.rows[0] ?? null;
}
