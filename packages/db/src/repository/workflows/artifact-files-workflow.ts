import { FILE_LIST_PAGE_MAX } from "@agent-paste/config";
import { isUnderPrefix } from "@agent-paste/contracts";
import { isArtifactExpired } from "../../artifact-expiry.js";
import { isEphemeralWorkspace } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import type { ApiActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { PLATFORM_SCOPE, workspaceScope } from "../core-helpers.js";
import type { PersistentHostingRepository } from "../persistent-hosting-repository.js";
import type { Entities } from "../ports.js";

async function selectedRevision(e: Entities, i: { actor: ApiActor; artifactId: string; revisionId?: string }) {
  const a = await e.artifacts.findById(i.artifactId, i.actor.workspace_id);
  if (!a || a.status !== "active" || isArtifactExpired(a, Date.now())) return null;
  const id = i.revisionId ?? a.revision_id;
  if (!id) return null;
  const r = await e.revisions.findById(id, i.actor.workspace_id);
  return r && r.artifact_id === a.id && r.status === "published" ? { artifact: a, revision: r } : null;
}
async function locked(ctx: RepositoryCoreContext, i: { actor: ApiActor; artifactId: string }) {
  return ctx.uow.read(PLATFORM_SCOPE, async (e) =>
    Boolean(
      (await e.platformLockdowns.findEffective("workspace", i.actor.workspace_id)) ||
        (await e.platformLockdowns.findEffective("artifact", i.artifactId)),
    ),
  );
}
export async function listArtifactFiles(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["listArtifactFiles"]>[0],
) {
  if (await locked(ctx, i)) return null;
  return ctx.uow.read(workspaceScope(i.actor.workspace_id), async (e) => {
    if (!Number.isInteger(i.limit) || i.limit < 1 || i.limit > FILE_LIST_PAGE_MAX)
      repositoryError("invalid_pagination_limit");
    const selected = await selectedRevision(e, i);
    if (!selected) return null;
    const { artifact: a, revision: r } = selected;
    const files = (await e.artifactFiles.listForArtifact(a.id, r.id))
      .filter((f) => isUnderPrefix(f.path, i.prefix ?? null))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    let cursor: string | undefined;
    if (i.cursor)
      try {
        const c = JSON.parse(decodeURIComponent(atob(i.cursor)));
        if (
          !Array.isArray(c) ||
          c.length !== 3 ||
          c[0] !== r.id ||
          c[1] !== (i.prefix ?? null) ||
          typeof c[2] !== "string"
        )
          throw new Error();
        cursor = c[2];
      } catch {
        repositoryError("invalid_cursor");
      }
    const rest = cursor === undefined ? files : files.filter((f) => f.path > (cursor as string));
    const page = rest.slice(0, i.limit);
    const more = rest.length > page.length;
    return {
      artifact_id: a.id,
      revision_id: r.id,
      file_count: r.file_count,
      size_bytes: r.size_bytes,
      entrypoint: r.entrypoint,
      title: a.title,
      items: page.map((f) => ({
        path: f.path,
        size_bytes: f.size_bytes,
        sha256: f.sha256 ?? null,
        content_type: f.content_type,
        format: f.content_format ?? ("single" as const),
      })),
      page_info: {
        has_more: more,
        next_cursor: more
          ? btoa(encodeURIComponent(JSON.stringify([r.id, i.prefix ?? null, page.at(-1)?.path])))
          : null,
      },
    };
  });
}
export async function getRevisionReadTarget(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["getRevisionReadTarget"]>[0],
) {
  if (await locked(ctx, i)) return null;
  return ctx.uow.read(workspaceScope(i.actor.workspace_id), async (e) => {
    const selected = await selectedRevision(e, i);
    if (!selected) return null;
    const { artifact: a, revision: r } = selected;
    const ws = await ctx.mustWorkspace(e, a.workspace_id);
    const fileMap =
      r.file_map_sha256 && r.file_map_size_bytes
        ? { sha256: r.file_map_sha256, size_bytes: r.file_map_size_bytes }
        : null;
    const files = fileMap ? [] : await e.artifactFiles.listForArtifact(a.id, r.id);
    return {
      artifactId: a.id,
      revisionId: r.id,
      workspaceId: a.workspace_id,
      fileMap,
      objectKeys: fileMap ? null : Object.fromEntries(files.map((f) => [f.path, f.r2_key])),
      fileCount: r.file_count,
      sizeBytes: r.size_bytes,
      ephemeralTier: isEphemeralWorkspace(ws),
    };
  });
}
