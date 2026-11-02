import { type AppendUploadFilesRequest, AppendUploadFilesResponse } from "@agent-paste/contracts";
import { buildCreateUploadSessionWireResponse, type Repository } from "@agent-paste/db";
import { getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import { signUploadUrl } from "./create-session.js";
import type { AppContext } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

export async function appendFiles(
  c: AppContext,
  p: Principal,
  db: Repository,
  guard: { body: AppendUploadFilesRequest; idempotencyKey: string },
) {
  const actor = uploadSessionActor(p);
  if (!actor) return getBoundResponders(c).respondError("not_authenticated");
  const session = await db.appendUploadFiles({
    actor,
    idempotencyKey: guard.idempotencyKey,
    sessionId: c.req.param("upload_session_id") ?? "",
    request: guard.body,
    now: new Date().toISOString(),
  });
  return appendFilesResponse(c, session);
}
export async function appendFilesResponse(
  c: AppContext,
  session: Awaited<ReturnType<Repository["appendUploadFiles"]>>,
) {
  const signed = await buildCreateUploadSessionWireResponse(session, {
    signPutUrl: (s, f) => signUploadUrl(c.req.raw, c.env, s, f),
  });
  return getBoundResponders(c).respondJson(
    AppendUploadFilesResponse.parse({
      upload_session_id: session.upload_session_id,
      sealed: session.sealed,
      next_batch_index: session.next_batch_index,
      files: signed.files,
    }),
  );
}
