import {
  type LiveUpdateAudience,
  LiveUpdateAuthorizeRequest,
  LiveUpdateAuthorizeResponse,
  LiveUpdateDisconnectNotify,
  LiveUpdateNotifyMessage,
  LiveUpdatePointer,
  LiveUpdatePublishNotify,
} from "@agent-paste/contracts";
import { type ApiActor, inferRenderMode, type Repository } from "@agent-paste/db";
import { accessLinkSigningRingFromEnv, verifyAccessLinkBlobWithKeyRing } from "@agent-paste/rotation";
import { isAuthorizedStreamInternalRequest } from "@agent-paste/worker-runtime";
import type { Env } from "./index.js";

export type ArtifactLiveBinding = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
};

type LiveUpdatesEnv = Env & {
  ARTIFACT_LIVE?: ArtifactLiveBinding;
};

export type SignAgentViewFn = (
  view: unknown,
  env: Env,
  options?: { accessLinkId?: string; workspaceId?: string },
) => Promise<unknown>;

export type AuthenticateWebFn = (authorization: string, env: Env) => Promise<{ member: ApiActor } | null>;

let signAgentViewImpl: SignAgentViewFn = async (view) => view;
let authenticateWebImpl: AuthenticateWebFn = async () => null;

export function wireLiveUpdateDeps(deps: { signAgentView: SignAgentViewFn; authenticateWeb: AuthenticateWebFn }): void {
  signAgentViewImpl = deps.signAgentView;
  authenticateWebImpl = deps.authenticateWeb;
}

export async function handleLiveUpdateAuthorize(
  request: Request,
  env: LiveUpdatesEnv,
  db: Repository,
): Promise<Response> {
  if (!isAuthorizedStreamInternalRequest(request, env.STREAM_INTERNAL_SECRET)) {
    return jsonError("not_found", 404);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_request", 400);
  }
  const parsed = LiveUpdateAuthorizeRequest.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_request", 400);
  }

  if (parsed.data.kind === "access_link") {
    const authorized = await authorizeAccessLink(env, db, parsed.data);
    if (!authorized) {
      return jsonError("not_found", 404);
    }
    const rateLimited = await enforceArtifactRateLimit(env, authorized.artifact_id);
    if (rateLimited) {
      return rateLimited;
    }
    return jsonOk(authorized);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return jsonError("not_found", 404);
  }
  const authorized = await authorizeDashboard(env, db, parsed.data.artifact_id, authorization);
  return authorized ? jsonOk(authorized) : jsonError("not_found", 404);
}

async function authorizeAccessLink(
  env: LiveUpdatesEnv,
  db: Repository,
  input: { public_id: string; blob: string },
): Promise<LiveUpdateAuthorizeResponse | null> {
  const ring = accessLinkSigningRingFromEnv(env);
  if (!ring) {
    return null;
  }
  const verified = await verifyAccessLinkBlobWithKeyRing({ publicId: input.public_id, blob: input.blob }, ring);
  if (!verified) {
    return null;
  }

  const resolved = await db.resolveAccessLink({
    publicId: input.public_id,
    blobScopes: verified.scopes,
    contentBaseUrl: contentBaseUrl(env),
    now: new Date().toISOString(),
  });
  if (!resolved || resolved.access_link_type === "revision") {
    return null;
  }

  const signedView = (await signAgentViewImpl(resolved.agent_view, env, {
    accessLinkId: resolved.access_link_id,
    workspaceId: resolved.workspace_id,
  })) as { view_url?: unknown };
  const viewUrl = signedView.view_url;
  if (typeof viewUrl !== "string") {
    return null;
  }

  const pointer = LiveUpdatePointer.safeParse({
    revision_id: resolved.agent_view.revision_id,
    iframe_src: viewUrl,
    render_mode: resolved.render_mode,
    title: resolved.title,
  });
  if (!pointer.success) {
    return null;
  }
  const authorized = LiveUpdateAuthorizeResponse.safeParse({
    artifact_id: resolved.agent_view.artifact_id,
    audience: "share",
    pointer: pointer.data,
  });
  return authorized.success ? authorized.data : null;
}

async function enforceArtifactRateLimit(env: LiveUpdatesEnv, artifactId: string): Promise<Response | null> {
  const binding = env.ARTIFACT_RATE_LIMIT;
  if (!binding) {
    return null;
  }
  try {
    const outcome = await binding.limit({ key: artifactId });
    if (!outcome.success) {
      return jsonError("rate_limited_artifact", 429, { "Retry-After": "60" });
    }
  } catch (error) {
    console.warn("Artifact rate limit binding failed; allowing live update authorize.", error);
  }
  return null;
}

