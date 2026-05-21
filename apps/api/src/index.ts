import { verifyAdminToken } from "@agent-paste/auth";
import { createHyperdriveExecutor, createPostgresServices, type HyperdriveBinding } from "@agent-paste/db";

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
  createWorkspace?(input: { email: string; name?: string }): Promise<unknown>;
  listWorkspaces?(): unknown;
  createApiKey?(input: { workspaceId: string; name: string }): Promise<unknown>;
  revokeApiKey?(apiKeyId: string): unknown;
  listArtifacts?(workspaceId?: string, status?: string): unknown;
  getArtifactDetail?(artifactId: string): unknown | null;
  deleteArtifact?(artifactId: string): unknown;
  listOperationEvents?(): unknown;
  runCleanup(input: {
    actor: { type: "admin" | "system"; id: string };
    dryRun: boolean;
    batchSize: number;
    now: string;
  }): Promise<unknown>;
};

export type KVNamespace = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type Env = {
  AUTH?: AuthService;
  DB?: ApiDatabase | HyperdriveBinding;
  ADMIN_TOKEN?: string;
  ADMIN_TOKEN_HASH?: string;
  API_KEY_PEPPER_V1?: string;
  API_KEY_ENV?: "preview" | "production" | "live";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  CLEANUP_BATCH_SIZE?: string;
  DENYLIST?: KVNamespace;
};

type ScheduledEvent = {
  scheduledTime: number;
  cron: string;
};

