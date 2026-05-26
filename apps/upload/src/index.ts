import {
  buildErrorBody,
  cachedLookup,
  cacheKeyForSecret,
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestIdVariables,
  requestIdMiddleware,
} from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import {
  buildUploadOpenApiDocument,
  FinalizeUploadSessionResponse,
  type RouteContract,
  routeContracts,
} from "@agent-paste/contracts";
import {
  createHyperdriveExecutor,
  createPostgresServices,
  type HyperdriveBinding,
  type Repository,
} from "@agent-paste/db";
import {
  mintUploadUrl,
  type SignedUploadPayload,
  verifyUploadToken as verifyUploadTokenSignature,
} from "@agent-paste/tokens/upload-url";
import { createRegistrar, type GuardState, type Principal } from "@agent-paste/worker-runtime";
import { type Context, Hono } from "hono";

export type UploadActor = {
  type: "api_key";
  id: string;
  workspace_id: string;
};

export type AuthService = {
  verifyApiKey(apiKey: string): Promise<UploadActor | null>;
};

export type UploadFileInput = {
  path: string;
  size_bytes: number;
  sha256?: string;
};

export type UploadSessionRecord = {
  session_id: string;
  artifact_id: string;
  revision_id: string;
  expires_at: string;
  files: Array<UploadFileInput & { object_key?: string; put_url?: string; expires_at?: string }>;
};

export type R2Object = {
  size: number;
};

export type R2Bucket = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: { httpMetadata?: Record<string, string> },
  ): Promise<unknown>;
  head(key: string): Promise<R2Object | null>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  AUTH?: AuthService;
  DB?: Repository | HyperdriveBinding;
  ARTIFACTS?: R2Bucket;
  API_KEY_PEPPER_V1?: string;
  API_KEY_ENV?: "preview" | "production";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  AGENT_VIEW_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET?: string;
  UPLOAD_BASE_URL?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  ACTOR_RATE_LIMIT?: RateLimitBinding;
  WORKSPACE_BURST_CAP?: RateLimitBinding;
  DOCS_BASE_URL?: string;
};

type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables }>;

const jsonHeaders = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const MIN_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUTH_CACHE_TTL_SECONDS = 60;
const DEFAULT_API_BASE_URL = "https://api.agent-paste.sh";
const UPLOAD_FILE_PATH_MARKER = "/files/";
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = ["/healthz", "/openapi.json"] as const;

