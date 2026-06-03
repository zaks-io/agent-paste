import { cachedNegativeLookup, cacheKeyForSecret } from "@agent-paste/auth";
import type { ApiKeyActor } from "@agent-paste/db";
import { bearerToken } from "./bearer.js";

const DEFAULT_AUTH_CACHE_TTL_SECONDS = 60;

export type ApiKeyAuthService = {
  verifyApiKey(apiKey: string): Promise<ApiKeyActor | null>;
};

export type ApiKeyAuthEnv = {
  AUTH?: ApiKeyAuthService;
};

export type PostgresApiKeyRuntime = {
  auth: ApiKeyAuthService;
};

export function validApiKeyActor<T extends { expires_at?: string | null }>(actor: T | null): T | null {
  if (!actor?.expires_at) {
    return actor;
  }
  const expiresAtMs = Date.parse(actor.expires_at);
  if (Number.isNaN(expiresAtMs)) {
    return null;
  }
  return expiresAtMs <= Date.now() ? null : actor;
}

export function createAuthenticateApiKey<TEnv extends ApiKeyAuthEnv>(options: {
  namespace: string;
  ttlSeconds?: number;
  resolvePostgresRuntime: (env: TEnv) => PostgresApiKeyRuntime | undefined;
}): (request: Request, env: TEnv) => Promise<ApiKeyActor | null> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_AUTH_CACHE_TTL_SECONDS;

  return async (request, env) => {
    const token = bearerToken(request);
    if (!token) {
      return null;
    }

    if (env.AUTH) {
      return validApiKeyActor(await env.AUTH.verifyApiKey(token));
    }

    const runtime = options.resolvePostgresRuntime(env);
    if (!runtime) {
      return null;
    }

    return validApiKeyActor(
      (await cachedNegativeLookup({
        namespace: options.namespace,
        key: await cacheKeyForSecret(token),
        ttlSeconds,
        lookup: () => runtime.auth.verifyApiKey(token),
      })) ?? null,
    );
  };
}
