import { cachedLookup, cacheKeyForSecret, verifyAdminToken } from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import { createHyperdriveExecutor, createPostgresServices, type HyperdriveBinding } from "@agent-paste/db";
import { Hono } from "hono";

export type ApiActor = {
  type: "api_key" | "member" | "admin" | "system";
  id: string;
  workspace_id?: string;
  scopes?: string[];
};

export type AuthService = {
  verifyApiKey(apiKey: string): Promise<ApiActor | null>;
  verifyAdminToken?(token: string): Promise<ApiActor | null>;
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
};

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
const app = new Hono<{ Bindings: Env }>();

app.get("/openapi.json", (context) => context.json(openApiDocument()));
app.get("/v1/whoami", (context) => whoami(context.req.raw, context.env));
app.get("/v1/usage-policy", (context) => getUsagePolicy(context.req.raw, context.env));
app.get("/v1/public/agent-view/:token", (context) =>
  publicAgentView(context.req.raw, context.env, { token: context.req.param("token") }),
);
app.get("/v1/artifacts/:artifactId/agent-view", (context) =>
  authenticatedAgentView(context.req.raw, context.env, {
    artifactId: context.req.param("artifactId"),
  }),
);
app.get("/v1/artifacts/:artifactId/revisions/:revisionId/agent-view", (context) =>
  authenticatedAgentView(context.req.raw, context.env, {
    artifactId: context.req.param("artifactId"),
    revisionId: context.req.param("revisionId"),
  }),
);
app.get("/admin/whoami", (context) => adminWhoami(context.req.raw, context.env));
app.post("/admin/workspaces", (context) => createWorkspace(context.req.raw, context.env));
app.get("/admin/workspaces", (context) => listWorkspaces(context.req.raw, context.env));
app.post("/admin/workspaces/:workspaceId/api-keys", (context) =>
  createApiKey(context.req.raw, context.env, {
    workspaceId: context.req.param("workspaceId"),
  }),
);
app.delete("/admin/api-keys/:apiKeyId", (context) =>
  revokeApiKey(context.req.raw, context.env, { apiKeyId: context.req.param("apiKeyId") }),
);
app.get("/admin/artifacts", (context) => listArtifacts(context.req.raw, context.env));
app.get("/admin/artifacts/:artifactId", (context) =>
  inspectArtifact(context.req.raw, context.env, { artifactId: context.req.param("artifactId") }),
);
app.delete("/admin/artifacts/:artifactId", (context) =>
  deleteArtifact(context.req.raw, context.env, { artifactId: context.req.param("artifactId") }),
);
app.post("/admin/cleanup/run", (context) => cleanup(context.req.raw, context.env));
app.get("/admin/operation-events", (context) => listOperationEvents(context.req.raw, context.env));
app.post("/__test__/force-expire", (context) => forceExpire(context.req.raw, context.env));
app.get("/__test__/r2-list", (context) => listR2Prefix(context.req.raw, context.env));
app.get("/__test__/denylist", (context) => getDenylistKey(context.req.raw, context.env));
app.notFound(() => errorResponse("not_found", 404));
app.onError((error) => {
  console.error("Unhandled API error:", error);
  return errorResponse("internal_error", 500);
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

async function whoami(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const limited = await rateLimitAuthenticatedRequest(env, actor);
  if (limited) {
    return limited;
  }

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
  }

  return jsonResponse(await db.getWhoami(actor));
}

async function getUsagePolicy(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const limited = await rateLimitAuthenticatedRequest(env, actor);
  if (limited) {
    return limited;
  }
  return jsonResponse(usagePolicy);
}

async function authenticatedAgentView(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const limited = await rateLimitAuthenticatedRequest(env, actor);
  if (limited) {
    return limited;
  }

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
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

  return view ? jsonResponse(await signAgentViewContentUrls(view, env)) : errorResponse("not_found", 404);
}

async function publicAgentView(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const db = apiDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
  }

  const publicToken = await publicAgentViewDatabaseToken(params.token ?? "", env);
  if (!publicToken) {
    return errorResponse("not_found", 404);
  }

  const view = await db.getPublicAgentView({
    token: publicToken,
    contentBaseUrl: contentBaseUrl(env),
  });

  if (!view) {
    return errorResponse("not_found", 404);
  }

  const signedView = await signAgentViewContentUrls(view, env);
  return wantsHtml(request) ? htmlAgentViewResponse(signedView) : jsonResponse(signedView);
}

