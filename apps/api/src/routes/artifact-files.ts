import { FILE_LIST_PAGE_MAX, READ_GRANT_TTL_SECONDS } from "@agent-paste/config";
import { FilePath, RevisionId } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import { resolveContentTokenSigner } from "@agent-paste/rotation";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { resolveArtifactReference } from "../artifact-reference.js";
import type { AppContext } from "../env.js";
import { parsePagination } from "../pagination.js";
import { workspaceApiActor } from "../principals.js";
import { executeRepositoryRoute, RepositoryRouteError } from "../responses.js";
import { contentBaseUrl } from "../runtime.js";

export async function listArtifactFiles(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = workspaceApiActor(principal);
  const responders = getBoundResponders(context);
  if (!actor) return responders.respondError("not_authenticated");
  const pagination = parsePagination(context.req.raw, FILE_LIST_PAGE_MAX);
  const revisionId = context.req.query("revision_id");
  const prefix = context.req.query("prefix");
  if (!pagination.ok) return responders.respondError(pagination.code);
  if (
    (revisionId !== undefined && !RevisionId.safeParse(revisionId).success) ||
    (prefix !== undefined && !FilePath.safeParse(prefix).success)
  )
    return responders.respondError("invalid_request");
  const artifactId = await resolveArtifactReference(db, actor, context.env, context.req.param("artifact_id") ?? "");
  if (artifactId === null) return responders.respondError("artifact_not_found");
  return executeRepositoryRoute(context, async () => {
    const result = await db.listArtifactFiles({
      actor,
      artifactId,
      ...pagination.value,
      ...(revisionId ? { revisionId } : {}),
      ...(prefix ? { prefix } : {}),
    });
    if (!result) throw new RepositoryRouteError("artifact_not_found");
    return result;
  });
}

export async function revisionReadGrant(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = workspaceApiActor(principal);
  const responders = getBoundResponders(context);
  if (!actor) return responders.respondError("not_authenticated");
  const revisionId = context.req.query("revision_id");
  if (revisionId !== undefined && !RevisionId.safeParse(revisionId).success)
    return responders.respondError("invalid_request");
  const artifactId = await resolveArtifactReference(db, actor, context.env, context.req.param("artifact_id") ?? "");
  if (artifactId === null) return responders.respondError("artifact_not_found");
  return executeRepositoryRoute(context, async () => {
    const target = await db.getRevisionReadTarget({ actor, artifactId, ...(revisionId ? { revisionId } : {}) });
    if (!target) throw new RepositoryRouteError("artifact_not_found");
    if (target.workspaceId !== actor.workspace_id) throw new RepositoryRouteError("artifact_not_found");
    const signer = resolveContentTokenSigner(context.env);
    if (!signer || (!target.fileMap && !target.objectKeys)) throw new RepositoryRouteError("storage_unavailable");
    const exp = Math.floor(Date.now() / 1000) + READ_GRANT_TTL_SECONDS;
    const token = await signer.sign({
      workspace_id: target.workspaceId,
      artifact_id: target.artifactId,
      revision_id: target.revisionId,
      exp,
      original_bytes: true,
      script_disabled: target.ephemeralTier,
      ...(target.ephemeralTier ? { noindex: true } : {}),
      ...(target.fileMap
        ? { file_map: target.fileMap }
        : { object_keys: target.objectKeys as Record<string, string>, paths: Object.keys(target.objectKeys ?? {}) }),
    });
    return {
      artifact_id: target.artifactId,
      revision_id: target.revisionId,
      file_count: target.fileCount,
      size_bytes: target.sizeBytes,
      content_base_url: `${contentBaseUrl(context.env).replace(/\/+$/u, "")}/v/${token}/`,
      expires_at: new Date(exp * 1000).toISOString(),
    };
  });
}

export async function storageUsage(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) return getBoundResponders(context).respondError("not_authenticated");
  return executeRepositoryRoute(context, () => db.getStorageUsage({ actor, now: new Date().toISOString() }));
}
