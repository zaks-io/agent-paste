import {
  cachedLookup,
  cacheKeyForSecret,
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestIdVariables,
  requestIdMiddleware,
  verifyAdminToken,
} from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import { USAGE_POLICY as usagePolicy } from "@agent-paste/config";
import {
  buildApiOpenApiDocument,
  type CleanupRunRequest,
  type CreateApiKeyRequest,
  type CreateWorkspaceRequest,
  LockdownScope,
  type RouteContract,
  routeContracts,
  type SetLockdownRequest,
  type UpdateWebSettingsRequest,
} from "@agent-paste/contracts";
import {
  type AdminActor,
  type ApiActor,
  type ApiKeyActor,
  createHyperdriveExecutor,
  createPostgresServices,
  type HyperdriveBinding,
  type PlatformActor,
  type Repository,
} from "@agent-paste/db";
import { type AgentViewTokenPayload, mintAgentViewUrl, verifyAgentViewToken } from "@agent-paste/tokens/agent-view";
import { mintContentUrl } from "@agent-paste/tokens/content";
import { constantTimeEqual } from "@agent-paste/tokens/crypto";
import {
  applyRateLimit,
  type AppErrorCode,
  type AuthResolvers,
  createRegistrar,
  type GuardState,
  type Principal,
  errorResponse as runtimeErrorResponse,
  jsonResponse as runtimeJsonResponse,
} from "@agent-paste/worker-runtime";
import { type Context, Hono } from "hono";
import { isOperator, verifyCfAccessServiceToken } from "./operator.js";
import {
  DEFAULT_WORKOS_ISSUER,
  resolveWorkOsIdentity,
  type WebCallbackIdentity,
  type WorkOsIdentity,
  type WorkOsRejectReason,
  type WorkOsVerificationOptions,
} from "./workos.js";

export type AuthService = {
  verifyApiKey(apiKey: string): Promise<ApiKeyActor | null>;
  verifyAdminToken?(token: string): Promise<AdminActor | null>;
  verifyWebToken?(token: string): Promise<WebCallbackIdentity | null>;
};

type PaginationInput = {
  cursor?: string;
  limit: number;
};

export type R2ListedObject = { key: string };
export type R2Objects = { objects: R2ListedObject[]; truncated: boolean; cursor?: string };
export type R2Bucket = {
  list(options: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
  delete(keys: string | string[]): Promise<void>;
};

export type KVNamespace = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get?(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  AUTH?: AuthService;
  DB?: Repository | HyperdriveBinding;
  ARTIFACTS?: R2Bucket;
  ADMIN_TOKEN?: string;
  ADMIN_TOKEN_HASH?: string;
  API_KEY_PEPPER_V1?: string;
  API_KEY_ENV?: "preview" | "production";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  AGENT_VIEW_SIGNING_SECRET?: string;
  CLEANUP_BATCH_SIZE?: string;
  DENYLIST?: KVNamespace;
  ACTOR_RATE_LIMIT?: RateLimitBinding;
  WORKSPACE_BURST_CAP?: RateLimitBinding;
  ARTIFACT_RATE_LIMIT?: RateLimitBinding;
  AGENT_PASTE_ENV?: string;
  DOCS_BASE_URL?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_BASE_URL?: string;
  WORKOS_ISSUER?: string;
  WORKOS_JWKS_URL?: string;
  // Expected `aud` of a CLI Connect access token: the WorkOS environment's OIDC
  // client, NOT the `agent-paste login` OAuth app id. WorkOS stamps every token
  // in the environment with this audience and exposes no verifiable claim for
  // the originating OAuth app, so this is what pins a CLI token to our tenant.
  // Empty means the CLI login path is disabled (worker behaves dashboard-only).
  // Public identifier; safe in vars (ADR 0060).
  WORKOS_CLI_AUDIENCE?: string;
  // Connect tokens are verified against the AuthKit domain JWKS, not
  // /sso/jwks/{client_id}, and against the AuthKit issuer; both are configurable
  // for non-default subdomains (see ADR 0060).
  WORKOS_CLI_JWKS_URL?: string;
  WORKOS_CLI_ISSUER?: string;
  OPERATOR_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
};

type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables }>;

type ScheduledEvent = {
  type: "scheduled";
  scheduledTime: number;
  cron: string;
};

type RouteParams = Record<string, string>;
type RouteId = (typeof routeContracts)[number]["id"];
type ContractById<Id extends RouteId> = Extract<(typeof routeContracts)[number], { id: Id }>;
type GuardFor<Id extends RouteId> = GuardState<ContractById<Id>>;

const DENYLIST_EXPIRATION_TTL_SECONDS = usagePolicy.max_ttl_seconds;
const AUTH_CACHE_TTL_SECONDS = 60;
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = [
  "/healthz",
  "/openapi.json",
  "/admin/whoami",
  "/__test__/force-expire",
  "/__test__/r2-list",
  "/__test__/denylist",
] as const;

