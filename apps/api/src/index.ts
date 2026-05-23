import {
  buildErrorBody,
  cachedLookup,
  cacheKeyForSecret,
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestIdVariables,
  requestIdMiddleware,
  verifyAdminToken,
} from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import { buildApiOpenApiDocument } from "@agent-paste/contracts";
import { createHyperdriveExecutor, createPostgresServices, type HyperdriveBinding } from "@agent-paste/db";
import { type Context, Hono } from "hono";
import { resolveWorkOsIdentity, type WebCallbackIdentity, type WorkOsIdentity } from "./workos.js";

export type ApiActor = {
  type: "api_key" | "member" | "admin" | "system";
  id: string;
  workspace_id?: string;
  scopes?: string[];
};

export type AuthService = {
  verifyApiKey(apiKey: string): Promise<ApiActor | null>;
  verifyAdminToken?(token: string): Promise<ApiActor | null>;
  verifyWebToken?(token: string): Promise<WebCallbackIdentity | null>;
};

type AdminActor = { type: "admin" | "system"; id: string };

export type ApiDatabase = {
  getWhoami(actor: ApiActor): Promise<unknown>;
  getAgentView(input: {
    actor: ApiActor;
    artifactId: string;
    revisionId?: string;
    contentBaseUrl: string;
  }): Promise<unknown | null>;
  getPublicAgentView(input: { token: string; contentBaseUrl: string }): Promise<unknown | null>;
  resolveWebMember?(input: {
    workosUserId: string;
    email: string;
    idempotencyKey: string;
    now?: string;
  }): Promise<unknown>;
  getWebMemberByWorkOsUserId?(input: { workosUserId: string }): Promise<ApiActor | null>;
  getWebWorkspace?(actor: ApiActor): Promise<unknown>;
  listWebArtifacts?(actor: ApiActor): Promise<unknown>;
  getWebArtifact?(actor: ApiActor, artifactId: string): Promise<unknown | null>;
  listWebApiKeys?(actor: ApiActor): Promise<unknown>;
  listWebAuditEvents?(actor: ApiActor): Promise<unknown>;
  getWebSettings?(actor: ApiActor): Promise<unknown>;
  getAdminWhoami?(actor: ApiActor): Promise<unknown>;
  createWorkspace?(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
  }): Promise<unknown>;
  listWorkspaces?(): unknown;
  createApiKey?(input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
  }): Promise<unknown>;
  revokeApiKey?(input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string }): Promise<unknown>;
  listArtifacts?(workspaceId?: string, status?: string): unknown;
  getArtifactDetail?(artifactId: string): unknown | null;
  deleteArtifact?(input: {
    actor: AdminActor;
    idempotencyKey: string;
    artifactId: string;
  }): Promise<{ artifact_id: string; revision_id?: string; deleted_at: string } | unknown>;
  listOperationEvents?(): unknown;
  runCleanup(input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize: number;
    now: string;
  }): Promise<unknown>;
  forceExpireArtifact?(input: {
    artifactId: string;
    expiresAt: string;
  }): Promise<{ artifact_id: string; expires_at: string } | null>;
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
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  AUTH?: AuthService;
  DB?: ApiDatabase | HyperdriveBinding;
  ARTIFACTS?: R2Bucket;
  ADMIN_TOKEN?: string;
  ADMIN_TOKEN_HASH?: string;
  API_KEY_PEPPER_V1?: string;
  API_KEY_ENV?: "preview" | "production" | "live";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  AGENT_VIEW_SIGNING_SECRET?: string;
  CLEANUP_BATCH_SIZE?: string;
  DENYLIST?: KVNamespace;
  ACTOR_RATE_LIMIT?: RateLimitBinding;
  WORKSPACE_BURST_CAP?: RateLimitBinding;
  ALLOW_LEGACY_AGENT_VIEW_TOKENS?: string;
  AGENT_PASTE_ENV?: string;
  DOCS_BASE_URL?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_BASE_URL?: string;
  WORKOS_ISSUER?: string;
  WORKOS_JWKS_URL?: string;
};

type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables }>;

type ScheduledEvent = {
  type: "scheduled";
  scheduledTime: number;
  cron: string;
};

type RouteParams = Record<string, string>;
type AgentViewTokenPayload = {
  artifact_id: string;
  revision_id: string;
  exp: number;
};

