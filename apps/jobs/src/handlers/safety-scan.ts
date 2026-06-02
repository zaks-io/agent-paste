import { runCommand, shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import { SafetyScanMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import { resolveSqlExecutor } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import { isEphemeralScannerId } from "../safety/ephemeral-scanner.js";
import { applyMaliciousUrlLockdown } from "../safety/platform-lockdown.js";
import { resolveSafetyScanner } from "../safety/resolve-scanner.js";
import type { SafetyScannerWarning } from "../safety/scanner.js";
import { scanPublishedUrlMalicious } from "../safety/url-scanner.js";

type RevisionRow = {
  status: string;
  artifact_status: string;
  entrypoint: string;
};

type RevisionFileRow = {
  path: string;
  r2_key: string;
  served_content_type: string;
};

type ExistingWarningRow = {
  code: string;
  severity: "info" | "warning";
  scope: "artifact" | "revision" | "file";
  file_path: string | null;
  message: string;
};

type R2ObjectWithBody = {
  body?: ReadableStream | ArrayBuffer | Uint8Array | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

export async function handleSafetyScanBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = SafetyScanMessage.parse(message.body);
      const state = await loadRevisionState(executor, payload.workspace_id, payload.revision_id);
      if (!state) {
        message.ack();
        continue;
      }

      const skip = shouldSkipRevisionQueueWork({
        revisionStatus: state.status,
        artifactStatus: state.artifact_status,
      });
      if (skip) {
        logOp("queue.safety_scan.skipped", {
          revision_id: payload.revision_id,
          reason: skip,
        });
        message.ack();
        continue;
      }

      const getObject = env.ARTIFACTS?.get;
      if (!getObject) {
        throw new Error("artifacts_bucket_missing");
      }

      const files = await loadRevisionFiles(executor, payload.artifact_id, payload.revision_id);
      const scannerFiles = [];
      for (const file of files) {
        const object = await getObject(file.r2_key);
        if (!object?.body) {
          throw new Error(`missing_r2_object:${file.path}`);
        }
        scannerFiles.push({
          path: file.path,
          contentType: file.served_content_type,
          bytes: await readObjectBytes(object),
        });
      }

      const scanner = resolveSafetyScanner(env, payload.scanner_id);
      const warnings = await scanner.scan(scannerFiles);
      const result = await replaceSafetyWarnings(executor, {
        workspaceId: payload.workspace_id,
        artifactId: payload.artifact_id,
        revisionId: payload.revision_id,
        scannerId: payload.scanner_id,
        scannerVersion: payload.scanner_version,
        warnings,
        now: payload.requested_at,
      });
      if (isEphemeralScannerId(payload.scanner_id)) {
        await runEphemeralUrlScanner(executor, env, {
          workspaceId: payload.workspace_id,
          artifactId: payload.artifact_id,
          revisionId: payload.revision_id,
          entrypoint: state.entrypoint,
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
      message.ack();
    } catch (error) {
      logOpError("queue.safety_scan.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}

async function loadRevisionState(
  executor: SqlExecutor,
  workspaceId: string,
  revisionId: string,
): Promise<RevisionRow | null> {
  const result = await executor.query<RevisionRow>(
    `select r.status, r.entrypoint, a.status as artifact_status
     from revisions r
     inner join artifacts a on a.id = r.artifact_id
     where r.workspace_id = $1 and r.id = $2`,
    [workspaceId, revisionId],
  );
  return result.rows[0] ?? null;
}

async function loadRevisionFiles(
  executor: SqlExecutor,
  artifactId: string,
  revisionId: string,
): Promise<RevisionFileRow[]> {
  const result = await executor.query<RevisionFileRow>(
    `select path, r2_key, served_content_type
     from artifact_files
     where artifact_id = $1 and revision_id = $2
     order by path asc`,
    [artifactId, revisionId],
  );
  return result.rows;
}

async function readObjectBytes(object: R2ObjectWithBody): Promise<Uint8Array> {
  if (object.arrayBuffer) {
    return new Uint8Array(await object.arrayBuffer());
  }
  if (object.body instanceof ArrayBuffer) {
    return new Uint8Array(object.body);
  }
  if (object.body instanceof Uint8Array) {
    return object.body;
  }
  if (object.body instanceof ReadableStream) {
    return new Uint8Array(await new Response(object.body).arrayBuffer());
  }
  const unsupportedBody: unknown = object.body;
  const bodyType =
    unsupportedBody === null
      ? "null"
      : unsupportedBody === undefined
        ? "undefined"
        : unsupportedBody instanceof Object
          ? unsupportedBody.constructor.name
          : typeof unsupportedBody;
  throw new Error(`unsupported_r2_object_body:${bodyType}`);
}

async function replaceSafetyWarnings(
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    scannerId: string;
    scannerVersion: string;
    warnings: readonly SafetyScannerWarning[];
    now: string;
  },
): Promise<{ warning_count: number; added: number; removed: number; unchanged: number }> {
  const result = await runCommand({
    executor,
    actor: { type: "system", id: "safety_scan", workspaceId: input.workspaceId },
    operation: "scan.write_warning",
    idempotencyKey: `${input.revisionId}:${input.scannerId}:${input.scannerVersion}`,
    workspaceId: input.workspaceId,
    now: input.now,
    handler: async (tx) => {
      const existing = await tx.query<ExistingWarningRow>(
        `select code, severity, scope, file_path, message
         from safety_warnings
         where workspace_id = $1 and revision_id = $2 and scanner_id = $3
         order by scope asc, file_path asc nulls first, code asc`,
        [input.workspaceId, input.revisionId, input.scannerId],
      );
      const before = warningKeys(existing.rows);
      const after = warningKeys(input.warnings);
      await tx.query(
        `delete from safety_warnings
         where workspace_id = $1 and revision_id = $2 and scanner_id = $3`,
        [input.workspaceId, input.revisionId, input.scannerId],
      );
      for (const warning of input.warnings) {
        await tx.query(
          `insert into safety_warnings
             (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            createSafetyWarningId(),
            input.workspaceId,
            input.artifactId,
            input.revisionId,
            input.scannerId,
            input.scannerVersion,
            warning.code,
            warning.severity,
            warning.scope,
            warning.file_path ?? null,
            warning.message,
            input.now,
          ],
        );
      }
      const delta = warningDelta(before, after);
      return {
        result: { warning_count: input.warnings.length, ...delta },
        audit:
          delta.added === 0 && delta.removed === 0
            ? []
            : [
                {
                  action: "safety_warnings.replaced",
                  targetType: "revision",
                  targetId: input.revisionId,
                  details: {
                    scanner_id: input.scannerId,
                    scanner_version: input.scannerVersion,
                    warning_count: input.warnings.length,
                    added: delta.added,
                    removed: delta.removed,
                    unchanged: delta.unchanged,
                  },
                },
              ],
      };
    },
  });
  return result.result;
}

function warningKeys(warnings: readonly ExistingWarningRow[] | readonly SafetyScannerWarning[]): Set<string> {
  return new Set(
    warnings.map((warning) =>
      [
        warning.code,
        warning.severity,
        warning.scope,
        "file_path" in warning ? (warning.file_path ?? "") : "",
        warning.message,
      ].join("\0"),
    ),
  );
}

function warningDelta(before: Set<string>, after: Set<string>) {
  let added = 0;
  let unchanged = 0;
  for (const key of after) {
    if (before.has(key)) {
      unchanged += 1;
    } else {
      added += 1;
    }
  }
  let removed = 0;
  for (const key of before) {
    if (!after.has(key)) {
      removed += 1;
    }
  }
  return { added, removed, unchanged };
}

function createSafetyWarningId(): string {
  const value = crypto.randomUUID();
  return `warn_${value.replaceAll("-", "")}`;
}

async function runEphemeralUrlScanner(
  executor: SqlExecutor,
  env: Env,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    entrypoint: string;
    requestedAt: string;
  },
): Promise<void> {
  const apiBase = env.API_BASE_URL?.replace(/\/+$/, "");
  if (!apiBase) {
    return;
  }
  const publishedUrl = `${apiBase}/v1/public/agent-view/${input.artifactId}.${input.revisionId}`;
  const verdict = await scanPublishedUrlMalicious({
    url: publishedUrl,
    ...(env.CLOUDFLARE_ACCOUNT_ID ? { accountId: env.CLOUDFLARE_ACCOUNT_ID } : {}),
    ...(env.URL_SCANNER_API_TOKEN ? { apiToken: env.URL_SCANNER_API_TOKEN } : {}),
  });
  if (verdict !== "malicious") {
    return;
  }
  await applyMaliciousUrlLockdown(executor, env, {
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
    revisionId: input.revisionId,
    now: input.requestedAt,
  });
}