async function authorizeDashboard(
  env: LiveUpdatesEnv,
  db: Repository,
  artifactId: string,
  authorization: string,
): Promise<LiveUpdateAuthorizeResponse | null> {
  const identity = await authenticateWebImpl(authorization, env);
  if (!identity?.member) {
    return null;
  }
  const actor = identity.member;
  const view = await db.getAgentView({
    actor,
    artifactId,
    contentBaseUrl: contentBaseUrl(env),
  });
  if (!view) {
    return null;
  }
  const signedView = (await signAgentViewImpl(view, env, { workspaceId: actor.workspace_id })) as {
    view_url?: unknown;
  };
  const viewUrl = signedView.view_url;
  if (typeof viewUrl !== "string") {
    return null;
  }
  const pointer = LiveUpdatePointer.safeParse({
    revision_id: view.revision_id,
    iframe_src: viewUrl,
    render_mode: inferRenderMode(view.entrypoint),
    title: view.title,
  });
  if (!pointer.success) {
    return null;
  }
  const authorized = LiveUpdateAuthorizeResponse.safeParse({
    artifact_id: view.artifact_id,
    audience: "dashboard",
    pointer: pointer.data,
  });
  return authorized.success ? authorized.data : null;
}

export async function buildPointerFromPublishResult(
  _env: Env,
  signedPublish: unknown,
  entrypoint: string,
  title: string,
): Promise<LiveUpdatePointer | null> {
  if (!signedPublish || typeof signedPublish !== "object") {
    return null;
  }
  const data = signedPublish as { artifact_id?: unknown; revision_id?: unknown; view_url?: unknown };
  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return null;
  }
  const viewUrl = data.view_url;
  if (typeof viewUrl !== "string") {
    return null;
  }
  const parsed = LiveUpdatePointer.safeParse({
    revision_id: data.revision_id,
    iframe_src: viewUrl,
    render_mode: inferRenderMode(entrypoint),
    title,
  });
  return parsed.success ? parsed.data : null;
}

export async function notifyLiveUpdatePublish(
  env: LiveUpdatesEnv,
  input: { artifactId: string; pointer: LiveUpdatePointer },
): Promise<void> {
  const message = LiveUpdatePublishNotify.safeParse({
    op: "publish",
    artifact_id: input.artifactId,
    pointer: input.pointer,
  });
  if (!message.success) {
    return;
  }
  await notifyArtifactLive(env, message.data);
}

export async function notifyLiveUpdateDisconnect(
  env: LiveUpdatesEnv,
  input: { artifactId: string; audiences: LiveUpdateAudience[]; reason: LiveUpdateDisconnectNotify["reason"] },
): Promise<void> {
  const message = LiveUpdateDisconnectNotify.safeParse({
    op: "disconnect",
    artifact_id: input.artifactId,
    audiences: input.audiences,
    reason: input.reason,
  });
  if (!message.success) {
    return;
  }
  await notifyArtifactLive(env, message.data);
}

export async function notifyLiveUpdateDisconnectWorkspace(
  env: LiveUpdatesEnv,
  db: Repository,
  input: { workspaceId: string; audiences: LiveUpdateAudience[]; reason: LiveUpdateDisconnectNotify["reason"] },
): Promise<void> {
  if (!db.listArtifacts) {
    return;
  }
  try {
    const listed = await db.listArtifacts(input.workspaceId, "active");
    await Promise.all(
      listed.data.map(async (row) => {
        try {
          await notifyLiveUpdateDisconnect(env, {
            artifactId: row.id,
            audiences: input.audiences,
            reason: input.reason,
          });
        } catch (error) {
          console.warn("Live update workspace disconnect fan-out failed for one artifact.", {
            workspaceId: input.workspaceId,
            artifactId: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  } catch (error) {
    console.warn("Live update workspace disconnect listing failed; durable state remains committed.", {
      workspaceId: input.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyArtifactLive(env: LiveUpdatesEnv, message: LiveUpdateNotifyMessage): Promise<void> {
  if (!env.ARTIFACT_LIVE) {
    return;
  }
  const parsed = LiveUpdateNotifyMessage.safeParse(message);
  if (!parsed.success) {
    return;
  }
  const artifactId = parsed.data.artifact_id;
  try {
    const id = env.ARTIFACT_LIVE.idFromName(artifactId);
    const stub = env.ARTIFACT_LIVE.get(id);
    const response = await stub.fetch(
      new Request("https://artifact-live/internal/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      }),
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("Live update notify failed; durable state remains committed.", {
        artifactId,
        op: parsed.data.op,
        status: response.status,
        body,
      });
    }
  } catch (error) {
    console.warn("Live update notify failed; durable state remains committed.", {
      artifactId,
      op: parsed.data.op,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function contentBaseUrl(env: Env): string {
  return env.CONTENT_BASE_URL ?? "http://127.0.0.1:8789";
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(code: string, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