type RouteParams = Record<string, string>;
type RouteMatch = {
  handler: (request: Request, env: Env, params: RouteParams) => Promise<Response>;
  params: RouteParams;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
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

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    return runScheduledCleanup(env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = matchRoute(request.method, url.pathname);

  if (!route) {
    return errorResponse("not_found", 404);
  }

  try {
    return await route.handler(request, env, route.params);
  } catch (error) {
    return errorResponse("internal_error", 500, error instanceof Error ? error.message : "unexpected error");
  }
}

async function whoami(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
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
  return jsonResponse(usagePolicy);
}

async function authenticatedAgentView(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
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

  const view = await db.getPublicAgentView({
    token: params.token ?? "",
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

  const db = apiDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
  }

  const body = await readJsonObject(request);
  const dryRun = body.dry_run === true;
  const batchSize = numberFromEnv(env.CLEANUP_BATCH_SIZE, 100);

  return jsonResponse(await runCleanupAndDeny(env, db, { type: "admin", id: actor.id }, dryRun, batchSize));
}

async function createWorkspace(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  const db = apiDatabase(env);
  if (!db?.createWorkspace) {
    return errorResponse("database_unavailable", 503);
  }
  if (!request.headers.get("idempotency-key")) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const body = await readJsonObject(request);
  if (typeof body.email !== "string") {
    return errorResponse("invalid_request", 400, "email is required");
  }
  const input: { email: string; name?: string } = { email: body.email };
  if (typeof body.name === "string") {
    input.name = body.name;
  }
  return jsonResponse(await db.createWorkspace(input), 201);
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
  const db = apiDatabase(env);
  if (!db?.createApiKey) {
    return errorResponse("database_unavailable", 503);
  }
  if (!request.headers.get("idempotency-key")) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const body = await readJsonObject(request);
  if (typeof body.name !== "string") {
    return errorResponse("invalid_request", 400, "name is required");
  }
  return jsonResponse(await db.createApiKey({ workspaceId: params.workspaceId ?? "", name: body.name }), 201);
}

async function revokeApiKey(request: Request, env: Env, params: RouteParams): Promise<Response> {
  const actor = await authenticateAdmin(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }
  if (!request.headers.get("idempotency-key")) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  return db?.revokeApiKey
    ? jsonResponse(await db.revokeApiKey(params.apiKeyId ?? ""))
    : errorResponse("database_unavailable", 503);
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
  if (!request.headers.get("idempotency-key")) {
    return errorResponse("invalid_idempotency_key", 400);
  }
  const db = apiDatabase(env);
  if (!db?.deleteArtifact) {
    return errorResponse("database_unavailable", 503);
  }
  const result = await db.deleteArtifact(params.artifactId ?? "");
  await denyArtifact(env, params.artifactId ?? "");
  return jsonResponse(result);
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

function matchRoute(method: string, pathname: string): RouteMatch | null {
  if (method === "GET" && pathname === "/v1/whoami") {
    return { handler: whoami, params: {} };
  }

  if (method === "GET" && pathname === "/v1/usage-policy") {
    return { handler: getUsagePolicy, params: {} };
  }

  let match = pathname.match(/^\/v1\/public\/agent-view\/([^/]+)$/);
  if (method === "GET" && match?.[1]) {
    return { handler: publicAgentView, params: { token: decodeURIComponent(match[1]) } };
  }

  match = pathname.match(/^\/v1\/artifacts\/([^/]+)\/agent-view$/);
  if (method === "GET" && match?.[1]) {
    return { handler: authenticatedAgentView, params: { artifactId: decodeURIComponent(match[1]) } };
  }

  match = pathname.match(/^\/v1\/artifacts\/([^/]+)\/revisions\/([^/]+)\/agent-view$/);
  if (method === "GET" && match?.[1] && match[2]) {
    return {
      handler: authenticatedAgentView,
      params: { artifactId: decodeURIComponent(match[1]), revisionId: decodeURIComponent(match[2]) },
    };
  }

  if (method === "GET" && pathname === "/admin/whoami") {
    return { handler: adminWhoami, params: {} };
  }

  if (method === "POST" && pathname === "/admin/workspaces") {
    return { handler: createWorkspace, params: {} };
  }

  if (method === "GET" && pathname === "/admin/workspaces") {
    return { handler: listWorkspaces, params: {} };
  }

  match = pathname.match(/^\/admin\/workspaces\/([^/]+)\/api-keys$/);
  if (method === "POST" && match?.[1]) {
    return { handler: createApiKey, params: { workspaceId: decodeURIComponent(match[1]) } };
  }

  match = pathname.match(/^\/admin\/api-keys\/([^/]+)$/);
  if (method === "DELETE" && match?.[1]) {
    return { handler: revokeApiKey, params: { apiKeyId: decodeURIComponent(match[1]) } };
  }

  if (method === "GET" && pathname === "/admin/artifacts") {
    return { handler: listArtifacts, params: {} };
  }

  match = pathname.match(/^\/admin\/artifacts\/([^/]+)$/);
  if (method === "GET" && match?.[1]) {
    return { handler: inspectArtifact, params: { artifactId: decodeURIComponent(match[1]) } };
  }

  if (method === "DELETE" && match?.[1]) {
    return { handler: deleteArtifact, params: { artifactId: decodeURIComponent(match[1]) } };
  }

  if (method === "POST" && pathname === "/admin/cleanup/run") {
    return { handler: cleanup, params: {} };
  }

  if (method === "GET" && pathname === "/admin/operation-events") {
    return { handler: listOperationEvents, params: {} };
  }

  return null;
}

async function authenticateApiKey(request: Request, env: Env): Promise<ApiActor | null> {
  const token = bearerToken(request);
  const auth = authService(env);
  if (!token || !auth) {
    return null;
  }

  return auth.verifyApiKey(token);
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
): Promise<unknown> {
  const result = await db.runCleanup({
    actor,
    dryRun,
    batchSize,
    now: new Date().toISOString(),
  });
  if (!dryRun && result && typeof result === "object" && "expired_artifact_ids" in result) {
    const ids = (result as { expired_artifact_ids?: unknown }).expired_artifact_ids;
    if (Array.isArray(ids)) {
      await Promise.all(ids.flatMap((id) => (typeof id === "string" ? [denyArtifact(env, id)] : [])));
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

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function errorResponse(code: string, status: number, message?: string): Response {
  return jsonResponse({ error: { code, message: message ?? code } }, status);
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
      "content-type": "text/html; charset=utf-8",
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