async function adminWhoami(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }

  const db = apiDatabase(env);
  if (db?.getAdminWhoami) {
    return jsonResponse(await db.getAdminWhoami(actor));
  }

  return jsonResponse({ actor });
}

async function cleanup(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
  }

  const body = await readJsonObject(request);
  const dryRun = body.dry_run === true;
  const batchSize = numberFromEnv(env.CLEANUP_BATCH_SIZE, 100);

  return runIdempotent(() => runCleanupAndDeny(env, db, adminActor(actor), dryRun, batchSize, idempotencyKey));
}

async function createWorkspace(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.createWorkspace) {
    return errorResponse("database_unavailable", 503);
  }
  const body = await readJsonObject(request);
  if (typeof body.email !== "string") {
    return errorResponse("invalid_request", 400, "email is required");
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
  return runIdempotent(() => db.createWorkspace!(input), 201);
}

async function listWorkspaces(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const db = apiDatabase(env);
  return db?.listWorkspaces ? jsonResponse(await db.listWorkspaces()) : errorResponse("database_unavailable", 503);
}

async function createApiKey(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.createApiKey) {
    return errorResponse("database_unavailable", 503);
  }
  const body = await readJsonObject(request);
  if (typeof body.name !== "string") {
    return errorResponse("invalid_request", 400, "name is required");
  }
  return runIdempotent(
    () =>
      db.createApiKey!({
        actor: adminActor(actor),
        idempotencyKey,
        workspaceId: params.workspaceId ?? "",
        name: body.name as string,
      }),
    201,
  );
}

async function revokeApiKey(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.revokeApiKey) {
    return errorResponse("database_unavailable", 503);
  }
  return runIdempotent(() =>
    db.revokeApiKey!({
      actor: adminActor(actor),
      idempotencyKey,
      apiKeyId: params.apiKeyId ?? "",
    }),
  );
}

async function listArtifacts(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const url = new URL(request.url);
  const db = apiDatabase(env);
  return db?.listArtifacts
    ? jsonResponse(
        await db.listArtifacts(
          url.searchParams.get("workspace") ?? undefined,
          url.searchParams.get("status") ?? undefined,
        ),
      )
    : errorResponse("database_unavailable", 503);
}

async function inspectArtifact(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const db = apiDatabase(env);
  const detail = await db?.getArtifactDetail?.(params.artifactId ?? "");
  return detail ? jsonResponse(detail) : errorResponse("not_found", 404);
}

