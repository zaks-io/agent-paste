import type { SqlQueryResult, SqlValue } from "../types.js";
import type { HandlerContext } from "./types.js";

export function handleContentBlobGc<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("delete from content_blobs") || !normalized.includes("returning workspace_id")) {
    return null;
  }
  const now = String(params[0]);
  const limit = Number(params[1] ?? 0);
  const rows = [];
  for (const [key, blob] of context.state.contentBlobs) {
    if (rows.length >= limit) {
      break;
    }
    if (isReferenced(context, blob, now)) {
      continue;
    }
    context.state.contentBlobs.delete(key);
    rows.push({
      workspace_id: blob.workspace_id,
      sha256: blob.sha256,
      size_bytes: blob.size_bytes,
      r2_key: blob.r2_key,
    });
  }
  return { rows: rows as Row[] };
}

function isReferenced(
  context: HandlerContext,
  blob: { workspace_id: string; sha256: string; size_bytes: number },
  now: string,
) {
  for (const file of context.state.artifactFiles.values()) {
    const revision = file.revision_id ? context.state.revisions.get(file.revision_id) : null;
    const artifact = file.artifact_id ? context.state.artifacts.get(file.artifact_id) : null;
    if (
      file.workspace_id === blob.workspace_id &&
      file.sha256 === blob.sha256 &&
      file.size_bytes === blob.size_bytes &&
      file.storage_kind === "blob" &&
      artifact?.status === "active" &&
      (revision?.status === "draft" || revision?.status === "published")
    ) {
      return true;
    }
  }
  for (const file of context.state.uploadSessionFiles.values()) {
    const session = file.upload_session_id ? context.state.uploadSessions.get(file.upload_session_id) : null;
    if (
      file.workspace_id === blob.workspace_id &&
      file.sha256 === blob.sha256 &&
      file.size_bytes === blob.size_bytes &&
      file.storage_kind === "blob" &&
      session?.status === "pending" &&
      new Date(session.expires_at).getTime() > new Date(now).getTime()
    ) {
      return true;
    }
  }
  return false;
}
