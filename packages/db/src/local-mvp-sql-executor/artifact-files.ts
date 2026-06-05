import type { SqlQueryResult, SqlValue } from "../types.js";
import type { HandlerContext } from "./types.js";

export function handleArtifactFilesSelect<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.includes("from artifact_files")) {
    return null;
  }
  const artifactId = String(params[0]);
  const revisionId = String(params[1]);
  const rows = [...context.state.artifactFiles.values()]
    .filter((file) => file.artifact_id === artifactId && file.revision_id === revisionId)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({ path: file.path, r2_key: file.r2_key, served_content_type: file.content_type }));
  return { rows: rows as Row[] };
}