app.use("*", requestIdMiddleware());
app.get("/healthz", (c) => c.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(
    buildApiOpenApiDocument({ serverUrl: context.env.API_BASE_URL, docsBaseUrl: context.env.DOCS_BASE_URL }),
  ),
);
const apiAuthResolvers = {
  async api_key(context: Context) {
    const actor = await authenticateApiKey(context.req.raw, context.env as Env);
    return actor
      ? ({ ok: true, principal: { kind: "api_key", actor } } as const)
      : ({ ok: false, code: "not_authenticated" } as const);
  },
  async admin_token(context: Context) {
    const actor = await authenticateAdmin(context.req.raw, context.env as Env);
    return actor
      ? ({ ok: true, principal: { kind: "admin_token", actor } } as const)
      : ({ ok: false, code: "not_authenticated" } as const);
  },
  async signed_agent_view_token(context: Context) {
    const token = context.req.param("token");
    if (!token) {
      return { ok: false, code: "not_found" } as const;
    }
    const secret = agentViewSigningSecret(context.env as Env);
    const payload = secret ? await verifyAgentViewToken(token, secret) : null;
    return payload
      ? ({ ok: true, principal: { kind: "signed_agent_view_token", payload } } as const)
      : ({ ok: false, code: "not_found" } as const);
  },
  async workos_access_token(context: Context, contract: RouteContract) {
    const identity = await authenticateWebIdentity(context.req.raw, context.env as Env, {
      allowCliClient: contract.id === CLI_KEY_MINT_ROUTE_ID,
    });
    if (!identity) {
      return { ok: false, code: "not_authenticated" } as const;
    }
    if (contract.allowUnprovisioned) {
      return { ok: true, principal: { kind: "workos_access_token", identity } } as const;
    }
    const db = apiDatabase(context.env as Env);
    if (!db) {
      return { ok: false, code: "database_unavailable" } as const;
    }
    // The key-mint route is the CLI's only entry point, so it provisions a
    // workspace on first contact (JIT) the way the dashboard callback does. Every
    // other workos_access_token route requires an already-provisioned member.
    const actor =
      contract.id === CLI_KEY_MINT_ROUTE_ID
        ? await db.ensureWebMember({ workosUserId: identity.workos_user_id, email: identity.email })
        : await db.getWebMemberByWorkOsUserId({ workosUserId: identity.workos_user_id });
    if (!actor || actor.type !== "member" || !actor.workspace_id) {
      return { ok: false, code: "forbidden" } as const;
    }
    return { ok: true, principal: { kind: "workos_access_token", identity, actor } } as const;
  },
  async operator(context: Context) {
    const id = await authenticateOperator(context.req.raw, context.env as Env);
    return id
      ? ({ ok: true, principal: { kind: "operator", actor: { type: "platform", id } } } as const)
      : ({ ok: false, code: "not_found" } as const);
  },
} satisfies AuthResolvers;
const apiDbRegistrar = createRegistrar<Repository>({
  app,
  auth: apiAuthResolvers,
  db: (context) => apiDatabase(context.env as Env),
  rateLimitBindings: (context) => apiRateLimitBindings(context.env as Env),
  docsBaseUrl: (context) => (context.env as Env).DOCS_BASE_URL,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
const apiNoDbRegistrar = createRegistrar({
  app,
  auth: apiAuthResolvers,
  rateLimitBindings: (context) => apiRateLimitBindings(context.env as Env),
  docsBaseUrl: (context) => (context.env as Env).DOCS_BASE_URL,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
apiDbRegistrar.mount(contractById("whoami.get"), async (context, principal, db) =>
  whoami(context as AppContext, principal, db),
);
apiNoDbRegistrar.mount(contractById("usagePolicy.get"), async (context) => getUsagePolicy(context as AppContext));
apiDbRegistrar.mount(contractById("agentView.public"), async (context, principal, db) =>
  publicAgentView(context as AppContext, principal, db),
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
app.get("/admin/whoami", (context) => adminWhoami(context));
apiDbRegistrar.mount(contractById("admin.workspaces.create"), async (context, principal, db, guard) =>
  createWorkspace(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("admin.workspaces.list"), async (context, principal, db) =>
  listWorkspaces(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("admin.apiKeys.create"), async (context, principal, db, guard) =>
  createApiKey(context as AppContext, principal, db, guard, { workspaceId: context.req.param("workspace_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("admin.apiKeys.revoke"), async (context, principal, db, guard) =>
  revokeApiKey(context as AppContext, principal, db, guard, { apiKeyId: context.req.param("api_key_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("admin.artifacts.list"), async (context, principal, db) =>
  listArtifacts(context as AppContext, principal, db),
);
apiDbRegistrar.mount(contractById("admin.artifacts.get"), async (context, principal, db) =>
  inspectArtifact(context as AppContext, principal, db, { artifactId: context.req.param("artifact_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("admin.artifacts.delete"), async (context, principal, db, guard) =>
  deleteArtifact(context as AppContext, principal, db, guard, { artifactId: context.req.param("artifact_id") ?? "" }),
);
apiDbRegistrar.mount(contractById("admin.cleanup.run"), async (context, principal, db, guard) =>
  cleanup(context as AppContext, principal, db, guard),
);
apiDbRegistrar.mount(contractById("admin.operationEvents.list"), async (context, principal, db) =>
  listOperationEvents(context as AppContext, principal, db),
);
app.post("/__test__/force-expire", (context) => forceExpire(context));
app.get("/__test__/r2-list", (context) => listR2Prefix(context));
app.get("/__test__/denylist", (context) => getDenylistKey(context));
app.notFound((context) => errorResponse(context, "not_found"));
app.onError((error, context) => {
  console.error("Unhandled API error:", error);
  return errorResponse(context, "internal_error");
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    return runScheduledCleanup(env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}

async function whoami(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as ApiKeyActor;

  return jsonResponse(context, await db.getWhoami(actor));
}

async function getUsagePolicy(context: AppContext): Promise<Response> {
  return jsonResponse(context, usagePolicy);
}

async function authenticatedAgentView(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as ApiActor;

  const input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string } = {
    actor,
    artifactId: params.artifactId ?? "",
    contentBaseUrl: contentBaseUrl(env),
  };
  if (params.revisionId) {
    input.revisionId = params.revisionId;
  }

  const view = await db.getAgentView(input);

  if (!view) {
    if (params.revisionId) {
      const revisions = await db.listRevisions({ actor, artifactId: params.artifactId ?? "" });
      const revision = revisions?.items.find((row) => row.revision_id === params.revisionId);
      if (revision?.status === "retained") {
        return errorResponse(context, "revision_retained");
      }
    }
    return errorResponse(context, "not_found");
  }

  return jsonResponse(context, await signAgentViewContentUrls(view, env));
}

async function listRevisions(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as ApiActor;
  const result = await db.listRevisions({ actor, artifactId: params.artifactId ?? "" });
  return result ? jsonResponse(context, result) : errorResponse(context, "artifact_not_found");
}

async function publishRevision(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
  params: RouteParams,
): Promise<Response> {
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as ApiActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  return runIdempotent(context, async () => {
    try {
      const result = await db.publishRevision({
        actor,
        idempotencyKey,
        artifactId: params.artifactId ?? "",
        revisionId: params.revisionId ?? "",
        now: new Date().toISOString(),
      });
      return signPublishResult(result, context.env);
    } catch (error) {
      const mapped = mapRepositoryError(error);
      if (mapped) {
        throw new RepositoryRouteError(mapped.code, mapped.message);
      }
      throw error;
    }
  });
}

class RepositoryRouteError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "RepositoryRouteError";
  }
}

async function publicAgentView(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "signed_agent_view_token") {
    return errorResponse(context, "not_found");
  }
  const payload = principal.payload as AgentViewTokenPayload;
  const publicToken = `${payload.artifact_id}.${payload.revision_id}`;

  const view = await db.getPublicAgentView({
    token: publicToken,
    contentBaseUrl: contentBaseUrl(env),
  });

  if (!view) {
    return errorResponse(context, "not_found");
  }

  const signedView = await signAgentViewContentUrls(view, env);
  return wantsHtml(context.req.raw) ? htmlAgentViewResponse(context, signedView) : jsonResponse(context, signedView);
}

async function webAuthCallback(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
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

async function webWorkspace(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  return actor ? jsonResponse(context, await db.getWebWorkspace(actor)) : errorResponse(context, "forbidden");
}

async function webArtifacts(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  try {
    return jsonResponse(context, await db.listWebArtifacts(actor, pagination.value));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") {
      return errorResponse(context, "invalid_cursor");
    }
    throw error;
  }
}

async function webArtifactDetail(
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
  return detail ? jsonResponse(context, detail) : errorResponse(context, "not_found");
}

function parsePagination(
  request: Request,
): { ok: true; value: PaginationInput } | { ok: false; code: "invalid_cursor" | "invalid_request" } {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? 50 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: "invalid_request" };
  }
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 500)) {
    return { ok: false, code: "invalid_cursor" };
  }
  return { ok: true, value: cursor === undefined ? { limit } : { limit, cursor } };
}

async function webApiKeys(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  return actor ? jsonResponse(context, await db.listWebApiKeys(actor)) : errorResponse(context, "forbidden");
}

async function webCreateApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.apiKeys.create">,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const idempotencyKey = guard.idempotencyKey as string;
  if (!db.createWebApiKey) {
    return errorResponse(context, "database_unavailable");
  }
  const createWebApiKey = db.createWebApiKey.bind(db);
  const body: CreateApiKeyRequest = guard.body;
  return runIdempotent(context, () => createWebApiKey({ actor, idempotencyKey, name: body.name }), 201);
}

async function webRevokeApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
  params: RouteParams,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const idempotencyKey = guard.idempotencyKey ?? "";
  if (!db.revokeWebApiKey) {
    return errorResponse(context, "database_unavailable");
  }
  const revokeWebApiKey = db.revokeWebApiKey.bind(db);
  try {
    return await runIdempotent(context, () =>
      revokeWebApiKey({
        actor,
        idempotencyKey,
        apiKeyId: params.apiKeyId ?? "",
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "api_key_not_found") {
      return errorResponse(context, "not_found");
    }
    throw error;
  }
}

async function webAudit(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
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
  try {
    return jsonResponse(context, await db.listWebAuditEvents(actor, pagination.value));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") {
      return errorResponse(context, "invalid_cursor");
    }
    throw error;
  }
}

async function webSettings(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = webMemberActor(principal);
  return actor ? jsonResponse(context, await db.getWebSettings(actor)) : errorResponse(context, "forbidden");
}

async function webUpdateSettings(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.settings.update">,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return errorResponse(context, "forbidden");
  }
  const idempotencyKey = guard.idempotencyKey as string;
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

async function webAdminListLockdowns(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.listLockdowns) {
    return errorResponse(context, "database_unavailable");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  const listLockdowns = db.listLockdowns.bind(db);
  try {
    return jsonResponse(context, await listLockdowns(actor, pagination.value));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") {
      return errorResponse(context, "invalid_cursor");
    }
    throw error;
  }
}

async function webAdminSetLockdown(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.admin.lockdown.set">,
): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.setLockdown) {
    return errorResponse(context, "database_unavailable");
  }
  const setLockdown = db.setLockdown.bind(db);
  const body: SetLockdownRequest = guard.body;
  const env = context.env;
  return runIdempotent(
    context,
    async () => {
      const detail = await setLockdown({
        actor,
        idempotencyKey: guard.idempotencyKey as string,
        scope: body.scope,
        targetId: body.target_id,
        reasonCode: body.reason_code,
      });
      await writeDenylistEntry(env, body.scope, body.target_id);
      return detail;
    },
    201,
  );
}

async function webAdminLiftLockdown(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
  params: { scope: string; targetId: string },
): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.liftLockdown) {
    return errorResponse(context, "database_unavailable");
  }
  const liftLockdown = db.liftLockdown.bind(db);
  const scopeResult = LockdownScope.safeParse(params.scope);
  if (!scopeResult.success) {
    return errorResponse(context, "not_found");
  }
  const scope = scopeResult.data;
  const env = context.env;
  try {
    return await runIdempotent(context, async () => {
      const detail = await liftLockdown({
        actor,
        idempotencyKey: guard.idempotencyKey as string,
        scope,
        targetId: params.targetId,
      });
      await deleteDenylistEntry(env, scope, params.targetId);
      return detail;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") {
      return errorResponse(context, "not_found");
    }
    throw error;
  }
}

function denylistKey(scope: LockdownScope, targetId: string): string {
  return scope === "workspace" ? `wsd:${targetId}` : `ad:${targetId}`;
}

// Denylist writes run after the Postgres commit (ADR 0057). They are
// best-effort: the lockdown is already durable, so a KV failure is logged
// rather than surfaced, matching the cleanup path's fail-open behavior.
async function writeDenylistEntry(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!env.DENYLIST) {
    return;
  }
  try {
    await env.DENYLIST.put(
      denylistKey(scope, targetId),
      JSON.stringify({ reason: `platform_lockdown_${scope}`, at: new Date().toISOString() }),
      { expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS },
    );
  } catch (error) {
    console.warn(`Denylist write failed for ${scope} lockdown ${targetId}; lockdown persisted.`, error);
  }
}

async function deleteDenylistEntry(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!env.DENYLIST) {
    return;
  }
  try {
    await env.DENYLIST.delete(denylistKey(scope, targetId));
  } catch (error) {
    console.warn(`Denylist delete failed for ${scope} lockdown ${targetId}; lockdown lifted.`, error);
  }
}

async function adminWhoami(context: AppContext): Promise<Response> {
  const actor = await authenticateAdmin(context.req.raw, context.env);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const rateLimit = await applyRateLimit(
    { rateLimit: "actor" } as RouteContract,
    { kind: "admin_token", actor },
    apiRateLimitBindings(context.env),
  );
  if (!rateLimit.ok) {
    return errorResponse(context, rateLimit.code, undefined, { "Retry-After": rateLimit.retryAfter });
  }
  return jsonResponse(context, { actor });
}

function apiRateLimitBindings(env: Env) {
  return {
    actor: env.ACTOR_RATE_LIMIT,
    workspace: env.WORKSPACE_BURST_CAP,
    artifact: env.ARTIFACT_RATE_LIMIT,
  };
}

async function cleanup(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"admin.cleanup.run">,
): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as AdminActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  const body: CleanupRunRequest = guard.body;
  const dryRun = body.dry_run;
  const batchSize = numberFromEnv(env.CLEANUP_BATCH_SIZE, 100);

  return runIdempotent(context, () => runCleanupAndDeny(env, db, actor, dryRun, batchSize, idempotencyKey));
}

async function createWorkspace(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"admin.workspaces.create">,
): Promise<Response> {
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as AdminActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  const body: CreateWorkspaceRequest = guard.body;
  const input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
  } = { actor, idempotencyKey, email: body.email };
  if (body.name) {
    input.name = body.name;
  }
  return runIdempotent(context, () => db.createWorkspace(input), 201);
}

async function listWorkspaces(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  return jsonResponse(context, await db.listWorkspaces());
}

async function createApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"admin.apiKeys.create">,
  params: RouteParams,
): Promise<Response> {
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as AdminActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  const body: CreateApiKeyRequest = guard.body;
  return runIdempotent(
    context,
    () =>
      db.createApiKey({
        actor,
        idempotencyKey,
        workspaceId: params.workspaceId ?? "",
        name: body.name,
      }),
    201,
  );
}

