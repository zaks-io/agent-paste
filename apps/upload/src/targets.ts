import { UploadSessionTargetsResponse } from "@agent-paste/contracts";
import type { Repository, UploadSessionRecord } from "@agent-paste/db";
import { getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import { signUploadUrl } from "./create-session.js";
import type { AppContext } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

export async function uploadTargets(c: AppContext, p: Principal, db: Repository) {
  const actor = uploadSessionActor(p);
  if (!actor) return getBoundResponders(c).respondError("not_authenticated");
  const cursor = c.req.query("cursor");
  const page = await db.listUploadTargets({
    actor,
    sessionId: c.req.param("upload_session_id") ?? "",
    limit: Number(c.req.query("limit") ?? 1000),
    ...(cursor ? { cursor } : {}),
    now: new Date().toISOString(),
  });
  const targets = [];
  const session = {
    session_id: page.upload_session_id,
    workspace_id: page.workspace_id,
    artifact_id: page.artifact_id,
    revision_id: page.revision_id,
  } as UploadSessionRecord;
  for (const t of page.targets) {
    if (t.status === "verify_required") {
      targets.push(t);
      continue;
    }
    const signed = await signUploadUrl(c.req.raw, c.env, session, {
      path: t.path,
      size_bytes: t.size_bytes,
      object_key: t.object_key,
      sha256: t.sha256,
      storage_kind: "blob",
      uploaded_at: null,
      expires_at: page.expires_at,
      content_format: "single",
      verified_at: null,
      ...(t.status === "chunk_upload_required" ? { chunk_index: t.chunk_index } : {}),
    });
    targets.push({
      status: t.status,
      path: t.path,
      ...(t.status === "chunk_upload_required" ? { chunk_index: t.chunk_index } : {}),
      put_url: signed.url,
      required_headers: { "content-length": String(t.size_bytes) },
      expires_at: signed.expiresAt,
    });
  }
  return getBoundResponders(c).respondJson(
    UploadSessionTargetsResponse.parse({
      upload_session_id: page.upload_session_id,
      status: page.status,
      sealed: page.sealed,
      expires_at: page.expires_at,
      remaining: page.remaining,
      targets,
      page_info: page.page_info,
    }),
  );
}
