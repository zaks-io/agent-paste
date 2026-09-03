import { getRequestId, type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { buildApiOpenApiDocument } from "@agent-paste/contracts";
import { type Repository, repositoryErrorToAppError, type SqlExecutor } from "@agent-paste/db";
import {
  type BoundRespondersVariables,
  boundRespondersMiddleware,
  captureWorkerError,
  createRegistrar,
  getBoundResponders,
  securityHeadersMiddleware,
  sentryOptions,
} from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { createApiAuthResolvers } from "./auth.js";
import type { AppContext, Env } from "./env.js";
import { RepositoryRouteError } from "./responses.js";
import { contractById } from "./route-contracts.js";
import { getUsagePolicy, mcpWhoami, revokeCurrentApiKey, whoami } from "./routes/account.js";
import { agentAuthWwwAuthenticateMiddleware, mountAgentAuthRoutes } from "./routes/agent-auth.js";
import { readArtifactFileContent } from "./routes/artifact-file-content.js";
import {
  billingCheckout,
  billingInvoices,
  billingPortal,
  billingReturn,
  billingStatus,
  billingWebhook,
  resolveBillingExecutor,
} from "./routes/billing.js";
import { getCliVersion } from "./routes/cli-version.js";
import { ephemeralClaimRoute, ephemeralProvisionRoute } from "./routes/ephemeral.js";
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
  webAdminSetWorkspacePlan,
} from "./routes/operator.js";
import { authenticatedAgentView, listRevisions, publicAgentView, publishRevision } from "./routes/revisions.js";
import { deleteSmokeArtifact, forceExpire, getDenylistKey, listR2Prefix, provisionSmoke } from "./routes/smoke.js";
import {
  webApiKeys,
  webArtifactDetail,
  webArtifactRevisions,
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
export { EphemeralProvisionGate } from "./ephemeral-provision-gate.js";
export { createMemoryEphemeralProvisionGateNamespace } from "./ephemeral-provision-gate-memory.js";

const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = [
  "/healthz",
  "/openapi.json",
  "/auth.md",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/agent/identity",
  "/agent/identity/claim",
  "/oauth2/token",
  "/oauth2/revoke",
  "/agent/event/notify",
  "/v1/web/agent-auth/claim/complete",
  "/__test__/provision-smoke",
  "/__test__/force-expire",
  "/__test__/delete-artifact",
  "/__test__/r2-list",
  "/__test__/denylist",
] as const;

const boundResponderConfig = {
  docsBaseUrl: (context: { env: Env }) => context.env.DOCS_BASE_URL,
} as const;

app.use("*", securityHeadersMiddleware());
app.use("*", requestIdMiddleware());
app.use("*", boundRespondersMiddleware(boundResponderConfig));
app.use("*", agentAuthWwwAuthenticateMiddleware());
app.get("/healthz", (context) => context.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(
    buildApiOpenApiDocument({ serverUrl: context.env.API_BASE_URL, docsBaseUrl: context.env.DOCS_BASE_URL }),
  ),
);
mountAgentAuthRoutes(app, (env) => apiDatabase(env));

const apiDbRegistrar = createRegistrar<Repository>({
  app,
  auth: createApiAuthResolvers(),
  db: (context) => apiDatabase(context.env as Env),
  rateLimitBindings: (context) => apiRateLimitBindings(context.env as Env),
  docsBaseUrl: boundResponderConfig.docsBaseUrl,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});

// Routes that read no database and need no rate limiting (the public CLI-version
// advert, which only touches KV) mount here so the registrar never resolves
// Hyperdrive for them. Every route mounted here must be `rateLimit: "none"` —
// the registrar tripwire enforces that, since it has no rate-limit bindings.
const apiNoDbRegistrar = createRegistrar({
  app,
  auth: createApiAuthResolvers(),
  docsBaseUrl: boundResponderConfig.docsBaseUrl,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});

// Billing routes need a raw RLS-capable SQL executor (Stripe writes go through the
// command layer, not the Repository), plus actor rate limiting. The registrar
// resolves the executor once and hands it to each handler, which scopes it to the
// member / event / target Workspace. `database_unavailable` is the registrar's job;
// the `billingEnabled` (→ not_found) gate stays in the handlers as policy.
const apiBillingRegistrar = createRegistrar<SqlExecutor>({
  app,
  auth: createApiAuthResolvers(),
  db: (context) => resolveBillingExecutor(context.env as Env),
  rateLimitBindings: (context) => apiRateLimitBindings(context.env as Env),
  docsBaseUrl: boundResponderConfig.docsBaseUrl,
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
apiDbRegistrar.mount(contractById("usagePolicy.get"), async (context, principal, db) =>
  getUsagePolicy(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("apiKeys.revokeCurrent"), async (context, principal, db) =>
  revokeCurrentApiKey(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("agentView.public"), async (context, principal, db) =>
  publicAgentView(context as AppContext, principal, db),
);
apiNoDbRegistrar.mount(contractById("cli.version"), async (context) => getCliVersion(context as AppContext));
apiDbRegistrar.mount(contractById("ephemeral.provision"), async (context, _principal, db, guard) =>
  ephemeralProvisionRoute(context as AppContext, db, guard),
);
apiDbRegistrar.mount(contractById("ephemeral.claim"), async (context, principal, db, guard) =>
  ephemeralClaimRoute(context as AppContext, principal, db, guard),
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
apiDbRegistrar.mount(contractById("artifacts.fileContent"), async (context, principal, db) => {
  const revisionId = context.req.query("revision_id");
  return readArtifactFileContent(context as AppContext, principal, db, {
    artifactId: context.req.param("artifact_id") ?? "",
    path: context.req.query("path") ?? "",
    ...(revisionId ? { revisionId } : {}),
  });
});
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
apiDbRegistrar.mount(contractById("web.revisions.list"), async (context, principal, db) =>
  webArtifactRevisions(context as AppContext, principal, db, {
    artifactId: context.req.param("artifact_id") ?? "",
  }),
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
apiBillingRegistrar.mount(contractById("billing.status.get"), async (context, principal, db) =>
  billingStatus(context as AppContext, principal, db),
);
apiBillingRegistrar.mount(contractById("billing.invoices.list"), async (context, principal, db) =>
  billingInvoices(context as AppContext, principal, db),
);
apiBillingRegistrar.mount(contractById("billing.checkout.create"), async (context, principal, db, guard) =>
  billingCheckout(context as AppContext, principal, guard, db),
);
apiBillingRegistrar.mount(contractById("billing.checkout.return"), async (context, principal, db) =>
  billingReturn(context as AppContext, principal, db),
);
apiBillingRegistrar.mount(contractById("billing.portal.create"), async (context, principal, db) =>
  billingPortal(context as AppContext, principal, db),
);
apiBillingRegistrar.mount(contractById("billing.webhook"), async (context, principal, db) =>
  billingWebhook(context as AppContext, principal, db),
);
apiBillingRegistrar.mount(contractById("billing.admin.setPlan"), async (context, principal, db, guard) =>
  webAdminSetWorkspacePlan(
    context as AppContext,
    principal,
    guard,
    { workspaceId: context.req.param("workspace_id") ?? "" },
    db,
  ),
);

app.post("/__test__/provision-smoke", (context) => provisionSmoke(context as AppContext));
app.post("/__test__/force-expire", (context) => forceExpire(context as AppContext));
app.post("/__test__/delete-artifact", (context) => deleteSmokeArtifact(context as AppContext));
app.get("/__test__/r2-list", (context) => listR2Prefix(context as AppContext));
app.get("/__test__/denylist", (context) => getDenylistKey(context as AppContext));
app.notFound((context) => getBoundResponders(context).respondError("not_found"));
app.onError((error, context) => {
  const { respondError } = getBoundResponders(context);
  if (error instanceof RepositoryRouteError) {
    return respondError(error.code, error.message);
  }
  const repositoryCode = repositoryErrorToAppError(error);
  if (repositoryCode) {
    return respondError(repositoryCode);
  }
  captureWorkerError({
    component: "api",
    event: "api.unhandled_error",
    error,
    environment: context.env.AGENT_PASTE_ENV,
    request: context.req.raw,
    requestId: getRequestId(context),
  });
  return respondError("internal_error");
});

const worker = {
  fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, executionCtx);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

export async function handleRequest(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
  return await app.fetch(request, env, executionCtx);
}

export { WorkspaceWriteAllowance } from "@agent-paste/write-allowance";
