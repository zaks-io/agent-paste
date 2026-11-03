import type { Repository } from "@agent-paste/db";
import { RepositoryRouteError } from "./responses.js";

export async function requireFileMap(
  db: Repository,
  input: { workspaceId: string; revisionId: string },
): Promise<void> {
  let result: Awaited<ReturnType<Repository["ensureRevisionFileMap"]>>;
  try {
    result = await db.ensureRevisionFileMap(input);
  } catch (error) {
    throw new RepositoryRouteError("storage_unavailable", undefined, { cause: error });
  }
  if (result === "not_live") throw new RepositoryRouteError("not_found");
}

export async function requireViewFileMap(db: Repository, view: unknown, workspaceId?: string): Promise<void> {
  if (!view || typeof view !== "object" || !("file_map" in view) || !view.file_map) return;
  const workspace = workspaceId ?? ("workspace_id" in view ? view.workspace_id : undefined);
  if (typeof workspace !== "string" || !("revision_id" in view) || typeof view.revision_id !== "string")
    throw new RepositoryRouteError("storage_unavailable");
  await requireFileMap(db, { workspaceId: workspace, revisionId: view.revision_id });
}
