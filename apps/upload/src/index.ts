import {
  cachedNegativeLookup,
  cacheKeyForSecret,
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestIdVariables,
  requestIdMiddleware,
} from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import {
  buildUploadOpenApiDocument,
  type CreateUploadSessionRequest,
  FinalizeUploadSessionResponse,
  type RouteContract,
  routeContracts,
} from "@agent-paste/contracts";
import {
  buildCreateUploadSessionWireResponse,
  createHyperdriveExecutor,
  createPostgresServices,
  type HyperdriveBinding,
  observeUploadSessionForFinalize,
  type Repository,
  resolveSessionObjectKey,
  type UploadSessionRecord,
} from "@agent-paste/db";
import { pepperRingFromWorkerEnv, uploadSigningRingFromEnv, verifyUploadTokenWithKeyRing } from "@agent-paste/rotation";
import {
  mintUploadUrl,
  type SignedUploadPayload,
  verifyUploadToken as verifyUploadTokenSignature,
} from "@agent-paste/tokens/upload-url";
import {
  type AppErrorCode,
  createRegistrar,
  type GuardState,
  type HeaderGuardState,
  type Principal,
  errorResponse as runtimeErrorResponse,
  jsonResponse as runtimeJsonResponse,
  type SignedUploadUrlPrincipal,
  sentryOptions,
} from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { type Context, Hono } from "hono";
import { authenticateMcpBearer, resolveMcpMemberActor } from "./mcp-auth.js";

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

export type { UploadSessionRecord };

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
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
  API_KEY_ENV?: "preview" | "production";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  AGENT_VIEW_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET_V2?: string;
  UPLOAD_SIGNING_KID?: string;
  UPLOAD_BASE_URL?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  ACTOR_RATE_LIMIT?: RateLimitBinding;
  WORKSPACE_BURST_CAP?: RateLimitBinding;
  DOCS_BASE_URL?: string;
  AGENT_PASTE_ENV?: string;
  SENTRY_DSN?: string;
  WORKOS_API_KEY?: string;
  WORKOS_API_BASE_URL?: string;
  WORKOS_MCP_AUDIENCE?: string;
  WORKOS_MCP_ISSUER?: string;
  WORKOS_MCP_JWKS_URL?: string;
  WORKOS_CLI_ISSUER?: string;
  WORKOS_CLI_JWKS_URL?: string;
};

type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables }>;
type RouteId = (typeof routeContracts)[number]["id"];
type ContractById<Id extends RouteId> = Extract<(typeof routeContracts)[number], { id: Id }>;
type GuardFor<Id extends RouteId> = GuardState<ContractById<Id>>;

const AUTH_CACHE_TTL_SECONDS = 60;
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
    async api_key_or_mcp_oauth(context) {
      const env = context.env as Env;
      const apiKeyActor = await authenticateApiKey(context.req.raw, env);
      if (apiKeyActor) {
        return { ok: true, principal: { kind: "api_key", actor: apiKeyActor } };
      }
      const authenticated = await authenticateMcpBearer(context.req.raw, env);
      if (!authenticated) {
        return { ok: false, code: "not_authenticated" } as const;
      }
      const db = uploadDatabase(env);
      if (!db) {
        return { ok: false, code: "database_unavailable" } as const;
      }
      const actor = await resolveMcpMemberActor(authenticated, db);
      if (!actor) {
        return { ok: false, code: "forbidden" } as const;
      }
      return {
        ok: true,
        principal: {
          kind: "workos_access_token",
          identity: { ...authenticated.identity, mcp_scopes: authenticated.mcpScopes },
          actor,
        },
      } as const;
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
  putUploadFile(context as AppContext, principal as SignedUploadUrlPrincipal<SignedUploadPayload>),
);
uploadDbRegistrar.mount(contractById("uploadSessions.finalize"), async (context, principal, db, guard) =>
  finalizeUploadSession(context as AppContext, principal, db, guard),
);
app.notFound((context) => errorResponse(context, "not_found"));
app.onError((error, context) => {
  console.error("Unhandled upload error:", error);
  return errorResponse(context, "internal_error");
});

function uploadFilePath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  const markerIndex = pathname.indexOf(UPLOAD_FILE_PATH_MARKER);
  return markerIndex === -1 ? "" : decodeURIComponent(pathname.slice(markerIndex + UPLOAD_FILE_PATH_MARKER.length));
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}

function uploadSessionActor(principal: Principal): UploadActor | null {
  if (principal.kind === "api_key") {
    const actor = principal.actor;
    if (actor.type !== "api_key" || !actor.workspace_id) {
      return null;
    }
    return {
      type: "api_key",
      id: actor.id,
      workspace_id: actor.workspace_id,
    };
  }
  if (principal.kind === "workos_access_token" && principal.actor?.type === "member") {
    const actor = principal.actor;
    if (!actor.workspace_id) {
      return null;
    }
    return {
      type: "api_key",
      id: actor.id,
      workspace_id: actor.workspace_id,
    };
  }
  return null;
}

