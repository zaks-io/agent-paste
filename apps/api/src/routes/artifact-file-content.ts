import { Mebibytes } from "@agent-paste/contracts";
import type { ApiActor, Repository } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { decodeUtf8Strict, readWorkspaceBlobBytes } from "@agent-paste/storage";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";
import { workspaceApiActor } from "../principals.js";
import { contentBaseUrl } from "../runtime.js";

type FileContentParams = { artifactId: string; path: string; revisionId?: string };

// Reads one stored file's decrypted plaintext for the owning Workspace Member so
// an agent can diff against it and revise with a unified-diff patch (ADR 0090).
// The agent already owns the artifact and can fetch the same bytes via
// the signed content url, so returning plaintext here adds no confidentiality
// exposure; it just gives an agent without the working dir a base to diff.
//
// `getAgentView` resolves the artifact + revision + file set under the actor's
// workspace scope (RLS), so a cross-tenant read returns not_found. The blob key is
// DERIVED from the validated row's plaintext sha256 + the actor's workspace id,
// never from client input, and the encryption AAD binds both — a substituted key
// cannot decrypt. is_binary is byte-derived (true binary only). A file over the
// inline cap is returned as metadata with no body WITHOUT reading R2, so a single
// request never buffers a multi-megabyte decrypt (ADR 0063 intent).
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

  const view = await db.getAgentView(buildViewInput(actor, params, contentBaseUrl(env)));
  const file = view?.files.find((entry) => entry.path === params.path);
  if (!file?.sha256) {
    return responders.respondError("not_found");
  }

  // Oversize files are not inlined: return metadata only and skip the R2 read so a
  // large file never forces a full decrypt into memory. body is absent either way;
  // is_binary is inferred from the stored content type (we never read the bytes here),
  // so an oversize binary is not mislabeled as text. Clients key on body===undefined to
  // fetch via url / upload whole, so the flag is advisory on this branch.
  if (file.size_bytes > Mebibytes.ten) {
    const isBinaryByType = typeof file.content_type === "string" ? !file.content_type.startsWith("text/") : true;
    return responders.respondJson({
      path: file.path,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
      content_type: file.content_type,
      is_binary: isBinaryByType,
    });
  }

  const ring = artifactBytesEncryptionRingFromEnv(env);
  if (!ring || !env.ARTIFACTS) {
    return responders.respondError("storage_unavailable");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readWorkspaceBlobBytes({
      r2: env.ARTIFACTS,
      workspaceId: actor.workspace_id,
      sha256: file.sha256,
      ring,
    });
  } catch {
    // readWorkspaceBlobBytes has exactly one success path (a clean decrypt of a
    // present, well-formed blob). Every throw — missing object, bad/absent metadata,
    // an unknown kid or AAD/auth-tag rejection from the ring — is an operational or
    // crypto condition on a row we already validated, not a client error. All map to
    // storage_unavailable (503, retryable), never a 500 (ADR 0090).
    return responders.respondError("storage_unavailable");
  }

  const decoded = decodeUtf8Strict(bytes);
  const isBinary = decoded === null;
  return responders.respondJson({
    path: file.path,
    sha256: file.sha256,
    size_bytes: file.size_bytes,
    content_type: file.content_type,
    is_binary: isBinary,
    ...(isBinary ? {} : { body: decoded }),
  });
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