app.use("*", requestIdMiddleware());
app.get("/healthz", (c) => c.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(buildUploadOpenApiDocument({ serverUrl: context.env.UPLOAD_BASE_URL })),
);
const uploadDbRegistrar = createRegistrar<Repository>({
  app,
  auth: {
    async api_key(context) {
      const actor = await authenticateApiKey(context.req.raw, context.env as Env);
      return actor ? { ok: true, principal: { kind: "api_key", actor } } : { ok: false, code: "not_authenticated" };
    },
  },
  db: (context) => uploadDatabase(context.env as Env),
  rateLimitBindings: (context) => ({
    actor: (context.env as Env).ACTOR_RATE_LIMIT,
    workspace: (context.env as Env).WORKSPACE_BURST_CAP,
  }),
  docsBaseUrl: (context) => (context.env as Env).DOCS_BASE_URL,
  replay: uploadReplay,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
const uploadNoDbRegistrar = createRegistrar({
  app,
  auth: {
    async signed_upload_url(context) {
      const payload = await verifyUploadToken(
        new URL(context.req.raw.url).searchParams.get("token"),
        context.env as Env,
      );
      const sessionId = context.req.param("upload_session_id");
      const path = uploadFilePath(context as AppContext);
      if (!payload || payload.sid !== sessionId || payload.path !== path) {
        return { ok: false, code: "not_authenticated" };
      }
      return { ok: true, principal: { kind: "signed_upload_url", payload } };
    },
  },
  docsBaseUrl: (context) => (context.env as Env).DOCS_BASE_URL,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
uploadDbRegistrar.mount(contractById("uploadSessions.create"), async (context, principal, db, guard) =>
  createUploadSession(context as AppContext, principal, db, guard),
);
uploadNoDbRegistrar.mount(contractById("uploadSessions.putFile"), async (context, principal) =>
  putUploadFile(context as AppContext, principal),
);
uploadDbRegistrar.mount(contractById("uploadSessions.finalize"), async (context, principal, db, guard) =>
  finalizeUploadSession(context as AppContext, principal, db, guard),
);
app.notFound((context) => errorResponse(context, "not_found", 404));
app.onError((error, context) => {
  console.error("Unhandled upload error:", error);
  return errorResponse(context, "internal_error", 500);
});

function uploadFilePath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  const markerIndex = pathname.indexOf(UPLOAD_FILE_PATH_MARKER);
  return markerIndex === -1 ? "" : decodeURIComponent(pathname.slice(markerIndex + UPLOAD_FILE_PATH_MARKER.length));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}

async function createUploadSession(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated", 401);
  }
  const actor = principal.actor as UploadActor;
  const idempotencyKey = guard.idempotencyKey ?? "";

  const body = await readJsonObject(request);
  const files = parseFiles(body.files);
  if (files.length === 0) {
    return errorResponse(context, "invalid_request", 400, "files must contain at least one file");
  }

  const createRequest: {
    artifact_id?: string;
    title?: string;
    ttl_seconds?: number;
    entrypoint?: string;
    files: UploadFileInput[];
  } = {
    files,
  };
  if (typeof body.title === "string") {
    createRequest.title = body.title;
  }
  if (body.ttl_seconds !== undefined && !isValidArtifactTtl(body.ttl_seconds)) {
    return errorResponse(context, "invalid_request", 400, "ttl_seconds must be an integer from 86400 to 7776000");
  }
  if (typeof body.ttl_seconds === "number") {
    createRequest.ttl_seconds = body.ttl_seconds;
  }
  if (typeof body.entrypoint === "string") {
    createRequest.entrypoint = body.entrypoint;
  }
  if (typeof body.artifact_id === "string") {
    createRequest.artifact_id = body.artifact_id;
  }

  let session: UploadSessionRecord;
  try {
    session = await db.createUploadSession({
      actor,
      idempotencyKey,
      request: createRequest,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return errorResponse(context, "idempotency_in_flight", 409);
    }
    const mapped = mapRepositoryError(error);
    if (mapped) {
      return errorResponse(context, mapped.code, mapped.status, mapped.message);
    }
    throw error;
  }

  return jsonResponse(context, await buildCreateSessionResponse(request, env, session));
}

async function buildCreateSessionResponse(
  request: Request,
  env: Env,
  session: UploadSessionRecord,
): Promise<Record<string, unknown>> {
  const signedFiles = await Promise.all(
    session.files.map(async (file) => ({
      path: file.path,
      put_url: file.put_url ?? (await signUploadUrl(request, env, session, file)),
      required_headers: { "content-length": String(file.size_bytes) },
      expires_at: file.expires_at ?? session.expires_at,
    })),
  );

  return {
    upload_session_id: session.session_id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    status: "pending",
    expires_at: session.expires_at,
    files: signedFiles,
  };
}

async function putUploadFile(context: AppContext, principal: Principal): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!env.ARTIFACTS) {
    return errorResponse(context, "storage_unavailable", 503);
  }

  if (principal.kind !== "signed_upload_url") {
    return errorResponse(context, "not_authenticated", 401);
  }
  const payload = principal.payload as SignedUploadPayload;

  if (!request.body) {
    return errorResponse(context, "invalid_request", 400, "request body is required");
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(contentLength) || contentLength !== payload.size) {
    return errorResponse(context, "invalid_request", 400, "content-length does not match signed upload");
  }

  await env.ARTIFACTS.put(payload.key, request.body, {
    httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
  });

  await uploadDatabase(env)?.recordUploadedFile({
    sessionId: payload.sid,
    path: payload.path,
    objectKey: payload.key,
    sizeBytes: payload.size,
    uploadedAt: new Date().toISOString(),
  });

  return new Response(null, { status: 204, headers: { [REQUEST_ID_HEADER]: getRequestId(context) } });
}

async function finalizeUploadSession(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardState,
): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated", 401);
  }
  const actor = principal.actor as UploadActor;
  const idempotencyKey = guard.idempotencyKey ?? "";
  const sessionId = context.req.param("upload_session_id") ?? "";

  if (!env.ARTIFACTS) {
    return errorResponse(context, "storage_unavailable", 503);
  }

  const session = await db.getUploadSession({ actor, sessionId });
  if (!session) {
    return errorResponse(context, "not_found", 404);
  }

  const observedFiles = [];
  for (const file of session.files) {
    const objectKey = objectKeyFor(session, file.path, file.object_key);
    const object = await env.ARTIFACTS.head(objectKey);
    if (!object || object.size !== file.size_bytes) {
      return errorResponse(context, "upload_incomplete", 409, file.path);
    }

    observedFiles.push({ path: file.path, objectKey, sizeBytes: object.size });
  }

  let result: unknown;
  try {
    result = await db.finalizeUploadSession({
      actor,
      idempotencyKey,
      sessionId,
      observedFiles,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return errorResponse(context, "idempotency_in_flight", 409);
    }
    const mapped = mapRepositoryError(error);
    if (mapped) {
      return errorResponse(context, mapped.code, mapped.status, mapped.message);
    }
    throw error;
  }

  return jsonResponse(context, FinalizeUploadSessionResponse.parse(result));
}

