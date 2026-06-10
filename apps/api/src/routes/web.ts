import type { WebCallbackIdentity, WorkOsIdentity } from "@agent-paste/auth";
import type { CreateApiKeyRequest, UpdateWebSettingsRequest } from "@agent-paste/contracts";
import type { ApiActor, Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import {
  clearAccessLinkLockdownDenylist,
  invalidateAccessLinkLockdown,
  invalidateRevokedAccessLink,
} from "../access-link-invalidation.js";
import { signAgentViewContentUrls } from "../agent-view.js";
import type { AppContext, PaginationInput } from "../env.js";
import { parsePagination } from "../pagination.js";
import { webMemberActor } from "../principals.js";
import { executeRepositoryRoute, runIdempotent } from "../responses.js";
import type { GuardFor, RouteParams } from "../route-contracts.js";
import { webBaseUrl } from "../runtime.js";
import { accessLinkSigningSecret } from "./access-links.js";
import { CLI_API_KEY_TTL_SECONDS } from "./account.js";

export async function webAuthCallback(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "workos_access_token") {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const identity = principal.identity as WorkOsIdentity;
  if (!hasWebCallbackId(identity)) {
    return getBoundResponders(context).respondError("not_authenticated", "missing WorkOS token_id or session_id");
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

type WebResponders = ReturnType<typeof getBoundResponders>;

async function runWebMemberRoute(
  context: AppContext,
  principal: Principal,
  run: (actor: ApiActor, responders: WebResponders) => Promise<Response> | Response,
): Promise<Response> {
  const responders = getBoundResponders(context);
  const actor = webMemberActor(principal);
  if (!actor) {
    return responders.respondError("forbidden");
  }
  return run(actor, responders);
}

function respondWebMemberJson<T>(
  context: AppContext,
  principal: Principal,
  read: (actor: ApiActor) => Promise<T>,
): Promise<Response> {
  return runWebMemberRoute(context, principal, async (actor, { respondJson }) => respondJson(await read(actor)));
}

function executePaginatedWebMemberRoute<T>(
  context: AppContext,
  principal: Principal,
  run: (actor: ApiActor, pagination: PaginationInput, responders: WebResponders) => Promise<T> | Response,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, responders) => {
    const pagination = parsePagination(context.req.raw);
    if (!pagination.ok) {
      return responders.respondError(pagination.code);
    }
    const result = run(actor, pagination.value, responders);
    if (result instanceof Response) {
      return result;
    }
    return executeRepositoryRoute(context, () => result);
  });
}

export async function webWorkspace(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  return respondWebMemberJson(context, principal, (actor) => db.getWebWorkspace(actor));
}

export async function webArtifacts(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  return executePaginatedWebMemberRoute(context, principal, (actor, pagination) =>
    db.listWebArtifacts(actor, pagination),
  );
}

export async function webArtifactDetail(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, async (actor, { respondError, respondJson }) => {
    const detail = await db.getWebArtifact(actor, params.artifactId ?? "");
    if (!detail) {
      return respondError("not_found");
    }
    if (detail.viewer) {
      const signed = (await signAgentViewContentUrls(
        {
          artifact_id: detail.id,
          revision_id: detail.latest_revision_id,
          entrypoint: detail.entrypoint,
          // auto_delete_at is the artifact's expires_at, or null when pinned
          // (pinned Artifacts get the default token TTL instead).
          expires_at: detail.auto_delete_at,
          revision_content_url: detail.viewer.iframe_src,
        },
        context.env,
        { workspaceId: actor.workspace_id },
      )) as { revision_content_url?: unknown };
      const iframeSrc =
        typeof signed.revision_content_url === "string" ? signed.revision_content_url : detail.viewer.iframe_src;
      return respondJson({ ...detail, viewer: { ...detail.viewer, iframe_src: iframeSrc } });
    }
    return respondJson(detail);
  });
}

export async function webPinArtifact(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.artifacts.pin">,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, { respondError }) => {
    if (!db.pinWebArtifact) {
      return respondError("database_unavailable");
    }
    const pinWebArtifact = db.pinWebArtifact.bind(db);
    const idempotencyKey = guard.idempotencyKey;
    return runIdempotent(context, () => pinWebArtifact({ actor, idempotencyKey, artifactId: params.artifactId ?? "" }));
  });
}

