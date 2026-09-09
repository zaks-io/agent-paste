import type { ApiKeyActor, Repository } from "@agent-paste/db";
import { getInternalMcpSubject } from "./mcp-service-auth.js";
import type { AuthResolver } from "./registrar.js";

export function createMcpOAuthResolver<TEnv extends object>(options: {
  resolveDatabase: (env: TEnv) => Repository | undefined;
}): AuthResolver {
  return async (context) => {
    const env = context.env as TEnv;
    return resolveMcpPrincipal(context.req.raw, env, options.resolveDatabase(env));
  };
}

export function createApiKeyOrMcpOAuthResolver<TEnv extends object>(options: {
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
  _request: Request,
  env: object,
  db: Repository | undefined,
): Promise<Awaited<ReturnType<AuthResolver>>> {
  const workOsUserId = getInternalMcpSubject(env);
  if (!workOsUserId) {
    return { ok: false, code: "not_authenticated" } as const;
  }
  if (!db) {
    return { ok: false, code: "database_unavailable" } as const;
  }
  const actor = await db.getWebMemberByWorkOsUserId({ workosUserId: workOsUserId });
  if (!actor || actor.type !== "member") {
    return { ok: false, code: "forbidden" } as const;
  }
  return {
    ok: true,
    principal: {
      kind: "workos_access_token",
      identity: {
        workos_user_id: workOsUserId,
        email: actor.email,
        auth_surface: "mcp",
      },
      actor,
    },
  } as const;
}
