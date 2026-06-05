import type { SqlQueryResult, SqlValue } from "../types.js";
import type { HandlerContext } from "./types.js";

export function handleRevisionBundleStateJoin<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.includes("from revisions r") || !normalized.includes("inner join artifacts a")) {
    return null;
  }
  const workspaceId = String(params[0]);
  const revisionId = String(params[1]);
  const revision = context.state.revisions.get(revisionId);
  if (!revision || revision.workspace_id !== workspaceId) {
    return { rows: [] as Row[] };
  }
  const artifact = context.state.artifacts.get(revision.artifact_id);
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

export function handleRevisionBytesPurgeEnqueue<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("update revisions") || !normalized.includes("bytes_purge_enqueued_at")) {
    return null;
  }
  const workspaceId = String(params[0]);
  const revisionId = String(params[1]);
  const artifactId = String(params[2]);
  const revision = context.state.revisions.get(revisionId);
  if (!revision || revision.workspace_id !== workspaceId || revision.artifact_id !== artifactId) {
    return { rows: [] as Row[] };
  }
  revision.bytes_purge_enqueued_at = new Date().toISOString();
  return { rows: [{ id: revisionId }] as Row[] };
}

export function handleRevisionBundleStatusUpdate<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("update revisions") || !normalized.includes("bundle_status")) {
    return null;
  }
  const workspaceId = String(params[0]);
  const revisionId = String(params[1]);
  const revision = context.state.revisions.get(revisionId);
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