async function authenticateApiKey(request: Request, env: Env): Promise<UploadActor | null> {
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
    namespace: "upload-api-key-auth",
    key: await cacheKeyForSecret(token),
    ttlSeconds: AUTH_CACHE_TTL_SECONDS,
    lookup: () => runtime.auth.verifyApiKey(token),
  });
}

function uploadDatabase(env: Env): Repository | undefined {
  if (isUploadDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

async function peekUploadReplay<T>(
  db: Repository,
  actor: UploadActor,
  operation: string,
  idempotencyKey: string,
): Promise<T | null> {
  const hit = await db.peekIdempotentReplay({ actor, operation, idempotencyKey });
  return hit ? (hit.result as T) : null;
}

async function uploadReplay(input: {
  context: Context;
  contract: RouteContract;
  principal: Principal;
  db: Repository;
  guard: GuardState;
}): Promise<Response | null> {
  if (input.principal.kind !== "api_key" || !input.guard.idempotencyKey) {
    return null;
  }
  const context = input.context as AppContext;
  const actor = input.principal.actor as UploadActor;
  if (input.contract.id === "uploadSessions.create") {
    const replay = await peekUploadReplay<UploadSessionRecord>(
      input.db,
      actor,
      "upload.session.create",
      input.guard.idempotencyKey,
    );
    return replay
      ? jsonResponse(context, await buildCreateSessionResponse(context.req.raw, context.env, replay))
      : null;
  }
  if (input.contract.id === "uploadSessions.finalize") {
    const replay = await peekUploadReplay<unknown>(
      input.db,
      actor,
      "upload.session.finalize",
      input.guard.idempotencyKey,
    );
    return replay ? jsonResponse(context, FinalizeUploadSessionResponse.parse(replay)) : null;
  }
  return null;
}

function postgresRuntime(env: Env): { auth: AuthService; db: Repository } | undefined {
  if (!isHyperdriveBinding(env.DB) || !env.API_KEY_PEPPER_V1) {
    return undefined;
  }
  const options: Parameters<typeof createPostgresServices>[0] = {
    executor: createHyperdriveExecutor(env.DB),
    apiKeyPepper: env.API_KEY_PEPPER_V1,
    apiKeyEnv: env.API_KEY_ENV ?? "preview",
  };
  if (env.API_BASE_URL) {
    options.apiBaseUrl = env.API_BASE_URL;
  }
  if (env.CONTENT_BASE_URL) {
    options.contentBaseUrl = env.CONTENT_BASE_URL;
  }
  const services = createPostgresServices(options);
  return { auth: services.auth, db: services.uploadDb };
}

function isUploadDatabase(value: Env["DB"]): value is Repository {
  return typeof value === "object" && value !== null && "createUploadSession" in value;
}

function isHyperdriveBinding(value: Env["DB"]): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}

async function signUploadUrl(
  request: Request,
  env: Env,
  session: UploadSessionRecord,
  file: UploadFileInput & { object_key?: string },
): Promise<string> {
  if (!env.UPLOAD_SIGNING_SECRET) {
    throw new Error("UPLOAD_SIGNING_SECRET is required");
  }

  return mintUploadUrl({
    baseUrl: env.UPLOAD_BASE_URL ?? new URL(request.url).origin,
    secret: env.UPLOAD_SIGNING_SECRET,
    payload: {
      sid: session.session_id,
      path: file.path,
      key: objectKeyFor(session, file.path, file.object_key),
      size: file.size_bytes,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds(env),
    },
  });
}

async function verifyUploadToken(token: string | null, env: Env): Promise<SignedUploadPayload | null> {
  if (!token || !env.UPLOAD_SIGNING_SECRET) {
    return null;
  }

  return verifyUploadTokenSignature(token, env.UPLOAD_SIGNING_SECRET);
}

function objectKeyFor(session: UploadSessionRecord, path: string, explicitKey?: string): string {
  return explicitKey ?? `artifacts/${session.artifact_id}/revisions/${session.revision_id}/files/${path}`;
}

function parseFiles(value: unknown): UploadFileInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((file) => {
    if (!file || typeof file !== "object") {
      return [];
    }

    const candidate = file as Record<string, unknown>;
    if (typeof candidate.path !== "string" || !isValidUploadPath(candidate.path)) {
      return [];
    }

    if (
      typeof candidate.size_bytes !== "number" ||
      !Number.isInteger(candidate.size_bytes) ||
      candidate.size_bytes < 0
    ) {
      return [];
    }

    const parsed: UploadFileInput = { path: candidate.path, size_bytes: candidate.size_bytes };
    if (typeof candidate.sha256 === "string") {
      parsed.sha256 = candidate.sha256;
    }

    return [parsed];
  });
}

