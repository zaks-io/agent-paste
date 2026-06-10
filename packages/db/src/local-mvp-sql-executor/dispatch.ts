import type { SqlQueryResult, SqlValue } from "../types.js";
import { handleArtifactFilesSelect } from "./artifact-files.js";
import { handleArtifactInspect, handleArtifactPurgeRecovery } from "./artifacts.js";
import { handleContentBlobGc } from "./content-blobs.js";
import {
  handleIdempotencyInsert,
  handleIdempotencySelectForUpdate,
  handleIdempotencyUpdateCompleted,
  handleIdempotencyUpdateInFlight,
} from "./idempotency.js";
import { handleOperationEventsInsert } from "./operation-events.js";
import {
  handleRevisionBundleStateJoin,
  handleRevisionBundleStatusUpdate,
  handleRevisionBytesPurgeEnqueue,
} from "./revisions.js";
import {
  handleSafetyWarningsDelete,
  handleSafetyWarningsInsert,
  handleSafetyWarningsSelect,
} from "./safety-warnings.js";
import { normalizeSql } from "./shared.js";
import type { HandlerContext, StatementHandler } from "./types.js";

const statementHandlers: readonly StatementHandler[] = [
  handleIdempotencyInsert,
  handleIdempotencySelectForUpdate,
  handleIdempotencyUpdateInFlight,
  handleIdempotencyUpdateCompleted,
  handleSafetyWarningsSelect,
  handleSafetyWarningsDelete,
  handleSafetyWarningsInsert,
  handleOperationEventsInsert,
  handleRevisionBundleStateJoin,
  handleArtifactFilesSelect,
  handleRevisionBytesPurgeEnqueue,
  handleRevisionBundleStatusUpdate,
  handleArtifactInspect,
  handleArtifactPurgeRecovery,
  handleContentBlobGc,
];

export function dispatchLocalMvpSqlQuery<Row = Record<string, unknown>>(
  sql: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> {
  const normalized = normalizeSql(sql);
  for (const handler of statementHandlers) {
    const result = handler<Row>(normalized, params, context);
    if (result !== null) {
      return result;
    }
  }
  return { rows: [] as Row[] };
}
