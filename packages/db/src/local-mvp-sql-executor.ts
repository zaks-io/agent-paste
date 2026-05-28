import type { LocalState } from "./repository/local-state.js";
import type { OperationEvent, SafetyWarning, SqlExecutor, SqlQueryResult, SqlValue } from "./types.js";

type IdempotencyRecord = {
  workspace_id: string | null;
  actor_type: string;
  actor_id: string;
  operation: string;
  idempotency_key: string;
  status: "in_flight" | "completed";
  result_json: unknown | null;
  created_at: string;
  completed_at: string | null;
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function idempotencyKey(record: {
  workspaceId: string | null;
  actorType: string;
  actorId: string;
  operation: string;
  idempotencyKey: string;
}): string {
  return [record.workspaceId ?? "", record.actorType, record.actorId, record.operation, record.idempotencyKey].join(
    "\0",
  );
}

function parseIdempotencyInsert(params: readonly SqlValue[]): IdempotencyRecord | null {
  if (params.length < 6) {
    return null;
  }
  return {
    workspace_id: params[0] === null ? null : String(params[0]),
    actor_type: String(params[1]),
    actor_id: String(params[2]),
    operation: String(params[3]),
    idempotency_key: String(params[4]),
    status: "in_flight",
    result_json: null,
    created_at: String(params[5]),
    completed_at: null,
  };
}

function parseSafetyWarningInsert(params: readonly SqlValue[]): SafetyWarning | null {
  if (params.length < 12) {
    return null;
  }
  return {
    id: String(params[0]),
    workspace_id: String(params[1]),
    artifact_id: String(params[2]),
    revision_id: String(params[3]),
    scanner_id: String(params[4]),
    scanner_version: String(params[5]),
    code: String(params[6]),
    severity: String(params[7]) as SafetyWarning["severity"],
    scope: String(params[8]) as SafetyWarning["scope"],
    file_path: params[9] === null ? null : String(params[9]),
    message: String(params[10]),
    created_at: String(params[11]),
  };
}

function parseOperationEventInsert(params: readonly SqlValue[]): OperationEvent | null {
  if (params.length < 10) {
    return null;
  }
  return {
    id: String(params[0]),
    workspace_id: params[1] === null ? null : String(params[1]),
    actor_type: String(params[2]) as OperationEvent["actor_type"],
    actor_id: params[3] === null ? null : String(params[3]),
    action: String(params[4]),
    target_type: String(params[5]),
    target_id: String(params[6]),
    details:
      typeof params[7] === "string"
        ? (JSON.parse(params[7]) as Record<string, unknown>)
        : params[7] && typeof params[7] === "object" && !Array.isArray(params[7])
          ? (params[7] as Record<string, unknown>)
          : {},
    request_id: params[8] === null ? null : String(params[8]),
    occurred_at: String(params[9]),
  };
}

/**
 * Minimal SQL executor for the local MVP harness so jobs queue handlers can share the
 * in-memory repository with API/upload workers.
 */
export function createLocalMvpSqlExecutor(state: LocalState): SqlExecutor {
  const idempotencyRecords = new Map<string, IdempotencyRecord>();

  const query = async <Row = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlQueryResult<Row>> => {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith("insert into idempotency_records")) {
      const record = parseIdempotencyInsert(params);
      if (!record) {
        return { rows: [] as Row[] };
      }
      const key = idempotencyKey({
        workspaceId: record.workspace_id,
        actorType: record.actor_type,
        actorId: record.actor_id,
        operation: record.operation,
        idempotencyKey: record.idempotency_key,
      });
      if (idempotencyRecords.has(key)) {
        return { rows: [] as Row[] };
      }
      idempotencyRecords.set(key, record);
      return { rows: [{ workspace_id: record.workspace_id }] as Row[] };
    }

    if (normalized.includes("from idempotency_records") && normalized.includes("for update")) {
      const workspaceId = params[0] === null || params[0] === undefined ? null : String(params[0]);
      const key = idempotencyKey({
        workspaceId,
        actorType: String(params[1]),
        actorId: String(params[2]),
        operation: String(params[3]),
        idempotencyKey: String(params[4]),
      });
      const record = idempotencyRecords.get(key);
      if (!record) {
        return { rows: [] as Row[] };
      }
      return {
        rows: [
          {
            status: record.status,
            result_json: record.result_json,
            created_at: record.created_at,
          },
        ] as Row[],
      };
    }

    if (normalized.startsWith("update idempotency_records") && normalized.includes("status = 'in_flight'")) {
      const workspaceId = params[0] === null || params[0] === undefined ? null : String(params[0]);
      const key = idempotencyKey({
        workspaceId,
        actorType: String(params[1]),
        actorId: String(params[2]),
        operation: String(params[3]),
        idempotencyKey: String(params[4]),
      });
      const record = idempotencyRecords.get(key);
      if (record) {
        record.status = "in_flight";
        record.result_json = null;
        record.completed_at = null;
        record.created_at = String(params[5]);
      }
      return { rows: [] as Row[] };
    }

    if (normalized.startsWith("update idempotency_records") && normalized.includes("status = 'completed'")) {
      const workspaceId = params[0] === null || params[0] === undefined ? null : String(params[0]);
      const key = idempotencyKey({
        workspaceId,
        actorType: String(params[1]),
        actorId: String(params[2]),
        operation: String(params[3]),
        idempotencyKey: String(params[4]),
      });
      const record = idempotencyRecords.get(key);
      if (record) {
        record.status = "completed";
        record.result_json = typeof params[5] === "string" ? JSON.parse(params[5]) : params[5];
        record.completed_at = String(params[6]);
      }
      return { rows: [] as Row[] };
    }

    if (normalized.startsWith("select") && normalized.includes("from safety_warnings")) {
      const workspaceId = String(params[0]);
      const revisionId = String(params[1]);
      const scannerId = String(params[2]);
      const rows = [...state.safetyWarnings.values()]
        .filter(
          (warning) =>
            warning.workspace_id === workspaceId &&
            warning.revision_id === revisionId &&
            warning.scanner_id === scannerId,
        )
        .sort((left, right) => {
          const scope = left.scope.localeCompare(right.scope);
          if (scope !== 0) {
            return scope;
          }
          const filePath = (left.file_path ?? "").localeCompare(right.file_path ?? "");
          return filePath === 0 ? left.code.localeCompare(right.code) : filePath;
        })
        .map((warning) => ({
          code: warning.code,
          severity: warning.severity,
          scope: warning.scope,
          file_path: warning.file_path,
          message: warning.message,
        }));
      return { rows: rows as Row[] };
    }

    if (normalized.startsWith("delete from safety_warnings")) {
      const workspaceId = String(params[0]);
      const revisionId = String(params[1]);
      const scannerId = String(params[2]);
      for (const [key, warning] of state.safetyWarnings) {
        if (
          warning.workspace_id === workspaceId &&
          warning.revision_id === revisionId &&
          warning.scanner_id === scannerId
        ) {
          state.safetyWarnings.delete(key);
        }
      }
      return { rows: [] as Row[] };
    }

    if (normalized.startsWith("insert into safety_warnings")) {
      const warning = parseSafetyWarningInsert(params);
      if (warning) {
        state.safetyWarnings.set(warning.id, warning);
      }
      return { rows: [] as Row[] };
    }

    if (normalized.startsWith("insert into operation_events")) {
      const event = parseOperationEventInsert(params);
      if (event) {
        state.operationEvents.set(event.id, event);
      }
      return { rows: [] as Row[] };
    }

    if (normalized.includes("from revisions r") && normalized.includes("inner join artifacts a")) {
      const workspaceId = String(params[0]);
      const revisionId = String(params[1]);
      const revision = state.revisions.get(revisionId);
      if (!revision || revision.workspace_id !== workspaceId) {
        return { rows: [] as Row[] };
      }
      const artifact = state.artifacts.get(revision.artifact_id);
      if (!artifact) {
        return { rows: [] as Row[] };
      }
      return {
        rows: [
          {
            status: revision.status,
            artifact_status: artifact.status,
            bundle_status: revision.bundle_status,
          },
        ] as Row[],
      };
    }

    if (normalized.includes("from artifact_files")) {
      const artifactId = String(params[0]);
      const revisionId = String(params[1]);
      const rows = [...state.artifactFiles.values()]
        .filter((file) => file.artifact_id === artifactId && file.revision_id === revisionId)
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => ({ path: file.path, r2_key: file.r2_key, served_content_type: file.content_type }));
      return { rows: rows as Row[] };
    }

    if (normalized.startsWith("update revisions") && normalized.includes("bytes_purge_enqueued_at")) {
      const workspaceId = String(params[0]);
      const revisionId = String(params[1]);
      const artifactId = String(params[2]);
      const revision = state.revisions.get(revisionId);
      if (!revision || revision.workspace_id !== workspaceId || revision.artifact_id !== artifactId) {
        return { rows: [] as Row[] };
      }
      revision.bytes_purge_enqueued_at = new Date().toISOString();
      return { rows: [{ id: revisionId }] as Row[] };
    }

    if (normalized.startsWith("update revisions") && normalized.includes("bundle_status")) {
      const workspaceId = String(params[0]);
      const revisionId = String(params[1]);
      const revision = state.revisions.get(revisionId);
      if (!revision || revision.workspace_id !== workspaceId || revision.bundle_status !== "pending") {
        return { rows: [] as Row[] };
      }
      if (normalized.includes("bundle_status = 'failed'")) {
        revision.bundle_status = "failed";
        revision.bundle_status_updated_at = new Date().toISOString();
        revision.bundle_size_bytes = null;
      } else {
        revision.bundle_status = "ready";
        revision.bundle_size_bytes = Number(params[2]);
        revision.bundle_status_updated_at = new Date().toISOString();
      }
      return { rows: [] as Row[] };
    }

    if (normalized.includes("from artifacts") && normalized.includes("where id = $1") && params.length === 1) {
      const artifact = state.artifacts.get(String(params[0]));
      if (!artifact) {
        return { rows: [] as Row[] };
      }
      return {
        rows: [
          {
            id: artifact.id,
            workspace_id: artifact.workspace_id,
            revision_id: artifact.revision_id,
            status: artifact.status,
            deleted_at: artifact.deleted_at,
          },
        ] as Row[],
      };
    }

    if (normalized.includes("from artifacts a") && normalized.includes("bytes_purge_enqueued_at is null")) {
      const limit = Number(params[0] ?? 0);
      const rows = [...state.artifacts.values()]
        .filter((artifact) => {
          if (artifact.status !== "deleted" && artifact.status !== "expired") {
            return false;
          }
          if (!artifact.revision_id) {
            return false;
          }
          const revision = state.revisions.get(artifact.revision_id);
          return revision?.bytes_purge_enqueued_at == null;
        })
        .slice(0, limit)
        .map((artifact) => ({
          id: artifact.id,
          workspace_id: artifact.workspace_id,
          revision_id: artifact.revision_id,
          status: artifact.status,
        }));
      return { rows: rows as Row[] };
    }

    return { rows: [] as Row[] };
  };

  const executor: SqlExecutor = {
    query: query as SqlExecutor["query"],
    transaction: async (run) => run(executor),
  };
  return executor;
}
