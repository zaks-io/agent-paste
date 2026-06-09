import type { SqlQueryResult, SqlValue } from "../types.js";
import type { HandlerContext } from "./types.js";

export function handleArtifactInspect<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.includes("from artifacts") || !normalized.includes("where id = $1") || params.length !== 1) {
    return null;
  }
  const artifact = context.state.artifacts.get(String(params[0]));
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

export function handleArtifactPurgeRecovery<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.includes("from artifacts a") || !normalized.includes("bytes_purge_enqueued_at is null")) {
    return null;
  }
  const limit = Number(params[0] ?? 0);
  const rows = [...context.state.artifacts.values()]
    .filter((artifact) => {
      if (artifact.status !== "deleted" && artifact.status !== "expired") {
        return false;
      }
      if (!artifact.revision_id) {
        return false;
      }
      const revision = context.state.revisions.get(artifact.revision_id);
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
