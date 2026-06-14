import type { WorkOsIdentity } from "@agent-paste/auth";
import { Seconds } from "@agent-paste/contracts";
import type { ApiActor, ApiKeyActor, Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";
import { apiKeyActor } from "../principals.js";
import { executeRepositoryRoute } from "../responses.js";
import { enrichUsagePolicyWithWriteAllowance } from "../usage-policy-enrichment.js";

export const CLI_API_KEY_TTL_SECONDS = Seconds.ninetyDays;

export async function whoami(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "api_key") {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const actor = principal.actor as ApiKeyActor;

  const whoami = await db.getWhoami(actor);
  const usagePolicy = whoami.usage_policy
    ? await enrichUsagePolicyWithWriteAllowance(whoami.usage_policy, {
        workspaceId: actor.workspace_id,
        writeAllowance: context.env.WRITE_ALLOWANCE,
      })
    : whoami.usage_policy;
  return getBoundResponders(context).respondJson({
    ...whoami,
    usage_policy: usagePolicy,
  });
}

export async function mcpWhoami(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  if (principal.kind !== "workos_access_token" || !principal.actor || principal.actor.type !== "member") {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const identity = principal.identity as WorkOsIdentity;
  const actor = principal.actor as Extract<ApiActor, { type: "member" }>;
  const workspace = await db.getWebWorkspace(actor);
  return getBoundResponders(context).respondJson({
    workspace_member: {
      id: actor.id,
      email: identity.email ?? actor.email,
    },
    workspace: workspace.workspace,
    // One scope vocabulary: a member's MCP scopes are their stored API scopes verbatim.
    scopes: actor.scopes,
  });
}

export async function getUsagePolicy(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = apiKeyActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  if (!db.getUsagePolicy) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  const policy = await db.getUsagePolicy(actor);
  return getBoundResponders(context).respondJson(
    await enrichUsagePolicyWithWriteAllowance(policy, {
      workspaceId: actor.workspace_id,
      writeAllowance: context.env.WRITE_ALLOWANCE,
    }),
  );
}

export async function revokeCurrentApiKey(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = apiKeyActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  if (!db.revokeCurrentApiKey) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  return executeRepositoryRoute(context, () => db.revokeCurrentApiKey({ actor }));
}