function isValidUploadPath(path: string): boolean {
  const segments = path.split("/");
  return path.length > 0 && !path.startsWith("/") && !segments.includes("..") && !segments.includes("");
}

function isValidArtifactTtl(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_TTL_SECONDS && value <= MAX_TTL_SECONDS;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapRepositoryError(error: unknown): { code: string; status: number; message?: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }
  switch (error.message) {
    case "artifact_not_found":
      return { code: "artifact_not_found", status: 404 };
    case "draft_revision_conflict":
      return { code: "draft_revision_conflict", status: 409 };
    case "upload_session_not_found":
      return { code: "upload_session_not_found", status: 404 };
    case "upload_incomplete":
      return { code: "upload_incomplete", status: 409 };
    case "entrypoint_not_in_revision":
      return { code: "entrypoint_not_in_revision", status: 422 };
    default:
      return null;
  }
}

function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
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
    message: message ?? code,
    requestId: getRequestId(context),
    docsBaseUrl: context.env.DOCS_BASE_URL,
  });
  return jsonResponse(context, body, status, extraHeaders);
}

function contractById(id: (typeof routeContracts)[number]["id"]): (typeof routeContracts)[number] {
  const contract = routeContracts.find((route) => route.id === id);
  if (!contract) {
    throw new Error(`Missing route contract ${id}`);
  }
  return contract;
}
