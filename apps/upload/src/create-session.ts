import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { CreateUploadSessionRequest, routeContracts } from "@agent-paste/contracts";
import {
  buildCreateUploadSessionWireResponse,
  type Repository,
  repositoryErrorToAppError,
  resolveSessionObjectKey,
  type UploadSessionRecord,
} from "@agent-paste/db";
import { resolveUploadTokenSigner } from "@agent-paste/rotation";
import { mintUploadUrl } from "@agent-paste/tokens/upload-url";
import { type GuardState, getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import type { AppContext, Env, UploadFileInput } from "./env.js";
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
  // TTL is omitted so the repository derives it from the workspace tier (ephemeral
  // workspaces are hard-capped at one day). Clients cannot influence artifact lifetime.
  const createRequest = {
    title: body.title,
    entrypoint: body.entrypoint,
    files: body.files,
    ...(body.artifact_id === undefined ? {} : { artifact_id: body.artifact_id }),
  };

  let session: UploadSessionRecord;
  try {
    session = await db.createUploadSession({
      actor,
      idempotencyKey,
      request: createRequest,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return getBoundResponders(context).respondError("idempotency_in_flight");
    }
    const repositoryCode = repositoryErrorToAppError(error);
    if (repositoryCode) {
      return getBoundResponders(context).respondError(repositoryCode);
    }
    throw error;
  }

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
  file: UploadFileInput & { object_key?: string },
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
      exp: expSeconds,
    },
  });
  return { url, expiresAt: new Date(expSeconds * 1000).toISOString() };
}

function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}