async function revokeApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
  params: RouteParams,
): Promise<Response> {
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as AdminActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  return runIdempotent(context, () =>
    db.revokeApiKey({
      actor: actor,
      idempotencyKey,
      apiKeyId: params.apiKeyId ?? "",
    }),
  );
}

async function listArtifacts(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const request = context.req.raw;
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const url = new URL(request.url);
  return jsonResponse(
    context,
    await db.listArtifacts(url.searchParams.get("workspace") ?? undefined, url.searchParams.get("status") ?? undefined),
  );
}

async function inspectArtifact(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const detail = await db.getArtifactDetail(params.artifactId ?? "");
  return detail ? jsonResponse(context, detail) : errorResponse(context, "not_found");
}

async function deleteArtifact(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
  params: RouteParams,
): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as AdminActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  const artifactId = params.artifactId ?? "";
  return runIdempotent(context, async () => {
    const result = await db.deleteArtifact({
      actor: actor,
      idempotencyKey,
      artifactId,
    });
    await denyArtifact(env, artifactId);
    const purged = await purgeArtifactBytes(env, artifactId);
    return { ...result, deleted_r2_objects: purged };
  });
}

async function listOperationEvents(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "admin_token") {
    return errorResponse(context, "not_authenticated");
  }
  return jsonResponse(context, await db.listOperationEvents());
}

