import { getRequestId, REQUEST_ID_HEADER, type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { buildContentOpenApiDocument, routeContracts } from "@agent-paste/contracts";
import { attachmentFilename, CONTENT_SECURITY_HEADERS, servedContentForPath } from "@agent-paste/storage";
import { type ContentTokenPayload, mintContentToken, verifyContentToken } from "@agent-paste/tokens/content";
import {
  type AppErrorCode,
  createRegistrar,
  errorResponse as runtimeErrorResponse,
  type SignedContentTokenPrincipal,
} from "@agent-paste/worker-runtime";
import { type Context, Hono } from "hono";

export type { ContentTokenPayload };
export { mintContentToken as signContentToken };

export type R2ObjectBody = {
  body: ReadableStream | null;
  size: number;
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
  CONTENT_BASE_URL?: string;
  DOCS_BASE_URL?: string;
};

type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables }>;

const securityHeaders = CONTENT_SECURITY_HEADERS;
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = ["/healthz", "/openapi.json"] as const;

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
      const path = contentPath(context as AppContext);
      const payload = await verifyContentToken(
        context.req.param("token") ?? "",
        (context.env as Env).CONTENT_SIGNING_SECRET,
      );
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
app.notFound((context) => errorResponse(context, "not_found"));
app.onError((error, context) => {
  console.error("Unhandled content error:", error);
  return errorResponse(context, "internal_error");
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}

function contentPath(context: AppContext): string {
  const pathname = new URL(context.req.raw.url).pathname;
  const encodedToken = pathname.split("/")[2];
  if (!encodedToken) {
    return "";
  }
  const marker = `/v/${encodedToken}/`;
  return safeDecodeURIComponent(pathname.slice(marker.length)) ?? "";
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

  const headers = responseHeadersForPath(path, object.size, payload.exp);
  headers.set(REQUEST_ID_HEADER, getRequestId(context));

  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
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
