import type { WebCallbackIdentity, WorkOsIdentity } from "@agent-paste/auth";
import type { CreateApiKeyRequest, UpdateWebSettingsRequest } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { signAgentViewContentUrls } from "../agent-view.js";
import type { AppContext } from "../env.js";
import { parsePagination } from "../pagination.js";
import { webMemberActor } from "../principals.js";
import { errorResponse, executeRepositoryRoute, jsonResponse, runIdempotent } from "../responses.js";
import type { GuardFor, RouteParams } from "../route-contracts.js";
import { CLI_API_KEY_TTL_SECONDS } from "./account.js";

export async function webAuthCallback(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "workos_access_token") {
    return errorResponse(context, "not_authenticated");
  }
  const identity = principal.identity as WorkOsIdentity;
  if (!hasWebCallbackId(identity)) {
    return errorResponse(context, "not_authenticated", "missing WorkOS token_id or session_id");
  }
  const idempotencyKey = webCallbackIdempotencyKey(identity);
  return runIdempotent(context, () =>
    db.resolveWebMember({
      workosUserId: identity.workos_user_id,
      email: identity.email,
      idempotencyKey,
      now: new Date().toISOString(),
    }),
  );
}

function hasWebCallbackId(identity: WorkOsIdentity): identity is WebCallbackIdentity {
  return (
    (typeof identity.token_id === "string" && identity.token_id.length > 0) ||
    (typeof identity.session_id === "string" && identity.session_id.length > 0)
  );
}

function webCallbackIdempotencyKey(identity: WebCallbackIdentity): string {
  if (identity.token_id) {
    return `workos-jti:${identity.token_id}`;
  }
  return `workos-session:${identity.session_id}`;
}

export async function webWorkspace(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  return actor ? jsonResponse(context, await db.getWebWorkspace(actor)) : errorResponse(context, "forbidden");
}

export async function webArtifacts(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  return executeRepositoryRoute(context, () => db.listWebArtifacts(actor, pagination.value));
}

export async function webArtifactDetail(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const detail = await db.getWebArtifact(actor, params.artifactId ?? "");
  if (!detail) {
    return errorResponse(context, "not_found");
  }
  if (detail.viewer) {
    const signed = (await signAgentViewContentUrls(
      {
        artifact_id: detail.id,
        revision_id: detail.latest_revision_id,
        entrypoint: detail.entrypoint,
        view_url: detail.viewer.iframe_src,
      },
      context.env,
      { workspaceId: actor.workspace_id },
    )) as { view_url?: unknown };
    const iframeSrc = typeof signed.view_url === "string" ? signed.view_url : detail.viewer.iframe_src;
    return jsonResponse(context, { ...detail, viewer: { ...detail.viewer, iframe_src: iframeSrc } });
  }
  return jsonResponse(context, detail);
}

export async function webPinArtifact(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.artifacts.pin">,
  params: RouteParams,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  if (!db.pinWebArtifact) {
    return errorResponse(context, "database_unavailable");
  }
  const pinWebArtifact = db.pinWebArtifact.bind(db);
  const idempotencyKey = guard.idempotencyKey;
  return runIdempotent(context, () => pinWebArtifact({ actor, idempotencyKey, artifactId: params.artifactId ?? "" }));
}

export async function webUnpinArtifact(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.artifacts.unpin">,
  params: RouteParams,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  if (!db.unpinWebArtifact) {
    return errorResponse(context, "database_unavailable");
  }
  const unpinWebArtifact = db.unpinWebArtifact.bind(db);
  const idempotencyKey = guard.idempotencyKey;
  return runIdempotent(context, () => unpinWebArtifact({ actor, idempotencyKey, artifactId: params.artifactId ?? "" }));
}

export async function webApiKeys(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  return actor ? jsonResponse(context, await db.listWebApiKeys(actor)) : errorResponse(context, "forbidden");
}

export async function webCreateApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.apiKeys.create">,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const idempotencyKey = guard.idempotencyKey;
  if (!db.createWebApiKey) {
    return errorResponse(context, "database_unavailable");
  }
  const createWebApiKey = db.createWebApiKey.bind(db);
  const body: CreateApiKeyRequest = guard.body;
  const identity = principal.kind === "workos_access_token" ? (principal.identity as WorkOsIdentity) : null;
  return runIdempotent(
    context,
    () =>
      createWebApiKey({
        actor,
        idempotencyKey,
        name: body.name,
        ...(identity?.auth_surface === "cli" ? { expiresInSeconds: CLI_API_KEY_TTL_SECONDS } : {}),
      }),
    201,
  );
}

export async function webRevokeApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.apiKeys.revoke">,
  params: RouteParams,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const idempotencyKey = guard.idempotencyKey;
  if (!db.revokeWebApiKey) {
    return errorResponse(context, "database_unavailable");
  }
  const revokeWebApiKey = db.revokeWebApiKey.bind(db);
  return runIdempotent(context, () =>
    revokeWebApiKey({
      actor,
      idempotencyKey,
      apiKeyId: params.apiKeyId ?? "",
    }),
  );
}

export async function webAudit(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  if (!db.listWebAuditEvents) {
    return errorResponse(context, "database_unavailable");
  }
  return executeRepositoryRoute(context, () => db.listWebAuditEvents(actor, pagination.value));
}

export async function webSettings(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  return actor ? jsonResponse(context, await db.getWebSettings(actor)) : errorResponse(context, "forbidden");
}

export async function webUpdateSettings(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.settings.update">,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const idempotencyKey = guard.idempotencyKey;
  if (!db.updateWebSettings) {
    return errorResponse(context, "database_unavailable");
  }
  const updateWebSettings = db.updateWebSettings.bind(db);
  const body: UpdateWebSettingsRequest = guard.body;
  return runIdempotent(context, () =>
    updateWebSettings({
      actor,
      idempotencyKey,
      workspaceName: body.workspace_name,
      autoDeletionDays: body.auto_deletion_days,
    }),
  );
}
