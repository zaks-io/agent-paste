const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const API_KEY_SECRET_BYTES = 32;

export type ApiKeyEnvironment = "preview" | "production" | "live";

export type ParsedApiKey = {
  env: ApiKeyEnvironment;
  publicId: string;
  secret: string;
};

export type ApiKeySecretMaterial = {
  publicId: string;
  secretHmac: string;
  pepperKid: number;
};

export type GeneratedApiKey = {
  secret: string;
  material: ApiKeySecretMaterial;
};

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

export async function generateApiKey(input: {
  env?: ApiKeyEnvironment;
  pepper: string;
  pepperKid?: number;
}): Promise<GeneratedApiKey> {
  const env = input.env ?? "preview";
  const publicId = randomCrockford(16);
  const secretSegment = randomBase64Url(API_KEY_SECRET_BYTES);
  const secret = `ap_pk_${env}_${publicId}_${secretSegment}`;
  return {
    secret,
    material: {
      publicId,
      secretHmac: await hmacBase64Url(secretSegment, input.pepper),
      pepperKid: input.pepperKid ?? 1,
    },
  };
}

export function parseApiKey(value: string): ParsedApiKey | null {
  const match = value.match(/^ap_pk_(preview|production|live)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{32,})$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return { env: match[1] as ApiKeyEnvironment, publicId: match[2], secret: match[3] };
}

export async function verifyApiKeySecret(input: {
  apiKey: string;
  expectedPublicId: string;
  expectedSecretHmac: string;
  pepper: string;
}): Promise<boolean> {
  const parsed = parseApiKey(input.apiKey);
  if (!parsed || parsed.publicId !== input.expectedPublicId) {
    return false;
  }
  const actual = await hmacBase64Url(parsed.secret, input.pepper);
  return constantTimeEqual(actual, input.expectedSecretHmac);
}

export async function hashAdminToken(token: string, pepper: string): Promise<string> {
  return hmacBase64Url(token, pepper);
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

export async function hmacBase64Url(value: string, secret: string): Promise<string> {
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

export function randomCrockford(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte: number) => CROCKFORD[byte % CROCKFORD.length]).join("");
}

export function randomBase64Url(bytesLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytesLength)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
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
