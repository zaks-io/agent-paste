export {
  audienceMatchesMcpResource,
  authenticateMcpBearer,
  type McpAuthEnv,
  type McpAuthenticatedPrincipal,
  mcpVerifyOptions,
  resolveMcpMemberActor,
  WorkOsVerificationUnavailableError,
} from "./mcp-auth.js";
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

export {
  DEFAULT_WORKOS_ISSUER,
  fetchWorkOsUser,
  resolveWorkOsIdentity,
  verifyWorkOsAccessToken,
  type WebCallbackIdentity,
  type WorkOsIdentity,
  type WorkOsRejectReason,
  type WorkOsVerificationOptions,
} from "./workos.js";

import { base64UrlEncode } from "@agent-paste/tokens/crypto";

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

const MEMORY_CACHE_MAX_ENTRIES = 1000;
const memoryCache = new Map<string, CacheEntry>();
const NEGATIVE_CACHE_SENTINEL = "null";

function setMemoryCacheEntry(cacheKey: string, entry: CacheEntry): void {
  memoryCache.set(cacheKey, entry);
  while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    memoryCache.delete(oldestKey);
  }
}

export async function cacheKeyForSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function cachedLookup<T>(options: CacheLookupOptions<T>): Promise<T> {
  const cacheKey = cacheEntryKey(options.namespace, options.key);
  const now = Date.now();
  const cached = await readCachedPayload(cacheKey, now, options.ttlSeconds);
  if (cached !== undefined) {
    return JSON.parse(cached) as T;
  }

  const value = await options.lookup();
  await writeCachedPayload(options.namespace, options.key, options.ttlSeconds, JSON.stringify(value), now);
  return value;
}

/** Caches only failed (null/undefined) lookups so revocable credentials always re-hit the source of truth. */
export async function cachedNegativeLookup<T>(
  options: CacheLookupOptions<T | null | undefined>,
): Promise<T | null | undefined> {
  const cacheKey = cacheEntryKey(options.namespace, options.key);
  const now = Date.now();
  const cached = await readCachedPayload(cacheKey, now, options.ttlSeconds);
  if (cached !== undefined) {
    const parsed = parseCachedPayload(cached);
    if (parsed === null || parsed === undefined) {
      return parsed;
    }
  }

  const value = await options.lookup();
  if (value === null || value === undefined) {
    await writeCachedPayload(options.namespace, options.key, options.ttlSeconds, NEGATIVE_CACHE_SENTINEL, now);
  }
  return value;
}

function cacheEntryKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

function parseCachedPayload(payload: string): unknown {
  return JSON.parse(payload) as unknown;
}

async function readCachedPayload(
  cacheKey: string,
  now: number,
  requestedTtlSeconds: number,
): Promise<string | undefined> {
  const local = memoryCache.get(cacheKey);
  if (local && local.expiresAt > now) {
    return local.value;
  }

  const edgeCache = getEdgeCache();
  const separator = cacheKey.indexOf(":");
  const namespace = cacheKey.slice(0, separator);
  const key = cacheKey.slice(separator + 1);
  const edgeRequest = edgeCacheRequest(namespace, key);
  const edgeResponse = await edgeCache?.match(edgeRequest);
  if (!edgeResponse) {
    return undefined;
  }

  const value = await edgeResponse.text();
  setMemoryCacheEntry(cacheKey, {
    expiresAt: now + memoryTtlFromEdgeResponse(edgeResponse, requestedTtlSeconds) * 1000,
    value,
  });
  return value;
}

async function writeCachedPayload(
  namespace: string,
  key: string,
  ttlSeconds: number,
  encoded: string,
  now: number,
): Promise<void> {
  const cacheKey = cacheEntryKey(namespace, key);
  setMemoryCacheEntry(cacheKey, { expiresAt: now + ttlSeconds * 1000, value: encoded });
  const edgeCache = getEdgeCache();
  const edgeRequest = edgeCacheRequest(namespace, key);
  try {
    void edgeCache
      ?.put(
        edgeRequest,
        new Response(encoded, {
          headers: {
            // `private` would make cache.put reject the entry; the synthetic
            // internal key space is unreachable externally, so plain max-age
            // is safe (ADR 0062).
            "cache-control": `max-age=${ttlSeconds}`,
            "content-type": "application/json; charset=utf-8",
          },
        }),
      )
      .catch(() => undefined);
  } catch {
    // Edge cache writes are best effort; the lookup result is still valid.
  }
}

function edgeCacheRequest(namespace: string, key: string): Request {
  return new Request(`https://agent-paste.internal/cache/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`);
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