async function runScheduledCleanup(env: Env): Promise<void> {
  const db = apiDatabase(env);
  if (!db) {
    return;
  }

  await runCleanupAndDeny(
    env,
    db,
    { type: "system", id: "scheduled-cleanup" },
    false,
    numberFromEnv(env.CLEANUP_BATCH_SIZE, 100),
  );
}

async function authenticateApiKey(request: Request, env: Env): Promise<ApiKeyActor | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  if (env.AUTH) {
    return env.AUTH.verifyApiKey(token);
  }

  const runtime = postgresRuntime(env);
  if (!runtime) {
    return null;
  }

  return cachedLookup({
    namespace: "api-key-auth",
    key: await cacheKeyForSecret(token),
    ttlSeconds: AUTH_CACHE_TTL_SECONDS,
    lookup: () => runtime.auth.verifyApiKey(token),
  });
}

async function authenticateAdmin(request: Request, env: Env): Promise<AdminActor | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const auth = authService(env);
  if (auth?.verifyAdminToken) {
    return auth.verifyAdminToken(token);
  }

  if (env.ADMIN_TOKEN_HASH && env.API_KEY_PEPPER_V1) {
    return (await verifyAdminToken(token, env.ADMIN_TOKEN_HASH, env.API_KEY_PEPPER_V1))
      ? { type: "admin", id: "operator" }
      : null;
  }

  return env.ADMIN_TOKEN && constantTimeEqual(token, env.ADMIN_TOKEN) ? { type: "admin", id: "operator" } : null;
}

