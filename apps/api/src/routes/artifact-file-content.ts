import { Mebibytes } from "@agent-paste/contracts";
import type { ApiActor, Repository } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { decodeUtf8Strict, readStoredFilePrefix, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { resolveArtifactReference } from "../artifact-reference.js";
import type { AppContext } from "../env.js";
import { workspaceApiActor } from "../principals.js";
import { executeRepositoryRoute, RepositoryRouteError } from "../responses.js";
import { contentBaseUrl } from "../runtime.js";
import { inspectMappedFile } from "../stored-file-target.js";

type FileContentParams = { artifactId: string; path: string; revisionId?: string };

// File maps authorize paths independently of the bounded agent view. Large
// chunked files return byte-inspected metadata while the edit workflow keeps
// inline UTF-8 bodies for small files.
export async function readArtifactFileContent(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: FileContentParams,
): Promise<Response> {
  const env = context.env;
  const responders = getBoundResponders(context);
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return responders.respondError("not_authenticated");
  }
  if (!params.path) {
    return responders.respondError("not_found");
  }

  const artifactId = await resolveArtifactReference(db, actor, env, params.artifactId);
  if (artifactId === null) {
    return responders.respondError("not_found");
  }

  return executeRepositoryRoute(context, async () => {
    const mapped = await inspectMappedFile({
      env,
      db,
      actor,
      artifactId,
      path: params.path,
      ...(params.revisionId ? { revisionId: params.revisionId } : {}),
    });
    if (mapped !== undefined) {
      if (mapped === null) throw new RepositoryRouteError("not_found");
      return mapped;
    }
    return readLegacyFileContentData(context, db, actor, { ...params, artifactId });
  });
}

async function readLegacyFileContentData(
  context: AppContext,
  db: Repository,
  actor: ApiActor,
  params: FileContentParams,
): Promise<Record<string, unknown>> {
  const env = context.env;
  const artifactId = params.artifactId;
  const view = await db.getAgentView(buildViewInput(actor, { ...params, artifactId }, contentBaseUrl(env)));
  const file = view?.files.find((entry) => entry.path === params.path);
  if (!file?.sha256) {
    throw new RepositoryRouteError("not_found");
  }

  // Oversize files are not inlined: return metadata only and skip the R2 read so a
  // large file never forces a full decrypt into memory. body is absent either way;
  // is_binary is inferred from the stored content type (we never read the bytes here),
  // so an oversize binary is not mislabeled as text. Clients key on body===undefined to
  // fetch via url / upload whole, so the flag is advisory on this branch.
  if (file.size_bytes > Mebibytes.ten) {
    const isBinaryByType = typeof file.content_type === "string" ? !file.content_type.startsWith("text/") : true;
    return {
      path: file.path,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
      content_type: file.content_type,
      is_binary: isBinaryByType,
    };
  }

  const ring = artifactBytesEncryptionRingFromEnv(env);
  if (!ring || !env.ARTIFACTS) {
    throw new RepositoryRouteError("storage_unavailable");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readStoredFilePrefix(
      {
        r2: env.ARTIFACTS,
        workspaceId: actor.workspace_id,
        ring,
        file: {
          format: "single",
          objectKey: workspaceBlobObjectKeyFor({ workspaceId: actor.workspace_id, sha256: file.sha256 }),
          sizeBytes: file.size_bytes,
        },
      },
      file.size_bytes,
    );
  } catch {
    // readWorkspaceBlobBytes has exactly one success path (a clean decrypt of a
    // present, well-formed blob). Every throw — missing object, bad/absent metadata,
    // an unknown kid or AAD/auth-tag rejection from the ring — is an operational or
    // crypto condition on a row we already validated, not a client error. All map to
    // storage_unavailable (503, retryable), never a 500 (ADR 0090).
    throw new RepositoryRouteError("storage_unavailable");
  }

  const decoded = decodeUtf8Strict(bytes);
  const isBinary = decoded === null;
  return {
    path: file.path,
    sha256: file.sha256,
    size_bytes: file.size_bytes,
    content_type: file.content_type,
    is_binary: isBinary,
    ...(isBinary ? {} : { body: decoded }),
  };
}

function buildViewInput(actor: ApiActor, params: FileContentParams, contentBase: string) {
  const input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string } = {
    actor,
    artifactId: params.artifactId,
    contentBaseUrl: contentBase,
  };
  if (params.revisionId) {
    input.revisionId = params.revisionId;
  }
  return input;
}
