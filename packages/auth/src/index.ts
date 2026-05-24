export {
  buildErrorBody,
  type DocCode,
  docsUrlFor,
  type ErrorBody,
  getRequestId,
  REQUEST_ID_CONTEXT_KEY,
  REQUEST_ID_HEADER,
  type RequestIdVariables,
  requestIdMiddleware,
  resolveRequestId,
} from "./request-id.js";

import { base64UrlEncode, constantTimeEqual, hmac } from "@agent-paste/tokens/crypto";

export type CacheLookupOptions<T> = {
  namespace: string;
  key: string;
  ttlSeconds: number;
  lookup: () => Promise<T>;
};

type CacheEntry = {
  expiresAt: number;
  value: string;
};

type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

const memoryCache = new Map<string, CacheEntry>();

export async function hashAdminToken(token: string, pepper: string): Promise<string> {
  return hmac(token, pepper);
}

export async function verifyAdminToken(token: string, expectedHmac: string, pepper: string): Promise<boolean> {
  return constantTimeEqual(await hashAdminToken(token, pepper), expectedHmac);
}

export async function cacheKeyForSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function cachedLookup<T>(options: CacheLookupOptions<T>): Promise<T> {
  const cacheKey = `${options.namespace}:${options.key}`;
  const now = Date.now();
  const local = memoryCache.get(cacheKey);
  if (local && local.expiresAt > now) {
    return JSON.parse(local.value) as T;
  }

  const edgeCache = getEdgeCache();
  const edgeRequest = new Request(
    `https://agent-paste.internal/cache/${encodeURIComponent(options.namespace)}/${encodeURIComponent(options.key)}`,
  );
  const edgeResponse = await edgeCache?.match(edgeRequest);
  if (edgeResponse) {
    const value = await edgeResponse.text();
    memoryCache.set(cacheKey, {
      expiresAt: now + memoryTtlFromEdgeResponse(edgeResponse, options.ttlSeconds) * 1000,
      value,
    });
    return JSON.parse(value) as T;
  }

  const value = await options.lookup();
  const encoded = JSON.stringify(value);
  memoryCache.set(cacheKey, { expiresAt: now + options.ttlSeconds * 1000, value: encoded });
  try {
    void edgeCache
      ?.put(
        edgeRequest,
        new Response(encoded, {
          headers: {
            "cache-control": `private, max-age=${options.ttlSeconds}`,
            "content-type": "application/json; charset=utf-8",
          },
        }),
      )
      .catch(() => undefined);
  } catch {
    // Edge cache writes are best effort; the lookup result is still valid.
  }
  return value;
}

function getEdgeCache(): EdgeCache | undefined {
  const maybeGlobal = globalThis as typeof globalThis & {
    caches?: { default?: EdgeCache };
  };
  return maybeGlobal.caches?.default;
}

function memoryTtlFromEdgeResponse(response: Response, requestedTtlSeconds: number): number {
  const fallback = Math.max(1, Math.floor(requestedTtlSeconds / 2));
  const expires = response.headers.get("expires");
  if (expires) {
    const expiresAt = Date.parse(expires);
    if (Number.isFinite(expiresAt)) {
      return Math.max(1, Math.min(fallback, Math.floor((expiresAt - Date.now()) / 1000)));
    }
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = cacheControl.match(/\bmax-age=(\d+)\b/)?.[1];
  if (maxAge) {
    const age = Number.parseInt(response.headers.get("age") ?? "0", 10);
    const remaining = Number.parseInt(maxAge, 10) - (Number.isFinite(age) ? age : 0);
    return Math.max(1, Math.min(fallback, remaining));
  }

  return fallback;
}