async function createUploadSession(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"uploadSessions.create">,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const actor = uploadSessionActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const idempotencyKey = guard.idempotencyKey ?? "";
  const body: CreateUploadSessionRequest = guard.body;
  const createRequest = {
    title: body.title,
    ttl_seconds: body.ttl_seconds,
    entrypoint: body.entrypoint,
    files: body.files,
    ...(body.artifact_id === undefined ? {} : { artifact_id: body.artifact_id }),
  };

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
      return errorResponse(context, "idempotency_in_flight");
    }
    const mapped = mapRepositoryError(error);
    if (mapped) {
      return errorResponse(context, mapped.code, mapped.message);
    }
    throw error;
  }

  return jsonResponse(
    context,
    await buildCreateUploadSessionWireResponse(session, {
      signPutUrl: (uploadSession, file) => signUploadUrl(request, env, uploadSession, file),
    }),
  );
}

async function putUploadFile(
  context: AppContext,
  principal: SignedUploadUrlPrincipal<SignedUploadPayload>,
): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  if (!env.ARTIFACTS) {
    return errorResponse(context, "storage_unavailable");
  }
  const payload = principal.payload;

  if (!request.body) {
    return errorResponse(context, "invalid_request", "request body is required");
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(contentLength) || contentLength !== payload.size) {
    return errorResponse(context, "invalid_request", "content-length does not match signed upload");
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
  const actor = uploadSessionActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const idempotencyKey = guard.idempotencyKey ?? "";
  const sessionId = context.req.param("upload_session_id") ?? "";

  if (!env.ARTIFACTS) {
    return errorResponse(context, "storage_unavailable");
  }

  const session = await db.getUploadSession({ actor, sessionId });
  if (!session) {
    return errorResponse(context, "not_found");
  }

  const observation = await observeUploadSessionForFinalize(session, env.ARTIFACTS);
  if ("incompletePath" in observation) {
    return errorResponse(context, "upload_incomplete", observation.incompletePath);
  }
  const { observedFiles } = observation;

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
      return errorResponse(context, "idempotency_in_flight");
    }
    const mapped = mapRepositoryError(error);
    if (mapped) {
      return errorResponse(context, mapped.code, mapped.message);
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

  return validApiKeyActor(
    (await cachedNegativeLookup({
      namespace: "upload-api-key-auth-v2",
      key: await cacheKeyForSecret(token),
      ttlSeconds: AUTH_CACHE_TTL_SECONDS,
      lookup: () => runtime.auth.verifyApiKey(token),
    })) ?? null,
  );
}

function validApiKeyActor(actor: (UploadActor & { expires_at?: string | null }) | null): UploadActor | null {
  if (!actor?.expires_at) {
    return actor;
  }
  return Date.parse(actor.expires_at) <= Date.now() ? null : actor;
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
  return hit && "result" in hit ? (hit.result as T) : null;
}

async function uploadReplay(input: {
  context: Context;
  contract: RouteContract;
  principal: Principal;
  db: Repository;
  guard: HeaderGuardState;
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
      ? jsonResponse(
          context,
          await buildCreateUploadSessionWireResponse(replay, {
            signPutUrl: (uploadSession, file) =>
              signUploadUrl(context.req.raw, context.env as Env, uploadSession, file),
          }),
        )
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
  const pepperRing = pepperRingFromWorkerEnv(env);
  const options: Parameters<typeof createPostgresServices>[0] = {
    executor: createHyperdriveExecutor(env.DB),
    apiKeyPepper: env.API_KEY_PEPPER_V1,
    ...(pepperRing ? { pepperRing } : {}),
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

  const signingRing = uploadSigningRingFromEnv(env);
  return mintUploadUrl({
    baseUrl: env.UPLOAD_BASE_URL ?? new URL(request.url).origin,
    secret: signingRing?.signingSecret() ?? env.UPLOAD_SIGNING_SECRET,
    payload: {
      sid: session.session_id,
      path: file.path,
      key: resolveSessionObjectKey(session, file.path, file.object_key),
      size: file.size_bytes,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds(env),
    },
  });
}

async function verifyUploadToken(token: string | null, env: Env): Promise<SignedUploadPayload | null> {
  if (!token || !env.UPLOAD_SIGNING_SECRET) {
    return null;
  }

  const signingRing = uploadSigningRingFromEnv(env);
  if (signingRing) {
    return verifyUploadTokenWithKeyRing(token, signingRing);
  }
  return verifyUploadTokenSignature(token, env.UPLOAD_SIGNING_SECRET);
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function mapRepositoryError(error: unknown): { code: AppErrorCode; message?: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }
  switch (error.message) {
    case "artifact_not_found":
      return { code: "artifact_not_found" };
    case "draft_revision_conflict":
      return { code: "draft_revision_conflict" };
    case "upload_session_not_found":
      return { code: "upload_session_not_found" };
    case "upload_incomplete":
      return { code: "upload_incomplete" };
    case "entrypoint_not_in_revision":
      return { code: "entrypoint_not_in_revision" };
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

function contractById<Id extends RouteId>(id: Id): ContractById<Id> {
  const contract = routeContracts.find((route) => route.id === id);
  if (!contract) {
    throw new Error(`Missing route contract ${id}`);
  }
  return contract as ContractById<Id>;
}
