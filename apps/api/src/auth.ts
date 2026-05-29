import { cachedNegativeLookup, cacheKeyForSecret } from "@agent-paste/auth";
import type { RouteContract } from "@agent-paste/contracts";
import type { ApiKeyActor } from "@agent-paste/db";
import { constantTimeEqual } from "@agent-paste/tokens/crypto";
import type { AuthResolvers } from "@agent-paste/worker-runtime";
import type { Context } from "hono";
import { verifyAgentViewTokenForEnv } from "./agent-view.js";
import type { Env } from "./env.js";
import { authenticateMcpBearer, resolveMcpMemberActor } from "./mcp-auth.js";
import { isOperator, verifyCfAccessServiceToken } from "./operator.js";
import type { RouteId } from "./route-contracts.js";
import { apiDatabase, postgresRuntime } from "./runtime.js";
import {
  DEFAULT_WORKOS_ISSUER,
  resolveWorkOsIdentity,
  type WorkOsIdentity,
  type WorkOsRejectReason,
  type WorkOsVerificationOptions,
} from "./workos.js";

const AUTH_CACHE_TTL_SECONDS = 60;
const CLI_KEY_MINT_ROUTE_ID: RouteId = "web.apiKeys.create";

type WebIdentityOptions = {
  allowCliClient?: boolean;
};

type WorkOsRejection = {
  path: "dashboard" | "cli";
  reason: WorkOsRejectReason;
  detail?: Record<string, unknown>;
};

export function createApiAuthResolvers(): AuthResolvers {
  return {
    async none() {
      return { ok: true, principal: { kind: "none" } } as const;
    },
    async api_key(context: Context) {
      const actor = await authenticateApiKey(context.req.raw, context.env as Env);
      return actor
        ? ({ ok: true, principal: { kind: "api_key", actor } } as const)
        : ({ ok: false, code: "not_authenticated" } as const);
    },
    async mcp_oauth(context: Context) {
      return authenticateMcpPrincipal(context);
    },
    async api_key_or_mcp_oauth(context: Context) {
      const env = context.env as Env;
      const apiKeyActor = await authenticateApiKey(context.req.raw, env);
      if (apiKeyActor) {
        return { ok: true, principal: { kind: "api_key", actor: apiKeyActor } } as const;
      }
      return authenticateMcpPrincipal(context);
    },
    async signed_agent_view_token(context: Context) {
      const token = context.req.param("token");
      if (!token) {
        return { ok: false, code: "not_found" } as const;
      }
      const payload = await verifyAgentViewTokenForEnv(token, context.env as Env);
      return payload
        ? ({ ok: true, principal: { kind: "signed_agent_view_token", payload } } as const)
        : ({ ok: false, code: "not_found" } as const);
    },
    async workos_access_token(context: Context, contract: RouteContract) {
      const identity = await authenticateWebIdentity(context.req.raw, context.env as Env, {
        allowCliClient: contract.id === CLI_KEY_MINT_ROUTE_ID,
      });
      if (!identity) {
        return { ok: false, code: "not_authenticated" } as const;
      }
      if (contract.allowUnprovisioned) {
        return { ok: true, principal: { kind: "workos_access_token", identity } } as const;
      }
      const db = apiDatabase(context.env as Env);
      if (!db) {
        return { ok: false, code: "database_unavailable" } as const;
      }
      const actor =
        contract.id === CLI_KEY_MINT_ROUTE_ID
          ? await db.ensureWebMember({ workosUserId: identity.workos_user_id, email: identity.email })
          : await db.getWebMemberByWorkOsUserId({ workosUserId: identity.workos_user_id });
      if (!actor || actor.type !== "member" || !actor.workspace_id) {
        return { ok: false, code: "forbidden" } as const;
      }
      return { ok: true, principal: { kind: "workos_access_token", identity, actor } } as const;
    },
    async operator(context: Context) {
      const id = await authenticateOperator(context.req.raw, context.env as Env);
      return id
        ? ({ ok: true, principal: { kind: "operator", actor: { type: "platform", id } } } as const)
        : ({ ok: false, code: "not_found" } as const);
    },
  } satisfies AuthResolvers;
}

export async function authenticateWebIdentity(
  request: Request,
  env: Env,
  identityOptions: WebIdentityOptions = {},
): Promise<WorkOsIdentity | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  if (env.AUTH?.verifyWebToken) {
    return env.AUTH.verifyWebToken(token);
  }

  if (!env.WORKOS_API_KEY) {
    return null;
  }

  const rejections: WorkOsRejection[] = [];

  const dashboard = dashboardVerifyOptions(env);
  if (dashboard) {
    const identity = await resolveWorkOsIdentity(
      `Bearer ${token}`,
      collectRejections(dashboard, "dashboard", rejections),
    );
    if (identity) {
      return { ...identity, auth_surface: "dashboard" };
    }
  }

  if (identityOptions.allowCliClient) {
    const cli = cliVerifyOptions(env);
    if (cli) {
      const identity = await resolveWorkOsIdentity(`Bearer ${token}`, collectRejections(cli, "cli", rejections));
      if (identity) {
        return { ...identity, auth_surface: "cli" };
      }
    }
  }

  logWorkOsRejections(rejections);
  return null;
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function authenticateSmokeHarness(request: Request, env: Env): boolean {
  const secret = env.SMOKE_HARNESS_SECRET;
  const token = bearerToken(request);
  return Boolean(secret && token && constantTimeEqual(token, secret));
}