const jsonHeaders = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const usagePolicy = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: 25 * 1024 * 1024,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 24 * 60 * 60,
  default_ttl_seconds: 30 * 24 * 60 * 60,
  min_ttl_seconds: 24 * 60 * 60,
  max_ttl_seconds: 90 * 24 * 60 * 60,
};
const DENYLIST_EXPIRATION_TTL_SECONDS = usagePolicy.max_ttl_seconds;
const AUTH_CACHE_TTL_SECONDS = 60;
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();

app.use("*", requestIdMiddleware());
app.get("/openapi.json", (context) =>
  context.json(
    buildApiOpenApiDocument({ serverUrl: context.env.API_BASE_URL, docsBaseUrl: context.env.DOCS_BASE_URL }),
  ),
);
app.get("/v1/whoami", (context) => whoami(context));
app.get("/v1/usage-policy", (context) => getUsagePolicy(context));
app.get("/v1/public/agent-view/:token", (context) => publicAgentView(context, { token: context.req.param("token") }));
app.post("/v1/auth/web/callback", (context) => webAuthCallback(context));
app.get("/v1/web/workspace", (context) => webWorkspace(context));
app.get("/v1/web/artifacts", (context) => webArtifacts(context));
app.get("/v1/web/artifacts/:artifactId", (context) =>
  webArtifactDetail(context, { artifactId: context.req.param("artifactId") }),
);
app.get("/v1/web/keys", (context) => webApiKeys(context));
app.get("/v1/web/audit", (context) => webAudit(context));
app.get("/v1/web/settings", (context) => webSettings(context));
app.get("/v1/artifacts/:artifactId/agent-view", (context) =>
  authenticatedAgentView(context, { artifactId: context.req.param("artifactId") }),
);
app.get("/v1/artifacts/:artifactId/revisions/:revisionId/agent-view", (context) =>
  authenticatedAgentView(context, {
    artifactId: context.req.param("artifactId"),
    revisionId: context.req.param("revisionId"),
  }),
);
app.get("/admin/whoami", (context) => adminWhoami(context));
app.post("/admin/workspaces", (context) => createWorkspace(context));
app.get("/admin/workspaces", (context) => listWorkspaces(context));
app.post("/admin/workspaces/:workspaceId/api-keys", (context) =>
  createApiKey(context, { workspaceId: context.req.param("workspaceId") }),
);
app.delete("/admin/api-keys/:apiKeyId", (context) =>
  revokeApiKey(context, { apiKeyId: context.req.param("apiKeyId") }),
);
app.get("/admin/artifacts", (context) => listArtifacts(context));
app.get("/admin/artifacts/:artifactId", (context) =>
  inspectArtifact(context, { artifactId: context.req.param("artifactId") }),
);
app.delete("/admin/artifacts/:artifactId", (context) =>
  deleteArtifact(context, { artifactId: context.req.param("artifactId") }),
);
app.post("/admin/cleanup/run", (context) => cleanup(context));
app.get("/admin/operation-events", (context) => listOperationEvents(context));
app.post("/__test__/force-expire", (context) => forceExpire(context));
app.get("/__test__/r2-list", (context) => listR2Prefix(context));
app.get("/__test__/denylist", (context) => getDenylistKey(context));
app.notFound((context) => errorResponse(context, "not_found", 404));
app.onError((error, context) => {
  console.error("Unhandled API error:", error);
  return errorResponse(context, "internal_error", 500);
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

async function whoami(context: AppContext): Promise<Response> {
  const env = context.env;
  const actor = await authenticateApiKey(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const limited = await rateLimitAuthenticatedRequest(context, actor);
  if (limited) {
    return limited;
  }

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse(context, "database_unavailable", 503);
  }

  return jsonResponse(context, await db.getWhoami(actor));
}

async function getUsagePolicy(context: AppContext): Promise<Response> {
  const env = context.env;
  const actor = await authenticateApiKey(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const limited = await rateLimitAuthenticatedRequest(context, actor);
  if (limited) {
    return limited;
  }
  return jsonResponse(context, usagePolicy);
}

async function authenticatedAgentView(context: AppContext, params: RouteParams): Promise<Response> {
  const env = context.env;
  const actor = await authenticateApiKey(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const limited = await rateLimitAuthenticatedRequest(context, actor);
  if (limited) {
    return limited;
  }

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse(context, "database_unavailable", 503);
  }

  const input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string } = {
    actor,
    artifactId: params.artifactId ?? "",
    contentBaseUrl: contentBaseUrl(env),
  };
  if (params.revisionId) {
    input.revisionId = params.revisionId;
  }

  const view = await db.getAgentView(input);

  return view
    ? jsonResponse(context, await signAgentViewContentUrls(view, env))
    : errorResponse(context, "not_found", 404);
}

async function publicAgentView(context: AppContext, params: RouteParams): Promise<Response> {
  const env = context.env;
  const db = apiDatabase(env);
  if (!db) {
    return errorResponse(context, "database_unavailable", 503);
  }

  const publicToken = await publicAgentViewDatabaseToken(params.token ?? "", env);
  if (!publicToken) {
    return errorResponse(context, "not_found", 404);
  }

  const view = await db.getPublicAgentView({
    token: publicToken,
    contentBaseUrl: contentBaseUrl(env),
  });

  if (!view) {
    return errorResponse(context, "not_found", 404);
  }

  const signedView = await signAgentViewContentUrls(view, env);
  return wantsHtml(context.req.raw) ? htmlAgentViewResponse(context, signedView) : jsonResponse(context, signedView);
}

async function webAuthCallback(context: AppContext): Promise<Response> {
  const identity = await authenticateWebIdentity(context.req.raw, context.env);
  if (!identity) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const db = apiDatabase(context.env);
  if (!db?.resolveWebMember) {
    return errorResponse(context, "database_unavailable", 503);
  }
  const resolveWebMember = db.resolveWebMember.bind(db);
  if (!hasWebCallbackId(identity)) {
    return errorResponse(context, "not_authenticated", 401, "missing WorkOS token_id or session_id");
  }
  const idempotencyKey = webCallbackIdempotencyKey(identity);
  return runIdempotent(context, () =>
    resolveWebMember({
      workosUserId: identity.workos_user_id,
      email: identity.email,
      idempotencyKey,
      now: new Date().toISOString(),
    }),
  );
}

async function webWorkspace(context: AppContext): Promise<Response> {
  return withWebMember(context, [], async (db, actor) =>
    db.getWebWorkspace
      ? jsonResponse(context, await db.getWebWorkspace(actor))
      : errorResponse(context, "database_unavailable", 503),
  );
}

async function webArtifacts(context: AppContext): Promise<Response> {
  return withWebMember(context, ["read"], async (db, actor) =>
    db.listWebArtifacts
      ? jsonResponse(context, await db.listWebArtifacts(actor))
      : errorResponse(context, "database_unavailable", 503),
  );
}

async function webArtifactDetail(context: AppContext, params: RouteParams): Promise<Response> {
  return withWebMember(context, ["read"], async (db, actor) => {
    if (!db.getWebArtifact) {
      return errorResponse(context, "database_unavailable", 503);
    }
    const detail = await db.getWebArtifact(actor, params.artifactId ?? "");
    return detail ? jsonResponse(context, detail) : errorResponse(context, "artifact_not_found", 404);
  });
}

async function webApiKeys(context: AppContext): Promise<Response> {
  return withWebMember(context, ["admin"], async (db, actor) =>
    db.listWebApiKeys
      ? jsonResponse(context, await db.listWebApiKeys(actor))
      : errorResponse(context, "database_unavailable", 503),
  );
}

async function webAudit(context: AppContext): Promise<Response> {
  return withWebMember(context, ["admin"], async (db, actor) =>
    db.listWebAuditEvents
      ? jsonResponse(context, await db.listWebAuditEvents(actor))
      : errorResponse(context, "database_unavailable", 503),
  );
}

async function webSettings(context: AppContext): Promise<Response> {
  return withWebMember(context, ["admin"], async (db, actor) =>
    db.getWebSettings
      ? jsonResponse(context, await db.getWebSettings(actor))
      : errorResponse(context, "database_unavailable", 503),
  );
}

async function adminWhoami(context: AppContext): Promise<Response> {
  const env = context.env;
  const actor = await authenticateAdmin(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }

  const db = apiDatabase(env);
  if (db?.getAdminWhoami) {
    return jsonResponse(context, await db.getAdminWhoami(actor));
  }

  return jsonResponse(context, { actor });
}

async function cleanup(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse(context, "invalid_idempotency_key", 400);
  }

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse(context, "database_unavailable", 503);
  }

  const body = await readJsonObject(request);
  const dryRun = body.dry_run === true;
  const batchSize = numberFromEnv(env.CLEANUP_BATCH_SIZE, 100);

  return runIdempotent(context, () => runCleanupAndDeny(env, db, adminActor(actor), dryRun, batchSize, idempotencyKey));
}

