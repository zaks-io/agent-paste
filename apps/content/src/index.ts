import { getRequestId, REQUEST_ID_HEADER, type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { buildContentOpenApiDocument, routeContracts } from "@agent-paste/contracts";
import {
  artifactBytesEncryptionRingFromEnv,
  contentSigningRingFromEnv,
  verifyContentTokenWithKeyRing,
} from "@agent-paste/rotation";
import {
  attachmentFilename,
  bytesFromReadableBody,
  CONTENT_SECURITY_HEADERS,
  decryptArtifactBytesWithKeyRing,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  plaintextByteLengthFromStoredObject,
  servedContentForPath,
} from "@agent-paste/storage";
import { type ContentTokenPayload, mintContentToken, verifyContentToken } from "@agent-paste/tokens/content";
import {
  type AppErrorCode,
  createRegistrar,
  errorResponse as runtimeErrorResponse,
  type SignedContentTokenPrincipal,
  sentryOptions,
} from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { type Context, Hono } from "hono";

export type { ContentTokenPayload };
export { mintContentToken as signContentToken };

export type R2ObjectBody = {
  body: ReadableStream | null;
  size: number;
  customMetadata?: Record<string, string>;
  httpMetadata?: {
    contentType?: string;
  };
  writeHttpMetadata?(headers: Headers): void;
};

export type R2Bucket = {
  get(key: string): Promise<R2ObjectBody | null>;
  head?(key: string): Promise<R2ObjectBody | null>;
};

export type KVNamespace = {
  get(key: string): Promise<string | null>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  ARTIFACTS: R2Bucket;
  DENYLIST: KVNamespace;
  ARTIFACT_RATE_LIMIT?: RateLimitBinding;
  CONTENT_SIGNING_SECRET: string;
  CONTENT_SIGNING_SECRET_V2?: string;
  CONTENT_SIGNING_KID?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
  CONTENT_BASE_URL?: string;
  DOCS_BASE_URL?: string;
  AGENT_PASTE_ENV?: string;
  SENTRY_DSN?: string;
};

type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables }>;

const securityHeaders = CONTENT_SECURITY_HEADERS;
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = ["/healthz", "/openapi.json"] as const;

const BUNDLE_FILENAME = "bundle.zip";