// Only the key-mint route accepts a CLI-issued Connect token. Every other
// workos_access_token route stays dashboard-only, confining the secret-less CLI
// to the one path that produces a scoped API key (ADR 0060, Option B).
const CLI_KEY_MINT_ROUTE_ID: (typeof routeContracts)[number]["id"] = "web.apiKeys.create";

type WebIdentityOptions = {
  allowCliClient?: boolean;
};

export async function authenticateWebIdentity(
  request: Request,
  env: Env,
  identityOptions: WebIdentityOptions = {},
): Promise<WorkOsIdentity | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  if (env.AUTH?.verifyWebToken) {
    return env.AUTH.verifyWebToken(token);
  }

  if (!env.WORKOS_API_KEY) {
    return null;
  }

  // Buffer per-attempt rejections and only log them if every attempt fails.
  // A valid CLI token always fails the dashboard attempt first; emitting that
  // reject eagerly would spam a misleading "dashboard" failure on success.
  const rejections: WorkOsRejection[] = [];

  const dashboard = dashboardVerifyOptions(env);
  if (dashboard) {
    const identity = await resolveWorkOsIdentity(
      `Bearer ${token}`,
      collectRejections(dashboard, "dashboard", rejections),
    );
    if (identity) {
      return identity;
    }
  }

  if (identityOptions.allowCliClient) {
    const cli = cliVerifyOptions(env);
    if (cli) {
      const identity = await resolveWorkOsIdentity(`Bearer ${token}`, collectRejections(cli, "cli", rejections));
      if (identity) {
        return identity;
      }
    }
  }

  logWorkOsRejections(rejections);
  return null;
}

function dashboardVerifyOptions(env: Env): WorkOsVerificationOptions | null {
  if (!env.WORKOS_API_KEY || !env.WORKOS_CLIENT_ID) {
    return null;
  }
  // AuthKit User Management session tokens (what the web app forwards) carry no
  // `client_id`/`azp`/`aud` claim, so we cannot require one. The env-scoped JWKS
  // plus issuer pin the token to our tenant. `iss` is either api.workos.com or
  // our AuthKit domain (WORKOS_ISSUER) depending on tenant config, so accept both.
  const options: WorkOsVerificationOptions = {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    requireClientIdClaim: false,
    issuers: env.WORKOS_ISSUER ? [DEFAULT_WORKOS_ISSUER, env.WORKOS_ISSUER] : [DEFAULT_WORKOS_ISSUER],
  };
  if (env.WORKOS_API_BASE_URL) {
    options.apiBaseUrl = env.WORKOS_API_BASE_URL;
  }
  if (env.WORKOS_JWKS_URL) {
    options.jwksUrl = env.WORKOS_JWKS_URL;
  }
  return options;
}

