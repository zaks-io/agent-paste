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
  ALLOW_DEV_TOKENS?: string;
};

export type ContentTokenPayload = {
  artifact_id: string;
  revision_id: string;
  key_prefix?: string;
  paths?: string[];
  exp: number;
};

const securityHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/v\/([^/]+)\/(.+)$/);

  if ((request.method !== "GET" && request.method !== "HEAD") || !match?.[1] || !match[2]) {
    return notFound();
  }

  try {
    const token = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    return serveSignedObject(request, env, token, path);
  } catch {
    return notFound();
  }
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

  const headers = new Headers(securityHeaders);
  headers.set("cache-control", "private, max-age=60");
  headers.set("content-length", String(object.size));
  object.writeHttpMetadata?.(headers);
  headers.set("content-type", object.httpMetadata?.contentType ?? contentTypeFor(path));

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
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = await hmac(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as ContentTokenPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
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

function contentTypeFor(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  switch (extension) {
    case "html":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
    case "mjs":
      return "text/javascript; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "txt":
      return "text/plain; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
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

function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: "not_found", message: "not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", ...securityHeaders },
  });
}