app.use("*", requestIdMiddleware());
app.get("/healthz", (c) => c.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(
    buildContentOpenApiDocument({ serverUrl: context.env.CONTENT_BASE_URL ?? new URL(context.req.raw.url).origin }),
  ),
);
const contentRegistrar = createRegistrar({
  app,
  auth: {
    async signed_content_token(context) {
      const appContext = context as AppContext;
      const path = contentPath(appContext);
      const env = context.env as Env;
      const token = contentTokenFromRequest(appContext);
      const signingRing = contentSigningRingFromEnv(env);
      const payload = signingRing
        ? await verifyContentTokenWithKeyRing(token, signingRing)
        : await verifyContentToken(token, env.CONTENT_SIGNING_SECRET);
      if (!payload || !isAllowedPath(path, payload)) {
        return { ok: false, code: "not_found" };
      }
      if (await isDenylisted(context.env as Env, payload)) {
        return { ok: false, code: "not_found" };
      }
      return { ok: true, principal: { kind: "signed_content_token", payload } };
    },
  },
  rateLimitBindings: (context) => ({ artifact: (context.env as Env).ARTIFACT_RATE_LIMIT }),
  docsBaseUrl: (context) => (context.env as Env).DOCS_BASE_URL,
  defaultErrorHeaders: () => securityHeaders,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
contentRegistrar.mount(contractById("content.get"), async (context, principal) =>
  serveSignedObject(
    context as AppContext,
    (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload,
    contentPath(context as AppContext),
  ),
);
contentRegistrar.mount(contractById("content.head"), async (context, principal) =>
  serveSignedObject(
    context as AppContext,
    (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload,
    contentPath(context as AppContext),
  ),
);
contentRegistrar.mount(contractById("content.bundle"), async (context, principal) =>
  serveSignedBundle(context as AppContext, (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload),
);
contentRegistrar.mount(contractById("content.bundleHead"), async (context, principal) =>
  serveSignedBundle(context as AppContext, (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload),
);
app.notFound((context) => errorResponse(context, "not_found"));
app.onError((error, context) => {
  console.error("Unhandled content error:", error);
  return errorResponse(context, "internal_error");
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

function contentTokenFromRequest(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  if (pathname.startsWith("/b/")) {
    const encodedToken = pathname.split("/")[2];
    return encodedToken ? (safeDecodeURIComponent(encodedToken) ?? "") : "";
  }
  return context.req.param("token") ?? "";
}

function contentPath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  if (pathname.startsWith("/b/")) {
    return "";
  }
  const encodedToken = pathname.split("/")[2];
  if (!encodedToken) {
    return "";
  }
  const marker = `/v/${encodedToken}/`;
  return safeDecodeURIComponent(pathname.slice(marker.length)) ?? "";
}

async function serveSignedBundle(context: AppContext, payload: ContentTokenPayload): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;
  const key = payload.key_prefix;
  if (!key?.endsWith(BUNDLE_FILENAME)) {
    return errorResponse(context, "not_found");
  }

  const object =
    request.method === "HEAD" && env.ARTIFACTS.head ? await env.ARTIFACTS.head(key) : await env.ARTIFACTS.get(key);
  if (!object) {
    return errorResponse(context, "not_found");
  }

  const served = await prepareEncryptedObjectResponse({
    env,
    payload,
    object,
    path: BUNDLE_FILENAME,
    objectKey: key,
    method: request.method,
  });
  if (!served) {
    return errorResponse(context, "not_found");
  }

  const headers = bundleResponseHeaders(served.plaintextSize, payload.exp);
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  return new Response(served.body, { status: 200, headers });
}

async function serveSignedObject(context: AppContext, payload: ContentTokenPayload, path: string): Promise<Response> {
  const env = context.env;
  const request = context.req.raw;

  const key = objectKeyFor(payload, path);
  const object =
    request.method === "HEAD" && env.ARTIFACTS.head ? await env.ARTIFACTS.head(key) : await env.ARTIFACTS.get(key);
  if (!object) {
    return errorResponse(context, "not_found");
  }

  const served = await prepareEncryptedObjectResponse({
    env,
    payload,
    object,
    path,
    objectKey: key,
    method: request.method,
  });
  if (!served) {
    return errorResponse(context, "not_found");
  }

  const headers = responseHeadersForPath(path, served.plaintextSize, payload.exp);
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  return new Response(served.body, { status: 200, headers });
}

async function prepareEncryptedObjectResponse(input: {
  env: Env;
  payload: ContentTokenPayload;
  object: R2ObjectBody;
  path: string;
  objectKey: string;
  method: string;
}): Promise<{ body: ReadableStream | null; plaintextSize: number } | null> {
  const encryptionRing = artifactBytesEncryptionRingFromEnv(input.env);
  if (!encryptionRing || !isArtifactBytesEncryptionMetadata(input.object.customMetadata)) {
    return null;
  }
  const workspaceId = input.payload.workspace_id;
  if (!workspaceId) {
    return null;
  }
  const normalizedPath = input.path.length > 0 ? input.path : BUNDLE_FILENAME;
  const keyParts = normalizedPath === BUNDLE_FILENAME ? null : parseRevisionFileObjectKey(input.objectKey);
  const artifactId = keyParts?.artifactId ?? input.payload.artifact_id;
  const revisionId = keyParts?.revisionId ?? input.payload.revision_id;
  let plaintextSize: number;
  try {
    plaintextSize = plaintextByteLengthFromStoredObject(input.object.size);
  } catch {
    return null;
  }
  if (input.method === "HEAD") {
    return { body: null, plaintextSize };
  }
  const ciphertext = await bytesFromReadableBody(input.object.body);
  try {
    const plaintext = await decryptArtifactBytesWithKeyRing({
      ciphertext,
      ring: encryptionRing,
      metadata: input.object.customMetadata,
      context: {
        workspaceId,
        artifactId,
        revisionId,
        normalizedPath,
      },
    });
    return {
      body: new Blob([plaintext as BlobPart]).stream(),
      plaintextSize,
    };
  } catch {
    return null;
  }
}

function denylistKeysForPayload(payload: ContentTokenPayload): string[] {
  return [
    ...(payload.workspace_id ? [`wsd:${payload.workspace_id}`] : []),
    `ad:${payload.artifact_id}`,
    `rd:${payload.revision_id}`,
    ...(payload.access_link_id ? [`ald:${payload.access_link_id}`] : []),
  ];
}

async function isDenylisted(env: Env, payload: ContentTokenPayload): Promise<boolean> {
  const denylistResults = await Promise.all(denylistKeysForPayload(payload).map((key) => env.DENYLIST.get(key)));
  return denylistResults.some((value) => value !== null);
}

function isAllowedPath(path: string, payload: ContentTokenPayload): boolean {
  if (path.length === 0) {
    return Boolean(payload.key_prefix?.endsWith(BUNDLE_FILENAME));
  }
  if (!isSafePath(path)) {
    return false;
  }

  return !payload.paths || payload.paths.includes(path);
}

function isSafePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..");
}

function objectKeyFor(payload: ContentTokenPayload, path: string): string {
  const prefix = payload.key_prefix ?? `artifacts/${payload.artifact_id}/revisions/${payload.revision_id}/files`;
  return `${prefix.replace(/\/+$/, "")}/${path}`;
}

function bundleResponseHeaders(size: number, tokenExpiresAt: number): Headers {
  const headers = new Headers(securityHeaders);
  headers.set("cache-control", `private, max-age=${Math.max(0, tokenExpiresAt - Math.floor(Date.now() / 1000))}`);
  headers.set("content-length", String(size));
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${BUNDLE_FILENAME}"`);
  return headers;
}

function responseHeadersForPath(path: string, size: number, tokenExpiresAt: number): Headers {
  const served = servedContentForPath(path);
  const headers = new Headers(securityHeaders);
  headers.set("cache-control", `private, max-age=${Math.max(0, tokenExpiresAt - Math.floor(Date.now() / 1000))}`);
  headers.set("content-length", String(size));
  headers.set("content-type", served.contentType);
  headers.set("content-security-policy", served.csp);
  if (served.disposition === "attachment") {
    headers.set("content-disposition", `attachment; filename="${attachmentFilename(path)}"`);
  }
  return headers;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function contractById(id: (typeof routeContracts)[number]["id"]): (typeof routeContracts)[number] {
  const contract = routeContracts.find((route) => route.id === id);
  if (!contract) {
    throw new Error(`Missing route contract ${id}`);
  }
  return contract;
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
    defaultHeaders: securityHeaders,
  });
}
