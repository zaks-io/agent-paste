import {
  buildErrorBody,
  getRequestId,
  REQUEST_ID_HEADER,
  type RequestIdVariables,
  requestIdMiddleware,
} from "@agent-paste/auth";
import { buildContentOpenApiDocument, routeContracts } from "@agent-paste/contracts";
import { type ContentTokenPayload, mintContentToken, verifyContentToken } from "@agent-paste/tokens/content";
import { createRegistrar } from "@agent-paste/worker-runtime";
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

type ServedContent = {
  contentType: string;
  disposition: "inline" | "attachment";
  csp: string;
};

const baseContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const svgContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const securityHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "cross-origin",
  "permissions-policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": baseContentSecurityPolicy,
};
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = ["/openapi.json"] as const;

app.use("*", requestIdMiddleware());
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
  principal.kind === "signed_content_token"
    ? serveSignedObject(
        context as AppContext,
        principal.payload as ContentTokenPayload,
        contentPath(context as AppContext),
      )
    : errorResponse(context as AppContext, "not_found", 404),
);
contentRegistrar.mount(contractById("content.head"), async (context, principal) =>
  principal.kind === "signed_content_token"
    ? serveSignedObject(
        context as AppContext,
        principal.payload as ContentTokenPayload,
        contentPath(context as AppContext),
      )
    : errorResponse(context as AppContext, "not_found", 404),
);
app.notFound((context) => errorResponse(context, "not_found", 404));
app.onError((error, context) => {
  console.error("Unhandled content error:", error);
  return errorResponse(context, "internal_error", 500);
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
    return errorResponse(context, "not_found", 404);
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
  const served = servedContentFor(path);
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

function servedContentFor(path: string): ServedContent {
  const extension = path.toLowerCase().match(/\.[^./\\]+$/u)?.[0] ?? "";
  switch (extension) {
    case ".html":
    case ".htm":
      return inlineContent("text/html; charset=utf-8");
    case ".css":
      return inlineContent("text/css; charset=utf-8");
    case ".js":
    case ".mjs":
      return inlineContent("application/javascript; charset=utf-8");
    case ".json":
      return inlineContent("application/json; charset=utf-8");
    case ".txt":
    case ".log":
      return inlineContent("text/plain; charset=utf-8");
    case ".md":
    case ".markdown":
      return inlineContent("text/markdown; charset=utf-8");
    case ".svg":
      return { contentType: "image/svg+xml", disposition: "inline", csp: svgContentSecurityPolicy };
    case ".png":
      return inlineContent("image/png");
    case ".jpg":
    case ".jpeg":
      return inlineContent("image/jpeg");
    case ".gif":
      return inlineContent("image/gif");
    case ".webp":
      return inlineContent("image/webp");
    case ".ico":
      return inlineContent("image/x-icon");
    case ".woff":
      return inlineContent("font/woff");
    case ".woff2":
      return inlineContent("font/woff2");
    default:
      return { contentType: "application/octet-stream", disposition: "attachment", csp: baseContentSecurityPolicy };
  }
}

function inlineContent(contentType: string): ServedContent {
  return { contentType, disposition: "inline", csp: baseContentSecurityPolicy };
}

function attachmentFilename(path: string): string {
  const basename = path.split("/").at(-1) || "download";
  return basename.replaceAll(/["\\\r\n]/gu, "_");
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
  code: string,
  status: number,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const requestId = getRequestId(context);
  const body = buildErrorBody({
    code,
    message: message ?? code,
    requestId,
    docsBaseUrl: context.env.DOCS_BASE_URL,
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...securityHeaders,
      ...extraHeaders,
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