async function deleteArtifact(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const artifactId = params.artifactId ?? "";
  const db = apiDatabase(env);
  if (!db?.deleteArtifact) {
    return errorResponse("database_unavailable", 503);
  }
  return runIdempotent(async () => {
    const result = await db.deleteArtifact!({
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

async function listOperationEvents(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const db = apiDatabase(env);
  return db?.listOperationEvents
    ? jsonResponse(await db.listOperationEvents())
    : errorResponse("database_unavailable", 503);
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
  await env.DENYLIST.put(`artifact:${artifactId}`, "1", { expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS });
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
async function forceExpire(request: Request, env: Env): Promise<Response> {
  if (!isNonProductionEnv(env)) {
    return errorResponse("not_found", 404);
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const db = apiDatabase(env);
  if (!db?.forceExpireArtifact) {
    return errorResponse("not_supported", 501);
  }
  const body = await readJsonObject(request);
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!artifactId) {
    return errorResponse("invalid_request", 400, "artifact_id is required");
  }
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  const result = await db.forceExpireArtifact({ artifactId, expiresAt });
  return result ? jsonResponse(result) : errorResponse("not_found", 404);
}

async function listR2Prefix(request: Request, env: Env): Promise<Response> {
  if (!isNonProductionEnv(env)) {
    return errorResponse("not_found", 404);
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  if (!env.ARTIFACTS) {
    return jsonResponse({ keys: [], r2_bound: false });
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
  return jsonResponse({ keys, r2_bound: true });
}

async function getDenylistKey(request: Request, env: Env): Promise<Response> {
  if (!isNonProductionEnv(env)) {
    return errorResponse("not_found", 404);
  }
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  if (!env.DENYLIST?.get) {
    return jsonResponse({ key: null, value: null, kv_bound: false });
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) {
    return errorResponse("invalid_request", 400, "key is required");
  }
  const value = await env.DENYLIST.get(key);
  return jsonResponse({ key, value, kv_bound: true });
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

async function rateLimitAuthenticatedRequest(env: Env, actor: ApiActor): Promise<Response | null> {
  if (!env.ACTOR_RATE_LIMIT && !env.WORKSPACE_BURST_CAP) {
    return null;
  }
  if (!actor.workspace_id) {
    return errorResponse("not_authenticated", 401);
  }

  const actorKey = `${actor.workspace_id}:${actor.id}`;
  const actorOutcome = await rateLimitOrFailOpen(env.ACTOR_RATE_LIMIT, "actor", actorKey);
  if (actorOutcome && !actorOutcome.success) {
    return errorResponse("rate_limited_actor", 429, "rate_limited_actor", { "Retry-After": "60" });
  }

  const workspaceOutcome = await rateLimitOrFailOpen(env.WORKSPACE_BURST_CAP, "workspace", actor.workspace_id);
  if (workspaceOutcome && !workspaceOutcome.success) {
    return errorResponse("rate_limited_workspace", 429, "rate_limited_workspace", { "Retry-After": "10" });
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

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

function errorResponse(
  code: string,
  status: number,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse({ error: { code, message: message ?? code } }, status, extraHeaders);
}

function adminActor(actor: ApiActor): AdminActor {
  if (actor.type !== "admin" && actor.type !== "system") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: actor.type, id: actor.id };
}

async function runIdempotent(run: () => Promise<unknown>, successStatus = 200): Promise<Response> {
  try {
    return jsonResponse(await run(), successStatus);
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return errorResponse("idempotency_in_flight", 409);
    }
    throw error;
  }
}

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Paste API",
      version: "0.1.0",
    },
    servers: [{ url: "https://api.agent-paste.sh" }],
    paths: {
      "/v1/whoami": {
        get: {
          operationId: "whoami.get",
          security: [{ ApiKeyBearer: [] }],
          responses: standardResponses("WhoamiResponse"),
        },
      },
      "/v1/usage-policy": {
        get: {
          operationId: "usagePolicy.get",
          security: [{ ApiKeyBearer: [] }],
          responses: standardResponses("UsagePolicy"),
        },
      },
      "/v1/public/agent-view/{token}": {
        get: {
          operationId: "agentView.public",
          parameters: [pathParameter("token", "Signed Agent View token")],
          responses: standardResponses("AgentView"),
        },
      },
      "/v1/artifacts/{artifact_id}/agent-view": {
        get: {
          operationId: "agentView.getLatest",
          security: [{ ApiKeyBearer: [] }],
          parameters: [pathParameter("artifact_id", "Artifact id")],
          responses: standardResponses("AgentView"),
        },
      },
      "/v1/artifacts/{artifact_id}/revisions/{revision_id}/agent-view": {
        get: {
          operationId: "agentView.getRevision",
          security: [{ ApiKeyBearer: [] }],
          parameters: [pathParameter("artifact_id", "Artifact id"), pathParameter("revision_id", "Revision id")],
          responses: standardResponses("AgentView"),
        },
      },
      "/admin/workspaces": {
        get: {
          operationId: "admin.workspaces.list",
          security: [{ AdminBearer: [] }],
          responses: standardResponses("WorkspaceListResponse"),
        },
        post: {
          operationId: "admin.workspaces.create",
          security: [{ AdminBearer: [] }],
          parameters: [idempotencyKeyParameter()],
          responses: standardResponses("WorkspaceDetail", 201),
        },
      },
      "/admin/workspaces/{workspace_id}/api-keys": {
        post: {
          operationId: "admin.apiKeys.create",
          security: [{ AdminBearer: [] }],
          parameters: [pathParameter("workspace_id", "Workspace id"), idempotencyKeyParameter()],
          responses: standardResponses("CreateApiKeyResponse", 201),
        },
      },
      "/admin/api-keys/{api_key_id}": {
        delete: {
          operationId: "admin.apiKeys.revoke",
          security: [{ AdminBearer: [] }],
          parameters: [pathParameter("api_key_id", "API key id"), idempotencyKeyParameter()],
          responses: standardResponses("RevokeApiKeyResponse"),
        },
      },
      "/admin/artifacts": {
        get: {
          operationId: "admin.artifacts.list",
          security: [{ AdminBearer: [] }],
          responses: standardResponses("ArtifactListResponse"),
        },
      },
      "/admin/artifacts/{artifact_id}": {
        get: {
          operationId: "admin.artifacts.get",
          security: [{ AdminBearer: [] }],
          parameters: [pathParameter("artifact_id", "Artifact id")],
          responses: standardResponses("ArtifactDetail"),
        },
        delete: {
          operationId: "admin.artifacts.delete",
          security: [{ AdminBearer: [] }],
          parameters: [pathParameter("artifact_id", "Artifact id"), idempotencyKeyParameter()],
          responses: standardResponses("DeleteArtifactResponse"),
        },
      },
      "/admin/cleanup/run": {
        post: {
          operationId: "admin.cleanup.run",
          security: [{ AdminBearer: [] }],
          parameters: [idempotencyKeyParameter()],
          responses: standardResponses("CleanupRunResponse"),
        },
      },
      "/admin/operation-events": {
        get: {
          operationId: "admin.operationEvents.list",
          security: [{ AdminBearer: [] }],
          responses: standardResponses("OperationEventListResponse"),
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyBearer: { type: "http", scheme: "bearer" },
        AdminBearer: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}

function pathParameter(name: string, description: string): Record<string, unknown> {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
  };
}

function idempotencyKeyParameter(): Record<string, unknown> {
  return {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: { type: "string" },
  };
}

function standardResponses(schemaName: string, successStatus = 200): Record<string, unknown> {
  return {
    [successStatus]: {
      description: schemaName,
      content: { "application/json": { schema: { type: "object" } } },
    },
    400: errorResponseDescription(),
    401: errorResponseDescription(),
    404: errorResponseDescription(),
    409: errorResponseDescription(),
    429: rateLimitResponseDescription(),
    500: errorResponseDescription(),
    503: errorResponseDescription(),
  };
}

function errorResponseDescription(): Record<string, unknown> {
  return {
    description: "Error envelope",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorEnvelope" },
      },
    },
  };
}

function rateLimitResponseDescription(): Record<string, unknown> {
  return {
    description: "Rate limit exceeded. Error codes include rate_limited_actor and rate_limited_workspace.",
    headers: {
      "Retry-After": {
        description: "Seconds to wait before retrying.",
        schema: { type: "string" },
      },
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorEnvelope" },
      },
    },
  };
}

function htmlAgentViewResponse(view: unknown): Response {
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