async function createWorkspace(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse(context, "invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.createWorkspace) {
    return errorResponse(context, "database_unavailable", 503);
  }
  const dbWithCreateWorkspace = db as ApiDatabase & Required<Pick<ApiDatabase, "createWorkspace">>;
  const body = await readJsonObject(request);
  if (typeof body.email !== "string") {
    return errorResponse(context, "invalid_request", 400, "email is required");
  }
  const input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
  } = { actor: adminActor(actor), idempotencyKey, email: body.email };
  if (typeof body.name === "string") {
    input.name = body.name;
  }
  return runIdempotent(context, () => dbWithCreateWorkspace.createWorkspace(input), 201);
}

async function listWorkspaces(context: AppContext): Promise<Response> {
  const env = context.env;
  const actor = await authenticateAdmin(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const db = apiDatabase(env);
  return db?.listWorkspaces
    ? jsonResponse(context, await db.listWorkspaces())
    : errorResponse(context, "database_unavailable", 503);
}

async function createApiKey(context: AppContext, params: RouteParams): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse(context, "invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.createApiKey) {
    return errorResponse(context, "database_unavailable", 503);
  }
  const dbWithCreateApiKey = db as ApiDatabase & Required<Pick<ApiDatabase, "createApiKey">>;
  const body = await readJsonObject(request);
  if (typeof body.name !== "string") {
    return errorResponse(context, "invalid_request", 400, "name is required");
  }
  return runIdempotent(
    context,
    () =>
      dbWithCreateApiKey.createApiKey({
        actor: adminActor(actor),
        idempotencyKey,
        workspaceId: params.workspaceId ?? "",
        name: body.name as string,
      }),
    201,
  );
}

