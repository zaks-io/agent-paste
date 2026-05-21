import { type Context, Hono } from "hono";

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

export type Env = {
  ARTIFACTS: R2Bucket;
  DENYLIST: KVNamespace;
  CONTENT_SIGNING_SECRET: string;
  CONTENT_BASE_URL?: string;
  ALLOW_DEV_TOKENS?: string;
};

export type ContentTokenPayload = {
  artifact_id: string;
  revision_id: string;
  key_prefix?: string;
  paths?: string[];
  exp: number;
};

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
const app = new Hono<{ Bindings: Env }>();

app.get("/openapi.json", (context) =>
  context.json(openApiDocument(context.env.CONTENT_BASE_URL ?? requestOrigin(context.req.raw))),
);
app.get("/v/:token/*", (context) =>
  serveSignedObject(context.req.raw, context.env, context.req.param("token"), contentPath(context)),
);
app.on("HEAD", "/v/:token/*", (context) =>
  serveSignedObject(context.req.raw, context.env, context.req.param("token"), contentPath(context)),
);
app.notFound(() => notFound());
app.onError((error) => {
  console.error("Unhandled content error:", error);
  return internalServerError();
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}

function contentPath(context: Context<{ Bindings: Env }>): string {
  const pathname = new URL(context.req.raw.url).pathname;
  const encodedToken = pathname.split("/")[2];
  if (!encodedToken) {
    return "";
  }
  const marker = `/v/${encodedToken}/`;
  return safeDecodeURIComponent(pathname.slice(marker.length)) ?? "";
}

export async function signContentToken(payload: ContentTokenPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function serveSignedObject(request: Request, env: Env, token: string, path: string): Promise<Response> {
  const payload = await verifyContentToken(token, env.CONTENT_SIGNING_SECRET);
  const resolvedPayload = payload ?? (allowDevTokens(env) ? parseDevToken(token) : null);
  if (!resolvedPayload || !isAllowedPath(path, resolvedPayload)) {
    return notFound();
  }

  const [artifactDenied, revisionDenied, tokenDenied] = await Promise.all([
    env.DENYLIST.get(`artifact:${resolvedPayload.artifact_id}`),
    env.DENYLIST.get(`revision:${resolvedPayload.revision_id}`),
    env.DENYLIST.get(`content-token:${await sha256(token)}`),
  ]);

  if (artifactDenied || revisionDenied || tokenDenied) {
    return notFound();
  }

  const key = objectKeyFor(resolvedPayload, path);
  const object =
    request.method === "HEAD" && env.ARTIFACTS.head ? await env.ARTIFACTS.head(key) : await env.ARTIFACTS.get(key);
  if (!object) {
    return notFound();
  }

  const headers = responseHeadersForPath(path, object.size, resolvedPayload.exp);

  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

function parseDevToken(token: string): ContentTokenPayload | null {
  const [artifactId, revisionId] = token.split(".");
  if (!artifactId?.startsWith("art_") || !revisionId?.startsWith("rev_")) {
    return null;
  }
  return {
    artifact_id: artifactId,
    revision_id: revisionId,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
}

function allowDevTokens(env: Env): boolean {
  return env.ALLOW_DEV_TOKENS === "true" || env.ALLOW_DEV_TOKENS === "1";
}

async function verifyContentToken(token: string, secret: string): Promise<ContentTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = await hmac(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    return null;
  }
  if (!isValidContentTokenPayload(payload)) {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function isValidContentTokenPayload(value: unknown): value is ContentTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<ContentTokenPayload>;
  return (
    typeof payload.artifact_id === "string" &&
    payload.artifact_id.startsWith("art_") &&
    typeof payload.revision_id === "string" &&
    payload.revision_id.startsWith("rev_") &&
    (payload.key_prefix === undefined || (typeof payload.key_prefix === "string" && payload.key_prefix.length > 0)) &&
    (payload.paths === undefined ||
      (Array.isArray(payload.paths) && payload.paths.every((path) => typeof path === "string"))) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp)
  );
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
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

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function openApiDocument(serverUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Paste Content API",
      version: "0.1.0",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/v/{token}/{path}": {
        get: {
          operationId: "content.get",
          parameters: [pathParameter("token", "Signed content token"), pathParameter("path", "File path")],
          responses: {
            200: { description: "Artifact file bytes" },
            404: errorResponseDescription(),
          },
        },
        head: {
          operationId: "content.head",
          parameters: [pathParameter("token", "Signed content token"), pathParameter("path", "File path")],
          responses: {
            200: { description: "Artifact file metadata" },
            404: errorResponseDescription(),
          },
        },
      },
    },
    components: {
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

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
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

function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: "not_found", message: "not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", ...securityHeaders },
  });
}

function internalServerError(): Response {
  return new Response(JSON.stringify({ error: { code: "internal_error", message: "internal_error" } }), {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8", ...securityHeaders },
  });
}
