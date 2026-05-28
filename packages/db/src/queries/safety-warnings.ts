import { and, asc, eq } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { safetyWarnings } from "../schema.js";
import type { SafetyWarning } from "../types.js";

export const safetyWarningQueries = {
  async listForRevision(db: DrizzleDb, workspaceId: string, revisionId: string): Promise<SafetyWarning[]> {
    const rows = await db
      .select()
      .from(safetyWarnings)
      .where(and(eq(safetyWarnings.workspaceId, workspaceId), eq(safetyWarnings.revisionId, revisionId)))
      .orderBy(
        asc(safetyWarnings.scope),
        asc(safetyWarnings.filePath),
        asc(safetyWarnings.code),
        asc(safetyWarnings.scannerId),
        asc(safetyWarnings.id),
      );
    return rows.map(mapSafetyWarning);
  },
};

function mapSafetyWarning(row: typeof safetyWarnings.$inferSelect): SafetyWarning {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    artifact_id: row.artifactId,
    revision_id: row.revisionId,
    scanner_id: row.scannerId,
    scanner_version: row.scannerVersion,
    code: row.code,
    severity: row.severity as SafetyWarning["severity"],
    scope: row.scope as SafetyWarning["scope"],
    file_path: row.filePath,
    message: row.message,
    created_at: row.createdAt.toISOString(),
  };
}
