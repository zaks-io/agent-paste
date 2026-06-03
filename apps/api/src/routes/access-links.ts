import type { Repository } from "@agent-paste/db";
import { resolveAccessLinkSigner } from "@agent-paste/rotation";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { signAgentViewContentUrls } from "../agent-view.js";
import type { AppContext, Env } from "../env.js";
import { workspaceApiActor } from "../principals.js";
import { executeRepositoryRoute, runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";
import { contentBaseUrl, webBaseUrl } from "../runtime.js";

export async function createAccessLinkRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"accessLinks.create">,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const body = guard.body;
  const idempotencyKey = guard.idempotencyKey;
  return executeRepositoryRoute(
    context,
    () =>
      db.createMemberAccessLink({
        actor,
        idempotencyKey,
        artifactId: context.req.param("artifact_id") ?? "",
        type: body.type,
        revisionId: body.revision_id ?? null,
      }),
    { successStatus: 201 },
  );
}

export async function mintAccessLinkRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const signing = accessLinkSigningSecret(context.env);
  if (!signing) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  return runIdempotent(context, () =>
    db.mintMemberAccessLink({
      actor,
      accessLinkId: context.req.param("access_link_id") ?? "",
      appBaseUrl: webBaseUrl(context.env),
      signingSecret: signing.secret,
      signingKid: signing.kid,
    }),
  );
}

export async function listAccessLinksRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const result = await db.listMemberAccessLinks(actor, context.req.param("artifact_id") ?? "");
  return result
    ? getBoundResponders(context).respondJson(result)
    : getBoundResponders(context).respondError("artifact_not_found");
}

export async function revokeAccessLinkRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  return executeRepositoryRoute(context, () =>
    db.revokeMemberAccessLink({
      actor,
      accessLinkId: context.req.param("access_link_id") ?? "",
    }),
  );
}

export async function resolveAccessLinkRoute(
  context: AppContext,
  db: Repository,
  guard: GuardFor<"accessLinks.resolve">,
): Promise<Response> {
  const env = context.env as Env;
  const body = guard.body;
  const signer = resolveAccessLinkSigner(env);
  if (!signer) {
    return getBoundResponders(context).respondError("not_found");
  }
  const verified = await signer.verify({ publicId: body.public_id, blob: body.blob });
  if (!verified) {
    return getBoundResponders(context).respondError("not_found");
  }

  const resolved = await db.resolveAccessLink({
    publicId: body.public_id,
    blobScopes: verified.scopes,
    contentBaseUrl: contentBaseUrl(env),
    now: new Date().toISOString(),
  });
  if (!resolved) {
    return getBoundResponders(context).respondError("not_found");
  }

  const rateLimited = await enforceArtifactRateLimit(context, resolved.agent_view.artifact_id);
  if (rateLimited) {
    return rateLimited;
  }

  const signedView = await signAgentViewContentUrls(resolved.agent_view, env, {
    accessLinkId: resolved.access_link_id,
    workspaceId: resolved.workspace_id,
  });
  const view = signedView as { view_url?: string; title?: string };
  return getBoundResponders(context).respondJson({
    agent_view: signedView,
    render_mode: resolved.render_mode,
    title: resolved.title,
    iframe_src: typeof view.view_url === "string" ? view.view_url : resolved.iframe_src,
  });
}

function accessLinkSigningSecret(env: Env): { secret: string; kid: number } | null {
  const signer = resolveAccessLinkSigner(env);
  if (!signer) {
    return null;
  }
  return { secret: signer.signingSecret, kid: signer.signingKid };
}

async function enforceArtifactRateLimit(context: AppContext, artifactId: string): Promise<Response | null> {
  const binding = context.env.ARTIFACT_RATE_LIMIT;
  if (!binding) {
    return null;
  }
  try {
    const outcome = await binding.limit({ key: artifactId });
    if (!outcome.success) {
      return getBoundResponders(context).respondError("rate_limited_artifact", { headers: { "Retry-After": "60" } });
    }
  } catch (error) {
    console.warn("Artifact rate limit binding failed; allowing access link resolve.", error);
  }
  return null;
}