type WorkOsRejection = {
  path: "dashboard" | "cli";
  reason: WorkOsRejectReason;
  detail?: Record<string, unknown>;
};

// Tag each attempt's rejections with its path and push them into a shared sink
// instead of logging eagerly, so a path that fails before another succeeds stays
// silent. onReject only ever appends, so it cannot throw out of verification.
function collectRejections(
  options: WorkOsVerificationOptions,
  path: WorkOsRejection["path"],
  sink: WorkOsRejection[],
): WorkOsVerificationOptions {
  return {
    ...options,
    onReject: (reason, detail) => {
      sink.push(detail ? { path, reason, detail } : { path, reason });
    },
  };
}

// Web auth fails closed to a generic 401, so the only way to tell a misconfigured
// token apart from a real rejection is to log the structured reason. Detail never
// includes the token, sub, or email — see WorkOsRejectReason.
function logWorkOsRejections(rejections: WorkOsRejection[]): void {
  for (const { path, reason, detail } of rejections) {
    console.warn(JSON.stringify({ event: "workos_auth_reject", path, reason, ...(detail ?? {}) }));
  }
}

function cliVerifyOptions(env: Env): WorkOsVerificationOptions | null {
  if (!env.WORKOS_API_KEY || !env.WORKOS_CLI_AUDIENCE) {
    return null;
  }
  // WorkOS Connect access tokens carry no `client_id`/`azp` claim, and their
  // `aud` is the environment OIDC client (not the CLI OAuth app). So we match on
  // `aud` (requireClientIdClaim false) against WORKOS_CLI_AUDIENCE; the AuthKit
  // issuer and JWKS below pin the token to our tenant.
  const options: WorkOsVerificationOptions = {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLI_AUDIENCE,
    requireClientIdClaim: false,
  };
  if (env.WORKOS_API_BASE_URL) {
    options.apiBaseUrl = env.WORKOS_API_BASE_URL;
  }
  if (env.WORKOS_CLI_ISSUER) {
    options.issuers = [env.WORKOS_CLI_ISSUER];
  }
  if (env.WORKOS_CLI_JWKS_URL) {
    options.jwksUrl = env.WORKOS_CLI_JWKS_URL;
  }
  return options;
}

