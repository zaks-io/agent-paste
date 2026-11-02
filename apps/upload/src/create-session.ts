import { ArtifactId, type CreateUploadSessionRequest, type routeContracts } from "@agent-paste/contracts";
import {
  buildCreateUploadSessionWireResponse,
  type Repository,
  resolveSessionObjectKey,
  type UploadSessionFileDescriptor,
  type UploadSessionRecord,
} from "@agent-paste/db";
import { resolveUploadTokenSigner } from "@agent-paste/rotation";
import { mintUploadUrl } from "@agent-paste/tokens/upload-url";
import { type GuardState, getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

type RouteId = (typeof routeContracts)[number]["id"];
type GuardFor<Id extends RouteId> = GuardState<Extract<(typeof routeContracts)[number], { id: Id }>>;

export async function createUploadSession(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"uploadSessions.create">,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = uploadSessionActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const idempotencyKey = guard.idempotencyKey;
  const body: CreateUploadSessionRequest = guard.body;
  let artifactId: string | undefined;
  if (body.artifact_id) {
    const parsedArtifactId = ArtifactId.safeParse(body.artifact_id);
    artifactId = parsedArtifactId.success
      ? parsedArtifactId.data
      : ((await db.resolveArtifactReference({
          actor,
          reference: body.artifact_id,
          ...(env.CONTENT_CAPABILITY_DOMAIN ? { capabilityDomain: env.CONTENT_CAPABILITY_DOMAIN } : {}),
          ...(env.CONTENT_CAPABILITY_HOST_SUFFIX ? { capabilityHostSuffix: env.CONTENT_CAPABILITY_HOST_SUFFIX } : {}),
        })) ?? undefined);
    if (!artifactId) {
      return getBoundResponders(context).respondError("artifact_not_found");
    }
  }
  // TTL is omitted so the repository derives it from the workspace tier (ephemeral
  // workspaces are hard-capped at one day). Clients cannot influence artifact lifetime.
  const createRequest = {
    entrypoint: body.entrypoint,
    files: body.files,
    ...(body.commit ? { commit: body.commit } : {}),
    ...(body.deletions ? { deletions: body.deletions } : {}),
    ...(body.prefix_deletions ? { prefix_deletions: body.prefix_deletions } : {}),
    ...(body.more_files !== undefined ? { more_files: body.more_files } : {}),
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(artifactId === undefined ? {} : { artifact_id: artifactId }),
    ...(body.base_revision_id === undefined ? {} : { base_revision_id: body.base_revision_id }),
    ...(body.deleted_paths === undefined ? {} : { deleted_paths: body.deleted_paths }),
  };

  const session = await db.createUploadSession({
    actor,
    idempotencyKey,
    request: createRequest,
    now: new Date().toISOString(),
  });

  return getBoundResponders(context).respondJson(
    await buildCreateUploadSessionWireResponse(session, {
      signPutUrl: (uploadSession, file) => signUploadUrl(request, env, uploadSession, file),
    }),
  );
}

export async function signUploadUrl(
  request: Request,
  env: Env,
  session: UploadSessionRecord,
  file: UploadSessionFileDescriptor,
): Promise<{ url: string; expiresAt: string }> {
  const signer = resolveUploadTokenSigner(env);
  if (!signer) {
    throw new Error("UPLOAD_SIGNING_SECRET is required");
  }
  const expSeconds = Math.floor(Date.now() / 1000) + ttlSeconds(env);
  const url = await mintUploadUrl({
    baseUrl: env.UPLOAD_BASE_URL ?? new URL(request.url).origin,
    secret: signer.signingSecret,
    payload: {
      sid: session.session_id,
      wid: session.workspace_id,
      path: file.path,
      key: resolveSessionObjectKey(session, file.path, file.object_key),
      size: file.size_bytes,
      ...(file.sha256 ? { sha256: file.sha256 } : {}),
      ...(file.chunk_index === undefined ? {} : { ci: file.chunk_index }),
      exp: expSeconds,
    },
  });
  return { url, expiresAt: new Date(expSeconds * 1000).toISOString() };
}

function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}
