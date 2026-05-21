import { createHyperdriveExecutor, createPostgresServices, type HyperdriveBinding } from "@agent-paste/db";

export type UploadActor = {
  type: "api_key";
  id: string;
  workspace_id?: string;
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

export type UploadDatabase = {
  createUploadSession(input: {
    actor: UploadActor;
    idempotencyKey: string;
    request: { title?: string; ttl_seconds?: number; entrypoint?: string; files: UploadFileInput[] };
    now: string;
  }): Promise<UploadSessionRecord>;
  recordUploadedFile?(input: {
    sessionId: string;
    path: string;
    objectKey: string;
    sizeBytes: number;
    uploadedAt: string;
  }): Promise<void>;
  getUploadSession(input: { actor: UploadActor; sessionId: string }): Promise<UploadSessionRecord | null>;
  finalizeUploadSession(input: {
    actor: UploadActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: Array<{ path: string; objectKey: string; sizeBytes: number }>;
    now: string;
  }): Promise<unknown>;
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

export type Env = {
  AUTH?: AuthService;
  DB?: UploadDatabase | HyperdriveBinding;
  ARTIFACTS?: R2Bucket;
  API_KEY_PEPPER_V1?: string;
  API_KEY_ENV?: "preview" | "live";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET?: string;
  UPLOAD_BASE_URL?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
};

type SignedUploadPayload = {
  sid: string;
  path: string;
  key: string;
  size: number;
  exp: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const MIN_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 90 * 24 * 60 * 60;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (request.method === "POST" && url.pathname === "/v1/upload-sessions") {
      return createUploadSession(request, env);
    }

    const putMatch = url.pathname.match(/^\/v1\/upload-sessions\/([^/]+)\/files\/(.+)$/);
    if (request.method === "PUT" && putMatch?.[1] && putMatch[2]) {
      return putUploadFile(request, env, decodeURIComponent(putMatch[1]), decodeURIComponent(putMatch[2]));
    }

    const finalizeMatch = url.pathname.match(/^\/v1\/upload-sessions\/([^/]+)\/finalize$/);
    if (request.method === "POST" && finalizeMatch?.[1]) {
      return finalizeUploadSession(request, env, decodeURIComponent(finalizeMatch[1]));
    }

    return errorResponse("not_found", 404);
  } catch (error) {
    return errorResponse("internal_error", 500, error instanceof Error ? error.message : "unexpected error");
  }
}

async function createUploadSession(request: Request, env: Env): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }

  const db = uploadDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
  }

  const body = await readJsonObject(request);
  const files = parseFiles(body.files);
  if (files.length === 0) {
    return errorResponse("invalid_request", 400, "files must contain at least one file");
  }

  const createRequest: { title?: string; ttl_seconds?: number; entrypoint?: string; files: UploadFileInput[] } = {
    files,
  };
  if (typeof body.title === "string") {
    createRequest.title = body.title;
  }
  if (body.ttl_seconds !== undefined && !isValidArtifactTtl(body.ttl_seconds)) {
    return errorResponse("invalid_request", 400, "ttl_seconds must be an integer from 86400 to 7776000");
  }
  if (typeof body.ttl_seconds === "number") {
    createRequest.ttl_seconds = body.ttl_seconds;
  }
  if (typeof body.entrypoint === "string") {
    createRequest.entrypoint = body.entrypoint;
  }

  const session = await db.createUploadSession({
    actor,
    idempotencyKey,
    request: createRequest,
    now: new Date().toISOString(),
  });

  const signedFiles = await Promise.all(
    session.files.map(async (file) => ({
      path: file.path,
      put_url: file.put_url ?? (await signUploadUrl(request, env, session, file)),
      required_headers: { "content-length": String(file.size_bytes) },
      expires_at: file.expires_at ?? session.expires_at,
    })),
  );

  return jsonResponse({
    upload_session_id: session.session_id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    status: "pending",
    expires_at: session.expires_at,
    files: signedFiles,
  });
}

async function putUploadFile(request: Request, env: Env, sessionId: string, path: string): Promise<Response> {
  if (!env.ARTIFACTS) {
    return errorResponse("storage_unavailable", 503);
  }

  const payload = await verifyUploadToken(new URL(request.url).searchParams.get("token"), env);
  if (!payload || payload.sid !== sessionId || payload.path !== path) {
    return errorResponse("not_authenticated", 401);
  }

  if (!request.body) {
    return errorResponse("invalid_request", 400, "request body is required");
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(contentLength) || contentLength !== payload.size) {
    return errorResponse("invalid_request", 400, "content-length does not match signed upload");
  }

  await env.ARTIFACTS.put(payload.key, request.body, {
    httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
  });

  await uploadDatabase(env)?.recordUploadedFile?.({
    sessionId,
    path,
    objectKey: payload.key,
    sizeBytes: payload.size,
    uploadedAt: new Date().toISOString(),
  });

  return new Response(null, { status: 204 });
}

