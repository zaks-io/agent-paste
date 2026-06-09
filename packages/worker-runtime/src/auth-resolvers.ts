import {
  authenticateMcpBearer,
  type McpAuthEnv,
  resolveMcpMemberActor,
  WorkOsVerificationUnavailableError,
} from "@agent-paste/auth";
import type { ApiKeyActor, Repository } from "@agent-paste/db";
import type { AuthResolver } from "./registrar.js";

export function createMcpOAuthResolver<TEnv extends McpAuthEnv>(options: {
  resolveDatabase: (env: TEnv) => Repository | undefined;
}): AuthResolver {
  return async (context) => {
    const env = context.env as TEnv;
    return resolveMcpPrincipal(context.req.raw, env, options.resolveDatabase(env));
  };
}

export function createApiKeyOrMcpOAuthResolver<TEnv extends McpAuthEnv>(options: {
  authenticateApiKey: (request: Request, env: TEnv) => Promise<ApiKeyActor | null>;
  resolveDatabase: (env: TEnv) => Repository | undefined;
}): AuthResolver {
  return async (context) => {
    const env = context.env as TEnv;
    const apiKeyActor = await options.authenticateApiKey(context.req.raw, env);
    if (apiKeyActor) {
      return { ok: true, principal: { kind: "api_key", actor: apiKeyActor } } as const;
    }
    return resolveMcpPrincipal(context.req.raw, env, options.resolveDatabase(env));
  };
}

async function resolveMcpPrincipal(
  request: Request,
  env: McpAuthEnv,
  db: Repository | undefined,
): Promise<Awaited<ReturnType<AuthResolver>>> {
  let authenticated: Awaited<ReturnType<typeof authenticateMcpBearer>>;
  try {
    authenticated = await authenticateMcpBearer(request, env);
  } catch (error) {
    if (error instanceof WorkOsVerificationUnavailableError) {
      return { ok: false, code: "database_unavailable" } as const;
    }
    throw error;
  }
  if (!authenticated) {
    return { ok: false, code: "not_authenticated" } as const;
  }
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
      identity: authenticated.identity,
      actor,
    },
  } as const;
}