async function revokeApiKey(context: AppContext, params: RouteParams): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse(context, "invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.revokeApiKey) {
    return errorResponse(context, "database_unavailable", 503);
  }
  const dbWithRevokeApiKey = db as ApiDatabase & Required<Pick<ApiDatabase, "revokeApiKey">>;
  return runIdempotent(context, () =>
    dbWithRevokeApiKey.revokeApiKey({
      actor: adminActor(actor),
      idempotencyKey,
      apiKeyId: params.apiKeyId ?? "",
    }),
  );
}

async function listArtifacts(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const url = new URL(request.url);
  const db = apiDatabase(env);
  return db?.listArtifacts
    ? jsonResponse(
        context,
        await db.listArtifacts(
          url.searchParams.get("workspace") ?? undefined,
          url.searchParams.get("status") ?? undefined,
        ),
      )
    : errorResponse(context, "database_unavailable", 503);
}

async function inspectArtifact(context: AppContext, params: RouteParams): Promise<Response> {
  const env = context.env;
  const actor = await authenticateAdmin(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const db = apiDatabase(env);
  const detail = await db?.getArtifactDetail?.(params.artifactId ?? "");
  return detail ? jsonResponse(context, detail) : errorResponse(context, "not_found", 404);
}

async function deleteArtifact(context: AppContext, params: RouteParams): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse(context, "invalid_idempotency_key", 400);
  }
  const artifactId = params.artifactId ?? "";
  const db = apiDatabase(env);
  if (!db?.deleteArtifact) {
    return errorResponse(context, "database_unavailable", 503);
  }
  const dbWithDeleteArtifact = db as ApiDatabase & Required<Pick<ApiDatabase, "deleteArtifact">>;
  return runIdempotent(context, async () => {
    const result = await dbWithDeleteArtifact.deleteArtifact({
      actor: adminActor(actor),
      idempotencyKey,
      artifactId,
    });
    await denyArtifact(env, artifactId);
    const purged = await purgeArtifactBytes(env, artifactId);
    if (result && typeof result === "object") {
      return { ...(result as Record<string, unknown>), deleted_r2_objects: purged };
    }
    return result;
  });
}