// Operator routes accept exactly two identities and collapse every failure to
// null so the registrar returns a generic not_found (ADR 0046): (1) a WorkOS
// session whose verified email is in OPERATOR_EMAILS, or (2) a Cloudflare Access
// service-token JWT carrying a common_name. API keys never reach this path.
async function authenticateOperator(request: Request, env: Env): Promise<string | null> {
  const identity = await authenticateWebIdentity(request, env);
  if (identity && isOperator(env.OPERATOR_EMAILS, identity.email)) {
    return identity.email.toLowerCase();
  }

  if (env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) {
    const commonName = await verifyCfAccessServiceToken(request.headers.get("Cf-Access-Jwt-Assertion"), {
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      aud: env.CF_ACCESS_AUD,
    });
    if (commonName) {
      return commonName;
    }
  }

  return null;
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

function webMemberActor(principal: Principal): ApiActor | null {
  if (principal.kind !== "workos_access_token" || !principal.actor || principal.actor.type !== "member") {
    return null;
  }
  return principal.actor as ApiActor;
}

function platformActor(principal: Principal): PlatformActor | null {
  if (principal.kind !== "operator") {
    return null;
  }
  return { type: "platform", id: principal.actor.id };
}

function authService(env: Env): AuthService | undefined {
  if (env.AUTH) {
    return env.AUTH;
  }
  return postgresRuntime(env)?.auth;
}

function apiDatabase(env: Env): Repository | undefined {
  if (isApiDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

function postgresRuntime(env: Env): { auth: AuthService; db: Repository } | undefined {
  if (!isHyperdriveBinding(env.DB) || !env.API_KEY_PEPPER_V1) {
    return undefined;
  }
  const services = createPostgresServices({
    executor: createHyperdriveExecutor(env.DB),
    apiKeyPepper: env.API_KEY_PEPPER_V1,
    apiKeyEnv: env.API_KEY_ENV ?? "preview",
    apiBaseUrl: apiBaseUrl(env),
    contentBaseUrl: contentBaseUrl(env),
  });
  return { auth: services.auth, db: services.apiDb };
}

function isApiDatabase(value: Env["DB"]): value is Repository {
  return typeof value === "object" && value !== null && "getWhoami" in value;
}

function isHyperdriveBinding(value: Env["DB"]): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}

async function runCleanupAndDeny(
  env: Env,
  db: Repository,
  actor: AdminActor,
  dryRun: boolean,
  batchSize: number,
  idempotencyKey?: string,
): Promise<unknown> {
  const input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize: number;
    now: string;
  } = {
    actor,
    dryRun,
    batchSize,
    now: new Date().toISOString(),
  };
  if (idempotencyKey) {
    input.idempotencyKey = idempotencyKey;
  }
  const result = await db.runCleanup(input);
  if (!dryRun && result && typeof result === "object" && "expired_artifact_ids" in result) {
    const ids = (result as { expired_artifact_ids?: unknown }).expired_artifact_ids;
    if (Array.isArray(ids)) {
      const stringIds = ids.filter((value): value is string => typeof value === "string");
      await Promise.all(stringIds.map((id) => denyArtifact(env, id)));
      const purgeCounts = await Promise.all(stringIds.map((id) => purgeArtifactBytes(env, id)));
      const total = purgeCounts.reduce((sum, count) => sum + count, 0);
      return { ...(result as Record<string, unknown>), deleted_r2_objects: total };
    }
  }
  return result;
}

async function denyArtifact(env: Env, artifactId: string): Promise<void> {
  if (!artifactId || !env.DENYLIST) {
    return;
  }
  await env.DENYLIST.put(`ad:${artifactId}`, JSON.stringify({ reason: "deletion", at: new Date().toISOString() }), {
    expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS,
  });
}

async function purgeArtifactBytes(env: Env, artifactId: string): Promise<number> {
  if (!artifactId || !env.ARTIFACTS) {
    return 0;
  }
  const prefix = `artifacts/${artifactId}/`;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const listOptions: { prefix: string; cursor?: string } = { prefix };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const page = await env.ARTIFACTS.list(listOptions);
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) {
      await env.ARTIFACTS.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

// Test-only routes. Gated to non-production environments so the production
// API never exposes them, even if an operator with the admin token tried.
async function forceExpire(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!isNonProductionEnv(env)) {
    return errorResponse(context, "not_found");
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const db = apiDatabase(env);
  if (!db?.forceExpireArtifact) {
    return errorResponse(context, "not_supported");
  }
  const body = await readJsonObject(request);
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!artifactId) {
    return errorResponse(context, "invalid_request", "artifact_id is required");
  }
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  const result = await db.forceExpireArtifact({ artifactId, expiresAt });
  return result ? jsonResponse(context, result) : errorResponse(context, "not_found");
}

async function listR2Prefix(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!isNonProductionEnv(env)) {
    return errorResponse(context, "not_found");
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  if (!env.ARTIFACTS) {
    return jsonResponse(context, { keys: [], r2_bound: false });
  }
  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listOptions: { prefix: string; cursor?: string } = { prefix };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const page = await env.ARTIFACTS.list(listOptions);
    for (const object of page.objects) {
      keys.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return jsonResponse(context, { keys, r2_bound: true });
}

async function getDenylistKey(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!isNonProductionEnv(env)) {
    return errorResponse(context, "not_found");
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  if (!env.DENYLIST?.get) {
    return jsonResponse(context, { key: null, value: null, kv_bound: false });
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) {
    return errorResponse(context, "invalid_request", "key is required");
  }
  const value = await env.DENYLIST.get(key);
  return jsonResponse(context, { key, value, kv_bound: true });
}

function isNonProductionEnv(env: Env): boolean {
  const value = env.AGENT_PASTE_ENV;
  return value !== undefined && value !== "production" && value !== "live";
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  const value = await request.json();
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function contentBaseUrl(env: Env): string {
  return env.CONTENT_BASE_URL ?? "https://usercontent.agent-paste.sh";
}

function apiBaseUrl(env: Env): string {
  return env.API_BASE_URL ?? "https://api.agent-paste.sh";
}

function agentViewSigningSecret(env: Env): string | undefined {
  return env.AGENT_VIEW_SIGNING_SECRET ?? env.CONTENT_SIGNING_SECRET;
}

async function signAgentViewContentUrls(view: unknown, env: Env): Promise<unknown> {
  if (!env.CONTENT_SIGNING_SECRET || !view || typeof view !== "object") {
    return view;
  }

  const data = view as {
    artifact_id?: unknown;
    revision_id?: unknown;
    entrypoint?: unknown;
    expires_at?: unknown;
    view_url?: unknown;
    files?: Array<{ path?: unknown; url?: unknown } & Record<string, unknown>>;
  };
  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return view;
  }

  const entrypoint = typeof data.entrypoint === "string" ? data.entrypoint : undefined;
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : undefined;
  const signedFiles = Array.isArray(data.files)
    ? await Promise.all(
        data.files.map(async (file) => {
          if (typeof file.path !== "string") {
            return file;
          }
          return {
            ...file,
            url: await signedContentUrl(
              env,
              data.artifact_id as string,
              data.revision_id as string,
              file.path,
              expiresAt,
            ),
          };
        }),
      )
    : data.files;

  return {
    ...data,
    view_url: entrypoint
      ? await signedContentUrl(env, data.artifact_id, data.revision_id, entrypoint, expiresAt)
      : typeof data.view_url === "string"
        ? data.view_url
        : undefined,
    files: signedFiles,
  };
}

async function signedContentUrl(
  env: Env,
  artifactId: string,
  revisionId: string,
  path: string,
  expiresAt?: string,
): Promise<string> {
  if (!env.CONTENT_SIGNING_SECRET) {
    return `${contentBaseUrl(env)}/v/${artifactId}.${revisionId}/${encodePath(path)}`;
  }
  return mintContentUrl({
    baseUrl: contentBaseUrl(env),
    secret: env.CONTENT_SIGNING_SECRET,
    payload: {
      artifact_id: artifactId,
      revision_id: revisionId,
      paths: [path],
      exp: contentTokenExpiration(expiresAt),
    },
    path,
  });
}

function contentTokenExpiration(expiresAt: string | undefined): number {
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000) + usagePolicy.default_ttl_seconds;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonResponse(
  context: AppContext,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return runtimeJsonResponse(context, body, status, extraHeaders);
}

function errorResponse(
  context: AppContext,
  code: AppErrorCode,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return runtimeErrorResponse(context, code, {
    message,
    headers: extraHeaders,
    docsBaseUrl: context.env.DOCS_BASE_URL,
  });
}

async function runIdempotent(context: AppContext, run: () => Promise<unknown>, successStatus = 200): Promise<Response> {
  try {
    return jsonResponse(context, await run(), successStatus);
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return errorResponse(context, "idempotency_in_flight");
    }
    if (error instanceof RepositoryRouteError) {
      return errorResponse(context, error.code, error.message);
    }
    throw error;
  }
}

function mapRepositoryError(error: unknown): { code: AppErrorCode; message?: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }
  switch (error.message) {
    case "artifact_not_found":
      return { code: "artifact_not_found" };
    case "revision_unpublished":
      return { code: "revision_unpublished" };
    case "revision_retained":
      return { code: "revision_retained" };
    case "entrypoint_not_in_revision":
      return { code: "entrypoint_not_in_revision" };
    case "draft_revision_conflict":
      return { code: "draft_revision_conflict" };
    default:
      return null;
  }
}