export async function webUnpinArtifact(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.artifacts.unpin">,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, { respondError }) => {
    if (!db.unpinWebArtifact) {
      return respondError("database_unavailable");
    }
    const unpinWebArtifact = db.unpinWebArtifact.bind(db);
    const idempotencyKey = guard.idempotencyKey;
    return runIdempotent(context, () =>
      unpinWebArtifact({ actor, idempotencyKey, artifactId: params.artifactId ?? "" }),
    );
  });
}

export async function webApiKeys(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  return respondWebMemberJson(context, principal, (actor) => db.listWebApiKeys(actor));
}

export async function webCreateApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.apiKeys.create">,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, { respondError }) => {
    const idempotencyKey = guard.idempotencyKey;
    if (!db.createWebApiKey) {
      return respondError("database_unavailable");
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
      { successStatus: 201 },
    );
  });
}

export async function webRevokeApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.apiKeys.revoke">,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, { respondError }) => {
    const idempotencyKey = guard.idempotencyKey;
    if (!db.revokeWebApiKey) {
      return respondError("database_unavailable");
    }
    const revokeWebApiKey = db.revokeWebApiKey.bind(db);
    return runIdempotent(context, () =>
      revokeWebApiKey({
        actor,
        idempotencyKey,
        apiKeyId: params.apiKeyId ?? "",
      }),
    );
  });
}

export async function webAccessLinks(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  return respondWebMemberJson(context, principal, (actor) => db.listWorkspaceAccessLinks(actor));
}

export async function webArtifactAccessLinks(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, async (actor, { respondError, respondJson }) => {
    const result = await db.listWebArtifactAccessLinks(actor, params.artifactId ?? "");
    return result ? respondJson(result) : respondError("artifact_not_found");
  });
}

export async function webArtifactRevisions(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, async (actor, { respondError, respondJson }) => {
    const result = await db.listRevisions({ actor, artifactId: params.artifactId ?? "" });
    return result ? respondJson(result) : respondError("artifact_not_found");
  });
}

export async function webCreateAccessLink(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.accessLinks.create">,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor) => {
    const body = guard.body;
    const idempotencyKey = guard.idempotencyKey;
    return runIdempotent(
      context,
      () =>
        db.createMemberAccessLink({
          actor,
          idempotencyKey,
          artifactId: params.artifactId ?? "",
          type: body.type,
          revisionId: body.revision_id ?? null,
        }),
      { successStatus: 201 },
    );
  });
}

export async function webMintAccessLink(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, { respondError }) => {
    const signing = accessLinkSigningSecret(context.env);
    if (!signing) {
      return respondError("database_unavailable");
    }
    return runIdempotent(context, () =>
      db.mintMemberAccessLink({
        actor,
        accessLinkId: params.accessLinkId ?? "",
        appBaseUrl: webBaseUrl(context.env),
        signingSecret: signing.secret,
        signingKid: signing.kid,
      }),
    );
  });
}

export async function webRevokeAccessLink(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor) => {
    const accessLinkId = params.accessLinkId ?? "";
    return runIdempotent(context, async () => {
      const result = await db.revokeMemberAccessLink({
        actor,
        accessLinkId,
      });
      await invalidateRevokedAccessLink(context.env, result.access_link_id);
      return result;
    });
  });
}

export async function webSetAccessLinkLockdown(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.accessLinks.lockdown.set">,
  params: RouteParams,
  locked: boolean,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor) => {
    const idempotencyKey = guard.idempotencyKey;
    const artifactId = params.artifactId ?? "";
    return runIdempotent(context, async () => {
      const result = await db.setMemberAccessLinkLockdown({
        actor,
        idempotencyKey,
        artifactId,
        locked,
      });
      if (locked) {
        await invalidateAccessLinkLockdown(context.env, artifactId);
      } else {
        await clearAccessLinkLockdownDenylist(context.env, db, artifactId);
      }
      return result;
    });
  });
}

export async function webAudit(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  return executePaginatedWebMemberRoute(context, principal, (actor, pagination, { respondError }) => {
    if (!db.listWebAuditEvents) {
      return respondError("database_unavailable");
    }
    return db.listWebAuditEvents(actor, pagination);
  });
}

export async function webSettings(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  return respondWebMemberJson(context, principal, (actor) => db.getWebSettings(actor));
}

export async function webUpdateSettings(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.settings.update">,
): Promise<Response> {
  return runWebMemberRoute(context, principal, (actor, { respondError }) => {
    const idempotencyKey = guard.idempotencyKey;
    if (!db.updateWebSettings) {
      return respondError("database_unavailable");
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
  });
}
