import { type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { buildApiOpenApiDocument } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import { createRegistrar, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { signAgentViewContentUrls } from "./agent-view.js";
import { authenticateWebIdentity, createApiAuthResolvers } from "./auth.js";
import type { AppContext, Env } from "./env.js";
import { handleLiveUpdateAuthorize, wireLiveUpdateDeps } from "./live-updates.js";
import { errorResponse, RepositoryRouteError } from "./responses.js";
import { contractById } from "./route-contracts.js";
import {
  createAccessLinkRoute,
  listAccessLinksRoute,
  mintAccessLinkRoute,
  resolveAccessLinkRoute,
  revokeAccessLinkRoute,
} from "./routes/access-links.js";
import { getUsagePolicy, mcpWhoami, revokeCurrentApiKey, whoami } from "./routes/account.js";
import {
  deleteMemberArtifactRoute,
  listMemberArtifactsRoute,
  updateDisplayMetadataRoute,
} from "./routes/member-artifacts.js";
import {
  webAdminLiftLockdown,
  webAdminListEvents,
  webAdminListLockdowns,
  webAdminSetLockdown,
} from "./routes/operator.js";
import { authenticatedAgentView, listRevisions, publicAgentView, publishRevision } from "./routes/revisions.js";
import { deleteSmokeArtifact, forceExpire, getDenylistKey, listR2Prefix, provisionSmoke } from "./routes/smoke.js";
import {
  webApiKeys,
  webArtifactDetail,
  webArtifacts,
  webAudit,
  webAuthCallback,
  webCreateApiKey,
  webPinArtifact,
  webRevokeApiKey,
  webSettings,
  webUnpinArtifact,
  webUpdateSettings,
  webWorkspace,
} from "./routes/web.js";
import { apiDatabase, apiRateLimitBindings } from "./runtime.js";

export { authenticateWebIdentity } from "./auth.js";
export type { ApiDatabase, AuthService, Env, KVNamespace, R2Bucket, RateLimitBinding } from "./env.js";

const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = [
  "/healthz",
  "/openapi.json",
  "/__test__/provision-smoke",
  "/__test__/force-expire",
  "/__test__/delete-artifact",
  "/__test__/r2-list",
  "/__test__/denylist",
  "/v1/internal/live-updates/authorize",
] as const;

app.use("*", requestIdMiddleware());
app.get("/healthz", (context) => context.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(
    buildApiOpenApiDocument({ serverUrl: context.env.API_BASE_URL, docsBaseUrl: context.env.DOCS_BASE_URL }),
  ),
);

const apiDbRegistrar = createRegistrar<Repository>({
  app,
  auth: createApiAuthResolvers(),
  db: (context) => apiDatabase(context.env as Env),
  rateLimitBindings: (context) => apiRateLimitBindings(context.env as Env),
  docsBaseUrl: (context) => (context.env as Env).DOCS_BASE_URL,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});

apiDbRegistrar.mount(contractById("whoami.get"), async (context, principal, db) =>
  whoami(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("mcp.whoami"), async (context, principal, db) =>
  mcpWhoami(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("artifacts.list"), async (context, principal, db) =>
  listMemberArtifactsRoute(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("artifacts.delete"), async (context, principal, db, guard) =>
  deleteMemberArtifactRoute(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("artifacts.updateDisplayMetadata"), async (context, principal, db, guard) =>
  updateDisplayMetadataRoute(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("accessLinks.create"), async (context, principal, db, guard) =>
  createAccessLinkRoute(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("accessLinks.mint"), async (context, principal, db) =>
  mintAccessLinkRoute(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("accessLinks.list"), async (context, principal, db) =>
  listAccessLinksRoute(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("accessLinks.revoke"), async (context, principal, db) =>
  revokeAccessLinkRoute(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("usagePolicy.get"), async (context, principal, db) =>
  getUsagePolicy(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("apiKeys.revokeCurrent"), async (context, principal, db) =>
  revokeCurrentApiKey(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("agentView.public"), async (context, principal, db) =>
  publicAgentView(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("accessLinks.resolve"), async (context, _principal, db, guard) =>
  resolveAccessLinkRoute(context as AppContext, db, guard),
);
apiDbRegistrar.mount(contractById("agentView.getLatest"), async (context, principal, db) =>
  authenticatedAgentView(context as AppContext, principal, db, {
    artifactId: context.req.param("artifact_id") ?? "",
  }),
);
apiDbRegistrar.mount(contractById("agentView.getRevision"), async (context, principal, db) =>
  authenticatedAgentView(context as AppContext, principal, db, {
    artifactId: context.req.param("artifact_id") ?? "",
    revisionId: context.req.param("revision_id") ?? "",
  }),
);
apiDbRegistrar.mount(contractById("revisions.list"), async (context, principal, db) =>
  listRevisions(context as AppContext, principal, db, { artifactId: context.req.param("artifact_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("revisions.publish"), async (context, principal, db, guard) =>
  publishRevision(context as AppContext, principal, db, guard, {
    artifactId: context.req.param("artifact_id") ?? "",
    revisionId: context.req.param("revision_id") ?? "",
  }),
);
apiDbRegistrar.mount(contractById("web.auth.callback"), async (context, principal, db) =>
  webAuthCallback(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.workspace.get"), async (context, principal, db) =>
  webWorkspace(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.artifacts.list"), async (context, principal, db) =>
  webArtifacts(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.artifacts.get"), async (context, principal, db) =>
  webArtifactDetail(context as AppContext, principal, db, { artifactId: context.req.param("artifact_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("web.artifacts.pin"), async (context, principal, db, guard) =>
  webPinArtifact(context as AppContext, principal, db, guard, {
    artifactId: context.req.param("artifact_id") ?? "",
  }),
);
apiDbRegistrar.mount(contractById("web.artifacts.unpin"), async (context, principal, db, guard) =>
  webUnpinArtifact(context as AppContext, principal, db, guard, {
    artifactId: context.req.param("artifact_id") ?? "",
  }),
);
apiDbRegistrar.mount(contractById("web.apiKeys.list"), async (context, principal, db) =>
  webApiKeys(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.apiKeys.create"), async (context, principal, db, guard) =>
  webCreateApiKey(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("web.apiKeys.revoke"), async (context, principal, db, guard) =>
  webRevokeApiKey(context as AppContext, principal, db, guard, { apiKeyId: context.req.param("api_key_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("web.audit.list"), async (context, principal, db) =>
  webAudit(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.settings.get"), async (context, principal, db) =>
  webSettings(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.settings.update"), async (context, principal, db, guard) =>
  webUpdateSettings(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("web.admin.lockdown.list"), async (context, principal, db) =>
  webAdminListLockdowns(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("web.admin.lockdown.set"), async (context, principal, db, guard) =>
  webAdminSetLockdown(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("web.admin.lockdown.lift"), async (context, principal, db, guard) =>
  webAdminLiftLockdown(context as AppContext, principal, db, guard, {
    scope: context.req.param("scope") ?? "",
    targetId: context.req.param("target_id") ?? "",
  }),
);
apiDbRegistrar.mount(contractById("web.admin.events.list"), async (context, principal, db) =>
  webAdminListEvents(context as AppContext, principal, db),
);

app.post("/__test__/provision-smoke", (context) => provisionSmoke(context as AppContext));
app.post("/__test__/force-expire", (context) => forceExpire(context as AppContext));
app.post("/__test__/delete-artifact", (context) => deleteSmokeArtifact(context as AppContext));
app.get("/__test__/r2-list", (context) => listR2Prefix(context as AppContext));
app.get("/__test__/denylist", (context) => getDenylistKey(context as AppContext));
app.post("/v1/internal/live-updates/authorize", async (context) => {
  const db = apiDatabase(context.env);
  if (!db) {
    return errorResponse(context as AppContext, "database_unavailable");
  }
  return handleLiveUpdateAuthorize(context.req.raw, context.env, db);
});
app.notFound((context) => errorResponse(context as AppContext, "not_found"));
app.onError((error, context) => {
  if (error instanceof RepositoryRouteError) {
    return errorResponse(context as AppContext, error.code, error.message);
  }
  console.error("Unhandled API error:", error);
  return errorResponse(context as AppContext, "internal_error");
});

wireLiveUpdateDeps({
  signAgentView: signAgentViewContentUrls,
  authenticateWeb: async (authorization, env) => {
    const request = new Request("https://api.internal/authorize", {
      headers: { authorization },
    });
    const identity = await authenticateWebIdentity(request, env);
    if (!identity) {
      return null;
    }
    const db = apiDatabase(env);
    if (!db) {
      return null;
    }
    const actor = await db.getWebMemberByWorkOsUserId({ workosUserId: identity.workos_user_id });
    if (!actor || actor.type !== "member") {
      return null;
    }
    return { member: actor };
  },
});

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}