export function isNonProductionEnv(env: Env): boolean {
  const value = env.AGENT_PASTE_ENV;
  return value !== undefined && value !== "production" && value !== "live";
}

async function authenticateApiKey(request: Request, env: Env): Promise<ApiKeyActor | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  if (env.AUTH) {
    return validApiKeyActor(await env.AUTH.verifyApiKey(token));
  }

  const runtime = postgresRuntime(env);
  if (!runtime) {
    return null;
  }

  return validApiKeyActor(
    (await cachedNegativeLookup({
      namespace: "api-key-auth-v2",
      key: await cacheKeyForSecret(token),
      ttlSeconds: AUTH_CACHE_TTL_SECONDS,
      lookup: () => runtime.auth.verifyApiKey(token),
    })) ?? null,
  );
}

function validApiKeyActor(actor: ApiKeyActor | null): ApiKeyActor | null {
  if (!actor?.expires_at) {
    return actor;
  }
  return Date.parse(actor.expires_at) <= Date.now() ? null : actor;
}

async function authenticateMcpPrincipal(context: Context) {
  const env = context.env as Env;
  const authenticated = await authenticateMcpBearer(context.req.raw, env);
  if (!authenticated) {
    return { ok: false, code: "not_authenticated" } as const;
  }
  const db = apiDatabase(env);
  if (!db) {
    return { ok: false, code: "database_unavailable" } as const;
  }
  const actor = await resolveMcpMemberActor(authenticated, db);
  if (!actor) {
    return { ok: false, code: "forbidden" } as const;
  }
  return {
    ok: true,
    principal: {
      kind: "workos_access_token",
      identity: { ...authenticated.identity, mcp_scopes: authenticated.mcpScopes },
      actor,
    },
  } as const;
}

function dashboardVerifyOptions(env: Env): WorkOsVerificationOptions | null {
  if (!env.WORKOS_API_KEY || !env.WORKOS_CLIENT_ID) {
    return null;
  }
  const options: WorkOsVerificationOptions = {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    requireClientIdClaim: false,
    issuers: env.WORKOS_ISSUER ? [DEFAULT_WORKOS_ISSUER, env.WORKOS_ISSUER] : [DEFAULT_WORKOS_ISSUER],
  };
  if (env.WORKOS_API_BASE_URL) {
    options.apiBaseUrl = env.WORKOS_API_BASE_URL;
  }
  if (env.WORKOS_JWKS_URL) {
    options.jwksUrl = env.WORKOS_JWKS_URL;
  }
  return options;
}

function collectRejections(
  options: WorkOsVerificationOptions,
  path: WorkOsRejection["path"],
  sink: WorkOsRejection[],
): WorkOsVerificationOptions {
  return {
    ...options,
    onReject: (reason, detail) => {
      sink.push(detail ? { path, reason, detail } : { path, reason });
    },
  };
}

function logWorkOsRejections(rejections: WorkOsRejection[]): void {
  for (const { path, reason, detail } of rejections) {
    console.warn(JSON.stringify({ event: "workos_auth_reject", path, reason, ...(detail ?? {}) }));
  }
}

function cliVerifyOptions(env: Env): WorkOsVerificationOptions | null {
  if (!env.WORKOS_API_KEY || !env.WORKOS_CLI_AUDIENCE) {
    return null;
  }
  const options: WorkOsVerificationOptions = {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLI_AUDIENCE,
    requireClientIdClaim: false,
  };
  if (env.WORKOS_API_BASE_URL) {
    options.apiBaseUrl = env.WORKOS_API_BASE_URL;
  }
  if (env.WORKOS_CLI_ISSUER) {
    options.issuers = [env.WORKOS_CLI_ISSUER];
  }
  if (env.WORKOS_CLI_JWKS_URL) {
    options.jwksUrl = env.WORKOS_CLI_JWKS_URL;
  }
  return options;
}

async function authenticateOperator(request: Request, env: Env): Promise<string | null> {
  const identity = await authenticateWebIdentity(request, env);
  if (identity && isOperator(identity)) {
    return identity.email.toLowerCase();
  }

  if (env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) {
    const commonName = await verifyCfAccessServiceToken(request.headers.get("Cf-Access-Jwt-Assertion"), {
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      aud: env.CF_ACCESS_AUD,
    });
    if (commonName) {
      return commonName;
    }
  }

  return null;
}