async function listOperationEvents(context: AppContext): Promise<Response> {
  const env = context.env;
  const actor = await authenticateAdmin(context.req.raw, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const db = apiDatabase(env);
  return db?.listOperationEvents
    ? jsonResponse(context, await db.listOperationEvents())
    : errorResponse(context, "database_unavailable", 503);
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

async function authenticateApiKey(request: Request, env: Env): Promise<ApiActor | null> {
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

async function authenticateAdmin(request: Request, env: Env): Promise<ApiActor | null> {
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

async function authenticateWebIdentity(request: Request, env: Env): Promise<WorkOsIdentity | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  if (env.AUTH?.verifyWebToken) {
    return env.AUTH.verifyWebToken(token);
  }

  if (!env.WORKOS_API_KEY || !env.WORKOS_CLIENT_ID) {
    return null;
  }

  const options: {
    apiKey: string;
    clientId: string;
    apiBaseUrl?: string;
    issuer?: string;
    jwksUrl?: string;
    requireClientIdClaim?: boolean;
  } = {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    requireClientIdClaim: true,
  };
  if (env.WORKOS_API_BASE_URL) {
    options.apiBaseUrl = env.WORKOS_API_BASE_URL;
  }
  if (env.WORKOS_ISSUER) {
    options.issuer = env.WORKOS_ISSUER;
  }
  if (env.WORKOS_JWKS_URL) {
    options.jwksUrl = env.WORKOS_JWKS_URL;
  }

  return resolveWorkOsIdentity(`Bearer ${token}`, options);
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

async function withWebMember(
  context: AppContext,
  requiredScopes: readonly string[],
  run: (db: ApiDatabase, actor: ApiActor) => Promise<Response>,
): Promise<Response> {
  const identity = await authenticateWebIdentity(context.req.raw, context.env);
  if (!identity) {
    return errorResponse(context, "not_authenticated", 401);
  }

  const db = apiDatabase(context.env);
  if (!db?.getWebMemberByWorkOsUserId) {
    return errorResponse(context, "database_unavailable", 503);
  }

  const actor = await db.getWebMemberByWorkOsUserId({
    workosUserId: identity.workos_user_id,
  });
  if (!actor || actor.type !== "member" || !actor.workspace_id) {
    return errorResponse(context, "forbidden", 403);
  }

  const limited = await rateLimitAuthenticatedRequest(context, actor);
  if (limited) {
    return limited;
  }
  if (!hasScopes(actor, requiredScopes)) {
    return errorResponse(context, "forbidden", 403);
  }

  return run(db, actor);
}

function hasScopes(actor: ApiActor, requiredScopes: readonly string[]): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }
  const actorScopes = new Set(actor.scopes ?? []);
  return requiredScopes.every((scope) => actorScopes.has(scope));
}

function authService(env: Env): AuthService | undefined {
  if (env.AUTH) {
    return env.AUTH;
  }
  return postgresRuntime(env)?.auth;
}

function apiDatabase(env: Env): ApiDatabase | undefined {
  if (isApiDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

function postgresRuntime(env: Env): { auth: AuthService; db: ApiDatabase } | undefined {
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

function isApiDatabase(value: Env["DB"]): value is ApiDatabase {
  return typeof value === "object" && value !== null && "getWhoami" in value;
}

function isHyperdriveBinding(value: Env["DB"]): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}

async function runCleanupAndDeny(
  env: Env,
  db: ApiDatabase,
  actor: { type: "admin" | "system"; id: string },
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
    return errorResponse(context, "not_found", 404);
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  const db = apiDatabase(env);
  if (!db?.forceExpireArtifact) {
    return errorResponse(context, "not_supported", 501);
  }
  const body = await readJsonObject(request);
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!artifactId) {
    return errorResponse(context, "invalid_request", 400, "artifact_id is required");
  }
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  const result = await db.forceExpireArtifact({ artifactId, expiresAt });
  return result ? jsonResponse(context, result) : errorResponse(context, "not_found", 404);
}

async function listR2Prefix(context: AppContext): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!isNonProductionEnv(env)) {
    return errorResponse(context, "not_found", 404);
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
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
    return errorResponse(context, "not_found", 404);
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse(context, "not_authenticated", 401);
  }
  if (!env.DENYLIST?.get) {
    return jsonResponse(context, { key: null, value: null, kv_bound: false });
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) {
    return errorResponse(context, "invalid_request", 400, "key is required");
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

async function publicAgentViewDatabaseToken(token: string, env: Env): Promise<string | null> {
  const secret = agentViewSigningSecret(env);
  if (!secret) {
    return allowLegacyAgentViewTokens(env) ? legacyAgentViewToken(token) : null;
  }

  const payload = await verifySignedPayload<AgentViewTokenPayload>(token, secret);
  if (!payload || !isValidAgentViewTokenPayload(payload)) {
    return null;
  }

  return `${payload.artifact_id}.${payload.revision_id}`;
}

function agentViewSigningSecret(env: Env): string | undefined {
  return env.AGENT_VIEW_SIGNING_SECRET ?? env.CONTENT_SIGNING_SECRET;
}

function legacyAgentViewToken(token: string): string | null {
  const [artifactId, revisionId] = token.split(".");
  return artifactId?.startsWith("art_") && revisionId?.startsWith("rev_") ? token : null;
}

function allowLegacyAgentViewTokens(env: Env): boolean {
  return env.ALLOW_LEGACY_AGENT_VIEW_TOKENS === "true" || env.ALLOW_LEGACY_AGENT_VIEW_TOKENS === "1";
}

function isValidAgentViewTokenPayload(payload: AgentViewTokenPayload): boolean {
  return (
    typeof payload.artifact_id === "string" &&
    payload.artifact_id.startsWith("art_") &&
    typeof payload.revision_id === "string" &&
    payload.revision_id.startsWith("rev_") &&
    typeof payload.exp === "number" &&
    payload.exp >= Math.floor(Date.now() / 1000)
  );
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
  const token = await signContentToken(
    {
      artifact_id: artifactId,
      revision_id: revisionId,
      paths: [path],
      exp: contentTokenExpiration(expiresAt),
    },
    env.CONTENT_SIGNING_SECRET,
  );
  return `${contentBaseUrl(env)}/v/${encodeURIComponent(token)}/${encodePath(path)}`;
}

function contentTokenExpiration(expiresAt: string | undefined): number {
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000) + usagePolicy.default_ttl_seconds;
}

async function signContentToken(
  payload: { artifact_id: string; revision_id: string; paths: string[]; exp: number },
  secret: string,
): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySignedPayload<T>(token: string, secret: string): Promise<T | null> {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = await hmac(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as T;
  } catch {
    return null;
  }
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function rateLimitAuthenticatedRequest(context: AppContext, actor: ApiActor): Promise<Response | null> {
  const env = context.env;
  if (!env.ACTOR_RATE_LIMIT && !env.WORKSPACE_BURST_CAP) {
    return null;
  }
  if (!actor.workspace_id) {
    return errorResponse(context, "not_authenticated", 401);
  }

  const actorKey = `${actor.workspace_id}:${actor.id}`;
  const actorOutcome = await rateLimitOrFailOpen(env.ACTOR_RATE_LIMIT, "actor", actorKey);
  if (actorOutcome && !actorOutcome.success) {
    return errorResponse(context, "rate_limited_actor", 429, "rate_limited_actor", { "Retry-After": "60" });
  }

  const workspaceOutcome = await rateLimitOrFailOpen(env.WORKSPACE_BURST_CAP, "workspace", actor.workspace_id);
  if (workspaceOutcome && !workspaceOutcome.success) {
    return errorResponse(context, "rate_limited_workspace", 429, "rate_limited_workspace", { "Retry-After": "10" });
  }

  return null;
}

async function rateLimitOrFailOpen(
  binding: RateLimitBinding | undefined,
  scope: "actor" | "workspace",
  key: string,
): Promise<{ success: boolean } | undefined> {
  if (!binding) {
    return undefined;
  }

  try {
    return await binding.limit({ key });
  } catch (error) {
    console.warn(`Rate limit ${scope} binding failed; allowing request.`, error);
    return undefined;
  }
}

function jsonResponse(
  context: AppContext,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, [REQUEST_ID_HEADER]: getRequestId(context), ...extraHeaders },
  });
}

function errorResponse(
  context: AppContext,
  code: string,
  status: number,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const body = buildErrorBody({
    code,
    ...(message !== undefined ? { message } : {}),
    requestId: getRequestId(context),
    docsBaseUrl: context.env.DOCS_BASE_URL,
  });
  return jsonResponse(context, body, status, extraHeaders);
}

function adminActor(actor: ApiActor): AdminActor {
  if (actor.type !== "admin" && actor.type !== "system") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: actor.type, id: actor.id };
}

async function runIdempotent(context: AppContext, run: () => Promise<unknown>, successStatus = 200): Promise<Response> {
  try {
    return jsonResponse(context, await run(), successStatus);
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return errorResponse(context, "idempotency_in_flight", 409);
    }
    throw error;
  }
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

function constantTimeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return diff === 0;
}
