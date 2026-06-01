import type { WorkOsIdentity } from "@agent-paste/auth";
import { Seconds } from "@agent-paste/contracts";
import type { ApiActor, ApiKeyActor, Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";
import { apiKeyActor } from "../principals.js";
import { errorResponse, jsonResponse } from "../responses.js";

export const CLI_API_KEY_TTL_SECONDS = Seconds.ninetyDays;

export async function whoami(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "api_key") {
    return errorResponse(context, "not_authenticated");
  }
  const actor = principal.actor as ApiKeyActor;

  return jsonResponse(context, await db.getWhoami(actor));
}

export async function mcpWhoami(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "workos_access_token" || !principal.actor || principal.actor.type !== "member") {
    return errorResponse(context, "not_authenticated");
  }
  const identity = principal.identity as WorkOsIdentity;
  const actor = principal.actor as Extract<ApiActor, { type: "member" }>;
  const workspace = await db.getWebWorkspace(actor);
  return jsonResponse(context, {
    workspace_member: {
      id: actor.id,
      email: identity.email ?? actor.email,
    },
    workspace: workspace.workspace,
    scopes: [...(identity.mcp_scopes ?? [])],
  });
}

export async function getUsagePolicy(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = apiKeyActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  if (!db.getUsagePolicy) {
    return errorResponse(context, "database_unavailable");
  }
  return jsonResponse(context, await db.getUsagePolicy(actor));
}

export async function revokeCurrentApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = apiKeyActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  if (!db.revokeCurrentApiKey) {
    return errorResponse(context, "database_unavailable");
  }
  try {
    return jsonResponse(context, await db.revokeCurrentApiKey({ actor }));
  } catch (error) {
    if (error instanceof Error && error.message === "api_key_not_found") {
      return errorResponse(context, "not_authenticated");
    }
    throw error;
  }
}