function entrypointPathFromViewUrl(viewUrl: string) {
  const match = viewUrl.match(/\/v\/[^/]+\/([^?#]+)$/);
  return decodeURIComponent(match?.[1] ?? "index.html");
}

async function signPublishResult(result: unknown, env: Env): Promise<unknown> {
  if (!result || typeof result !== "object") {
    return result;
  }
  const data = result as {
    artifact_id?: unknown;
    revision_id?: unknown;
    view_url?: unknown;
    agent_view_url?: unknown;
    expires_at?: unknown;
  };
  if (typeof data.artifact_id !== "string" || typeof data.revision_id !== "string") {
    return result;
  }
  const entrypointPath = typeof data.view_url === "string" ? entrypointPathFromViewUrl(data.view_url) : "index.html";
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : undefined;
  const secret = agentViewSigningSecret(env);
  return {
    ...data,
    view_url: await signedContentUrl(env, data.artifact_id, data.revision_id, entrypointPath, expiresAt),
    agent_view_url: secret
      ? await mintAgentViewUrl({
          baseUrl: apiBaseUrl(env),
          secret,
          payload: {
            artifact_id: data.artifact_id,
            revision_id: data.revision_id,
            exp: contentTokenExpiration(expiresAt),
          },
        })
      : typeof data.agent_view_url === "string"
        ? data.agent_view_url
        : `${apiBaseUrl(env)}/v1/public/agent-view/${data.artifact_id}.${data.revision_id}`,
  };
}

function contractById<Id extends RouteId>(id: Id): ContractById<Id> {
  const contract = routeContracts.find((route) => route.id === id);
  if (!contract) {
    throw new Error(`Missing route contract ${id}`);
  }
  return contract as ContractById<Id>;
}

function htmlAgentViewResponse(context: AppContext, view: unknown): Response {
  const data = view as {
    artifact_id?: string;
    revision_id?: string;
    title?: string;
    view_url?: string;
    files?: Array<{ path?: string; url?: string; content_type?: string; size_bytes?: number }>;
  };
  const files = Array.isArray(data.files) ? data.files : [];
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(data.title ?? "Agent View")}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111827; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      pre { background: #f3f4f6; border: 1px solid #e5e7eb; padding: 1rem; overflow: auto; }
      a { color: #064e3b; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(data.title ?? "Agent View")}</h1>
    <p><strong>Artifact:</strong> <code>${escapeHtml(data.artifact_id ?? "")}</code></p>
    <p><strong>Revision:</strong> <code>${escapeHtml(data.revision_id ?? "")}</code></p>
    ${data.view_url ? `<p><a href="${escapeAttribute(data.view_url)}">Open entrypoint</a></p>` : ""}
    <h2>Files</h2>
    <ul>
      ${files
        .map(
          (file) =>
            `<li><a href="${escapeAttribute(file.url ?? "#")}">${escapeHtml(file.path ?? "")}</a> <code>${escapeHtml(
              file.content_type ?? "",
            )}</code> ${typeof file.size_bytes === "number" ? `${file.size_bytes} bytes` : ""}</li>`,
        )
        .join("")}
    </ul>
    <h2>JSON</h2>
    <pre>${escapeHtml(JSON.stringify(view, null, 2))}</pre>
  </body>
</html>`;

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      [REQUEST_ID_HEADER]: getRequestId(context),
    },
  });
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
