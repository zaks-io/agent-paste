import { createId } from "../../id.js";
import { defaultAutoDeletionDaysForWorkspace } from "../../policy.js";
import { toApiKeySummary } from "../../transforms.js";
import type { Workspace, WorkspaceMember } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import type { CommandActor, Entities } from "../ports.js";
import { PLATFORM_SCOPE } from "../core-helpers.js";
import { buildApiKey, DEFAULT_MEMBER_SCOPES, webAuthResponse } from "../shared.js";

async function provisionWebMember(
  ctx: RepositoryCoreContext,
  entities: Entities,
  input: { workosUserId: string; email: string },
  now: string,
) {
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: `${input.email.split("@")[0] ?? "user"}'s Workspace`,
    contact_email: input.email,
    plan: "free",
    plan_operator_override_at: null,
    auto_deletion_days: defaultAutoDeletionDaysForWorkspace({ plan: "free" }, ctx.billingEnabled()),
    revision_retention_days: null,
    created_at: now,
    updated_at: now,
  };
  await entities.workspaces.insert(workspace);
  const member: WorkspaceMember = {
    id: createId("mem"),
    workspace_id: workspace.id,
    workos_user_id: input.workosUserId,
    email: input.email,
    scopes: [...DEFAULT_MEMBER_SCOPES],
    created_at: now,
    last_seen_at: now,
  };
  await entities.members.insert(member);
  const { apiKey, secret } = await buildApiKey(ctx.options, {
    workspaceId: workspace.id,
    name: "Default",
    now,
    expiresAt: null,
  });
  await entities.apiKeys.insert(apiKey);
  await entities.operationEvents.insert({
    actorType: "system",
    actorId: "web-auth",
    action: "workspace.created",
    targetType: "workspace",
    targetId: workspace.id,
    workspaceId: workspace.id,
    details: {},
    occurredAt: now,
  });
  await entities.operationEvents.insert({
    actorType: "system",
    actorId: "web-auth",
    action: "api_key.created",
    targetType: "api_key",
    targetId: apiKey.id,
    workspaceId: workspace.id,
    details: { name: apiKey.name, public_id: apiKey.public_id },
    occurredAt: now,
  });
  return webAuthResponse(workspace, member, { api_key: toApiKeySummary(apiKey), secret });
}

export async function resolveWebMember(
  ctx: RepositoryCoreContext,
  input: { workosUserId: string; email: string; idempotencyKey: string; now?: string },
) {
  const now = input.now ?? new Date().toISOString();
  const actor: CommandActor = { type: "system", id: "web-auth", workspaceId: null };
  return ctx.uow.command(
    { actor, operation: "web.member.callback", idempotencyKey: input.idempotencyKey, scope: PLATFORM_SCOPE, now },
    async (entities, uowCtx) => {
      const existing = await entities.members.findByWorkOsUserId(input.workosUserId);
      if (existing) {
        const member = await entities.members.updateSeen(existing.id, { email: input.email, lastSeenAt: now });
        const resolved = member ?? existing;
        const workspace = await ctx.mustWorkspace(entities, resolved.workspace_id);
        return webAuthResponse(workspace, resolved, null);
      }
      return uowCtx.command(
        { actor, operation: "web.member.provision", idempotencyKey: `workos-user:${input.workosUserId}`, now },
        (provisionEntities) => provisionWebMember(ctx, provisionEntities, input, now),
      );
    },
  );
}

export async function getWebMemberByWorkOsUserId(ctx: RepositoryCoreContext, input: { workosUserId: string }) {
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const existing = await entities.members.findByWorkOsUserId(input.workosUserId);
    if (!existing) {
      return null;
    }
    return {
      type: "member" as const,
      id: existing.id,
      workspace_id: existing.workspace_id,
      email: existing.email,
      scopes: existing.scopes,
    };
  });
}

export async function ensureWebMember(
  ctx: RepositoryCoreContext,
  input: { workosUserId: string; email: string; now?: string },
) {
  const existing = await getWebMemberByWorkOsUserId(ctx, { workosUserId: input.workosUserId });
  if (existing) {
    return existing;
  }
  const provisioned = await resolveWebMember(ctx, {
    workosUserId: input.workosUserId,
    email: input.email,
    idempotencyKey: `cli-auth:${input.workosUserId}`,
    ...(input.now ? { now: input.now } : {}),
  });
  const member = provisioned.workspace_member;
  return {
    type: "member" as const,
    id: member.id,
    workspace_id: member.workspace_id,
    email: member.email,
    scopes: member.scopes,
  };
}
