import type { SqlQueryResult, SqlValue } from "../types.js";
import { parseSafetyWarningInsert } from "./shared.js";
import type { HandlerContext } from "./types.js";

export function handleSafetyWarningsSelect<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("select") || !normalized.includes("from safety_warnings")) {
    return null;
  }
  const workspaceId = String(params[0]);
  const revisionId = String(params[1]);
  const scannerId = String(params[2]);
  const rows = [...context.state.safetyWarnings.values()]
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

export function handleSafetyWarningsDelete<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("delete from safety_warnings")) {
    return null;
  }
  const workspaceId = String(params[0]);
  const revisionId = String(params[1]);
  const scannerId = String(params[2]);
  for (const [key, warning] of context.state.safetyWarnings) {
    if (
      warning.workspace_id === workspaceId &&
      warning.revision_id === revisionId &&
      warning.scanner_id === scannerId
    ) {
      context.state.safetyWarnings.delete(key);
    }
  }
  return { rows: [] as Row[] };
}

export function handleSafetyWarningsInsert<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("insert into safety_warnings")) {
    return null;
  }
  const warning = parseSafetyWarningInsert(params);
  if (warning) {
    context.state.safetyWarnings.set(warning.id, warning);
  }
  return { rows: [] as Row[] };
}