async function finalizeUploadSession(request: Request, env: Env, sessionId: string): Promise<Response> {
  const actor = await authenticateApiKey(request, env);
  if (!actor) {
    return errorResponse("not_authenticated", 401);
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("invalid_idempotency_key", 400);
  }

  const db = uploadDatabase(env);
  if (!db) {
    return errorResponse("database_unavailable", 503);
  }

  if (!env.ARTIFACTS) {
    return errorResponse("storage_unavailable", 503);
  }

  const session = await db.getUploadSession({ actor, sessionId });
  if (!session) {
    return errorResponse("not_found", 404);
  }

  const observedFiles = [];
  for (const file of session.files) {
    const objectKey = objectKeyFor(session, file.path, file.object_key);
    const object = await env.ARTIFACTS.head(objectKey);
    if (!object || object.size !== file.size_bytes) {
      return errorResponse("upload_incomplete", 409, file.path);
    }

    observedFiles.push({ path: file.path, objectKey, sizeBytes: object.size });
  }

  const result = await db.finalizeUploadSession({
    actor,
    idempotencyKey,
    sessionId,
    observedFiles,
    now: new Date().toISOString(),
  });

  return jsonResponse(await signPublishContentUrl(result, env));
}

async function authenticateApiKey(request: Request, env: Env): Promise<UploadActor | null> {
  const token = bearerToken(request);
  const auth = authService(env);
  if (!token || !auth) {
    return null;
  }

  return auth.verifyApiKey(token);
}

function authService(env: Env): AuthService | undefined {
  if (env.AUTH) {
    return env.AUTH;
  }
  return postgresRuntime(env)?.auth;
}

function uploadDatabase(env: Env): UploadDatabase | undefined {
  if (isUploadDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

function postgresRuntime(env: Env): { auth: AuthService; db: UploadDatabase } | undefined {
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

function isUploadDatabase(value: Env["DB"]): value is UploadDatabase {
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

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds(env);
  const payload: SignedUploadPayload = {
    sid: session.session_id,
    path: file.path,
    key: objectKeyFor(session, file.path, file.object_key),
    size: file.size_bytes,
    exp,
  };
  const token = await signPayload(payload, env.UPLOAD_SIGNING_SECRET);
  const baseUrl = env.UPLOAD_BASE_URL ?? new URL(request.url).origin;
  return `${baseUrl}/v1/upload-sessions/${encodeURIComponent(session.session_id)}/files/${encodePath(file.path)}?token=${encodeURIComponent(token)}`;
}

async function verifyUploadToken(token: string | null, env: Env): Promise<SignedUploadPayload | null> {
  if (!token || !env.UPLOAD_SIGNING_SECRET) {
    return null;
  }

  const payload = await verifyPayload<SignedUploadPayload>(token, env.UPLOAD_SIGNING_SECRET);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
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

async function signPublishContentUrl(result: unknown, env: Env): Promise<unknown> {
  if (!env.CONTENT_SIGNING_SECRET || !result || typeof result !== "object") {
    return result;
  }
  const data = result as { artifact_id?: unknown; revision_id?: unknown; view_url?: unknown; expires_at?: unknown };
  if (
    typeof data.artifact_id !== "string" ||
    typeof data.revision_id !== "string" ||
    typeof data.view_url !== "string"
  ) {
    return result;
  }
  const path = pathFromViewUrl(data.view_url, data.artifact_id, data.revision_id);
  return {
    ...data,
    view_url: await signedContentUrl(
      env,
      data.artifact_id,
      data.revision_id,
      path,
      typeof data.expires_at === "string" ? data.expires_at : undefined,
    ),
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
    return `${env.CONTENT_BASE_URL ?? "https://usercontent.agent-paste.sh"}/v/${artifactId}.${revisionId}/${encodePath(path)}`;
  }
  const token = await signPayload(
    {
      artifact_id: artifactId,
      revision_id: revisionId,
      paths: [path],
      exp: contentTokenExpiration(expiresAt),
    },
    env.CONTENT_SIGNING_SECRET,
  );
  return `${env.CONTENT_BASE_URL ?? "https://usercontent.agent-paste.sh"}/v/${encodeURIComponent(token)}/${encodePath(path)}`;
}

function contentTokenExpiration(expiresAt: string | undefined): number {
  const parsed = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

function pathFromViewUrl(viewUrl: string, artifactId: string, revisionId: string): string {
  const marker = `/v/${artifactId}.${revisionId}/`;
  const index = viewUrl.indexOf(marker);
  if (index === -1) {
    return "index.html";
  }
  return decodeURIComponent(viewUrl.slice(index + marker.length));
}

async function signPayload(payload: object, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifyPayload<T>(token: string, secret: string): Promise<T | null> {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = await hmac(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  return JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as T;
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

function constantTimeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function errorResponse(code: string, status: number, message?: string): Response {
  return jsonResponse({ error: { code, message: message ?? code } }, status);
}
