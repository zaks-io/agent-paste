import { runCommand } from "@agent-paste/commands";
import { type SqlExecutor, withSqlQuerySource } from "@agent-paste/db";
import type { SafetyScannerWarning } from "../safety/scanner.js";

type ExistingWarningRow = {
  code: string;
  severity: "info" | "warning";
  scope: "artifact" | "revision" | "file";
  file_path: string | null;
  message: string;
};

export async function replaceSafetyWarnings(
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
  const result = await withSource("replaceSafetyWarnings", () =>
    runCommand({
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
    }),
  );
  return result.result;
}

function withSource<T>(functionName: string, run: () => T): T {
  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/handlers/safety-warning-storage.ts",
      functionName,
      namespace: "apps.jobs.src.handlers.safety-warning-storage",
    },
    run,
  );
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
