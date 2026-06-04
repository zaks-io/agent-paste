import { FinalizeUploadSessionResponse, type RouteContract } from "@agent-paste/contracts";
import {
  buildCreateUploadSessionWireResponse,
  createPostgresRuntime,
  type Repository,
  type UploadSessionRecord,
} from "@agent-paste/db";
import { getBoundResponders, type HeaderGuardState, type Principal } from "@agent-paste/worker-runtime";
import type { Context } from "hono";
import { signUploadUrl } from "./create-session.js";
import type { AppContext, Env, UploadActor } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

export function postgresRuntime(env: Env) {
  return createPostgresRuntime(env, {
    pickDb: (services) => services.uploadDb,
    resolveServiceUrls: (workerEnv) => ({
      ...(workerEnv.API_BASE_URL ? { apiBaseUrl: workerEnv.API_BASE_URL } : {}),
      ...(workerEnv.CONTENT_BASE_URL ? { contentBaseUrl: workerEnv.CONTENT_BASE_URL } : {}),
    }),
  });
}

export function uploadDatabase(env: Env): Repository | undefined {
  if (isUploadDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

export function isUploadDatabase(value: Env["DB"]): value is Repository {
  return typeof value === "object" && value !== null && "createUploadSession" in value;
}

async function peekUploadReplay<T>(
  db: Repository,
  actor: UploadActor,
  operation: string,
  idempotencyKey: string,
): Promise<T | null> {
  const hit = await db.peekIdempotentReplay({ actor, operation, idempotencyKey });
  return hit && "result" in hit ? (hit.result as T) : null;
}

export async function uploadReplay(input: {
  context: Context;
  contract: RouteContract;
  principal: Principal;
  db: Repository;
  guard: HeaderGuardState;
}): Promise<Response | null> {
  if (!input.guard.idempotencyKey) {
    return null;
  }
  const actor = uploadSessionActor(input.principal);
  if (!actor) {
    return null;
  }
  const context = input.context as AppContext;
  if (input.contract.id === "uploadSessions.create") {
    const replay = await peekUploadReplay<UploadSessionRecord>(
      input.db,
      actor,
      "upload.session.create",
      input.guard.idempotencyKey,
    );
    return replay
      ? getBoundResponders(context).respondJson(
          await buildCreateUploadSessionWireResponse(replay, {
            signPutUrl: (uploadSession, file) =>
              signUploadUrl(context.req.raw, context.env as Env, uploadSession, file),
          }),
        )
      : null;
  }
  if (input.contract.id === "uploadSessions.finalize") {
    const replay = await peekUploadReplay<unknown>(
      input.db,
      actor,
      "upload.session.finalize",
      input.guard.idempotencyKey,
    );
    return replay ? getBoundResponders(context).respondJson(FinalizeUploadSessionResponse.parse(replay)) : null;
  }
  return null;
}
