import { autoDeletionBoundsForWorkspace, type UsagePolicyConfig } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import { toApiKeySummary, toWorkspaceSummary } from "../../transforms.js";
import type { ApiActor, ApiKeyActor, Workspace } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { apiCommandActor, expiresAtFromSeconds, memberCommandActor, nowIso, workspaceScope } from "../core-helpers.js";
import { buildApiKey, toWorkspaceMemberSummary } from "../shared.js";
import {
  decodeWebAuditCursor,
  encodeWebAuditCursor,
  normalizeWebArtifactLimit,
  normalizeWebAuditLimit,
  toWebArtifactRow,
  toWebAuditRow,
} from "../web-transforms.js";
import { insertArtifactAuditEvent, mustActiveArtifact, readWebArtifactPage } from "./artifact-workflow-helpers.js";

function toWebSettings(workspace: Workspace, usagePolicy: UsagePolicyConfig, billingEnabled: boolean) {
  const bounds = autoDeletionBoundsForWorkspace(workspace, billingEnabled);
  return {
    workspace_name: workspace.name,
    auto_deletion_days: workspace.auto_deletion_days,
    auto_deletion_bounds: { min_days: bounds.min, max_days: bounds.max },
    usage_policy: { artifacts_per_day: 0, bytes_per_day: usagePolicy.artifact_size_cap_bytes },
  };
}

export async function getWebWorkspace(ctx: RepositoryCoreContext, actor: ApiActor) {
  if (actor.type !== "member") {
    repositoryError("unexpected_actor_type");
  }
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const member = await ctx.mustMember(entities, actor.id);
    const workspace = await ctx.mustWorkspace(entities, member.workspace_id);
    return {
      workspace: toWorkspaceSummary(workspace),
      workspace_member: toWorkspaceMemberSummary(member),
      usage_policy: ctx.usagePolicyFor(workspace),
      default_key_first_run: false,
    };
  });
}

export async function listWebArtifacts(
  ctx: RepositoryCoreContext,
  actor: ApiActor,
  pagination: { cursor?: string; limit?: number } = {},
) {
  const limit = normalizeWebArtifactLimit(pagination.limit);
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const { page, page_info } = await readWebArtifactPage(entities, {
      workspaceId: actor.workspace_id,
      limit,
      ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
    });
    return {
      items: page.map(toWebArtifactRow),
      page_info,
    };
  });
}

export async function getWebArtifact(ctx: RepositoryCoreContext, actor: ApiActor, artifactId: string) {
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId, actor.workspace_id);
    if (!artifact) {
      return null;
    }
    return ctx.webArtifactDetailFromArtifact(entities, artifact, actor.workspace_id);
  });
}

export async function pinWebArtifact(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date },
) {
  if (input.actor.type !== "member") {
    repositoryError("unexpected_actor_type");
  }
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: memberCommandActor(input.actor),
      operation: "web.artifact.pin",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const member = await ctx.mustMember(entities, input.actor.id);
      const artifact = await mustActiveArtifact(entities, {
        artifactId: input.artifactId,
        workspaceId: member.workspace_id,
        requirePublishedRevision: true,
      });
      if (artifact.pinned_at) {
        return ctx.webArtifactDetailFromArtifact(entities, artifact, member.workspace_id);
      }
      const workspace = await ctx.mustWorkspace(entities, member.workspace_id);
      const pinResult = await entities.artifacts.tryPinUnderCap(
        member.workspace_id,
        artifact.id,
        now,
        now,
        ctx.usagePolicyFor(workspace).live_artifacts_cap,
      );
      if (pinResult === "cap_exceeded") {
        repositoryError("pinned_artifact_cap_exceeded");
      }
      if (pinResult === "not_found") {
        repositoryError("artifact_not_found");
      }
      await insertArtifactAuditEvent(entities, {
        actor: input.actor,
        action: "artifact.pinned",
        artifact,
        occurredAt: now,
      });
      const updated = await entities.artifacts.findById(artifact.id, member.workspace_id);
      if (!updated) {
        repositoryError("artifact_not_found");
      }
      return ctx.webArtifactDetailFromArtifact(entities, updated, member.workspace_id);
    },
  );
}

export async function unpinWebArtifact(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date },
) {
  if (input.actor.type !== "member") {
    repositoryError("unexpected_actor_type");
  }
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: memberCommandActor(input.actor),
      operation: "web.artifact.unpin",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const member = await ctx.mustMember(entities, input.actor.id);
      const artifact = await mustActiveArtifact(entities, {
        artifactId: input.artifactId,
        workspaceId: member.workspace_id,
      });
      if (!artifact.pinned_at) {
        return ctx.webArtifactDetailFromArtifact(entities, artifact, member.workspace_id);
      }
      await entities.artifacts.setPinnedAt(artifact.id, null, now);
      await insertArtifactAuditEvent(entities, {
        actor: input.actor,
        action: "artifact.unpinned",
        artifact,
        occurredAt: now,
      });
      const updated = await entities.artifacts.findById(artifact.id, member.workspace_id);
      if (!updated) {
        repositoryError("artifact_not_found");
      }
      return ctx.webArtifactDetailFromArtifact(entities, updated, member.workspace_id);
    },
  );
}

export async function listWebApiKeys(ctx: RepositoryCoreContext, actor: ApiActor) {
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const rows = await entities.apiKeys.listForWorkspace(actor.workspace_id);
    return {
      items: rows.map((apiKey) => ({
        ...toApiKeySummary(apiKey),
        revoked: apiKey.revoked_at !== null,
      })),
      page_info: { next_cursor: null, has_more: false },
    };
  });
}

export async function createWebApiKey(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    name: string;
    expiresInSeconds?: number;
    now?: Date;
  },
) {
  if (input.actor.type !== "member") {
    repositoryError("unexpected_actor_type");
  }
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: memberCommandActor(input.actor),
      operation: "web.api_key.create",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const member = await ctx.mustMember(entities, input.actor.id);
      const { apiKey, secret } = await buildApiKey(ctx.options, {
        workspaceId: member.workspace_id,
        name: input.name,
        now,
        expiresAt: expiresAtFromSeconds(now, input.expiresInSeconds),
      });
      await entities.apiKeys.insert(apiKey);
      await entities.operationEvents.insert({
        actorType: "member",
        actorId: member.id,
        action: "api_key.created",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: member.workspace_id,
        details: { name: apiKey.name, public_id: apiKey.public_id },
        occurredAt: now,
      });
      return { api_key: toApiKeySummary(apiKey), secret };
    },
  );
}

export async function revokeCurrentApiKey(ctx: RepositoryCoreContext, input: { actor: ApiKeyActor; now?: Date }) {
  const revokedAt = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: apiCommandActor(input.actor),
      operation: "api_key.revoke_current",
      idempotencyKey: `self-revoke:${input.actor.id}`,
      scope: workspaceScope(input.actor.workspace_id),
      now: revokedAt,
    },
    async (entities) => {
      const apiKey = await entities.apiKeys.findById(input.actor.id);
      if (!apiKey || apiKey.workspace_id !== input.actor.workspace_id) {
        repositoryError("current_api_key_not_found");
      }
      await entities.apiKeys.updateRevokedAt(apiKey.id, revokedAt);
      await entities.operationEvents.insert({
        actorType: "api_key",
        actorId: apiKey.id,
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: apiKey.workspace_id,
        details: { public_id: apiKey.public_id, self_revoked: true },
        occurredAt: revokedAt,
      });
      return { api_key: toApiKeySummary({ ...apiKey, revoked_at: revokedAt }), revoked_at: revokedAt };
    },
  );
}

export async function revokeWebApiKey(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; idempotencyKey: string; apiKeyId: string; now?: Date },
) {
  if (input.actor.type !== "member") {
    repositoryError("unexpected_actor_type");
  }
  const revokedAt = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: memberCommandActor(input.actor),
      operation: "web.api_key.revoke",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now: revokedAt,
    },
    async (entities) => {
      const member = await ctx.mustMember(entities, input.actor.id);
      const apiKey = await entities.apiKeys.findById(input.apiKeyId);
      if (!apiKey || apiKey.workspace_id !== member.workspace_id) {
        repositoryError("not_found");
      }
      await entities.apiKeys.updateRevokedAt(input.apiKeyId, revokedAt);
      await entities.operationEvents.insert({
        actorType: "member",
        actorId: member.id,
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: member.workspace_id,
        details: { public_id: apiKey.public_id },
        occurredAt: revokedAt,
      });
      return { api_key: toApiKeySummary({ ...apiKey, revoked_at: revokedAt }), revoked_at: revokedAt };
    },
  );
}

export async function listWebAuditEvents(
  ctx: RepositoryCoreContext,
  actor: ApiActor,
  pagination: { cursor?: string; limit?: number } = {},
) {
  const limit = normalizeWebAuditLimit(pagination.limit);
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const rows = await entities.operationEvents.listWebPage({
      workspaceId: actor.workspace_id,
      limit: limit + 1,
      ...(pagination.cursor ? { cursor: decodeWebAuditCursor(pagination.cursor) } : {}),
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toWebAuditRow),
      page_info: {
        next_cursor: rows.length > limit && last ? encodeWebAuditCursor(last) : null,
        has_more: rows.length > limit,
      },
    };
  });
}

export async function getWebSettings(ctx: RepositoryCoreContext, actor: ApiActor) {
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const workspace = await ctx.mustWorkspace(entities, actor.workspace_id);
    return toWebSettings(workspace, ctx.usagePolicyFor(workspace), ctx.billingEnabled());
  });
}

export async function updateWebSettings(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    workspaceName: string;
    autoDeletionDays: number;
    now?: Date;
  },
) {
  if (input.actor.type !== "member") {
    repositoryError("unexpected_actor_type");
  }
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: memberCommandActor(input.actor),
      operation: "web.settings.update",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const member = await ctx.mustMember(entities, input.actor.id);
      const workspace = await ctx.mustWorkspace(entities, member.workspace_id);
      const { min, max } = autoDeletionBoundsForWorkspace(workspace, ctx.billingEnabled());
      if (input.autoDeletionDays < min || input.autoDeletionDays > max) {
        repositoryError("invalid_auto_deletion_days");
      }
      await entities.workspaces.update(member.workspace_id, {
        name: input.workspaceName,
        autoDeletionDays: input.autoDeletionDays,
        updatedAt: now,
      });
      await entities.operationEvents.insert({
        actorType: "member",
        actorId: member.id,
        action: "workspace.settings.updated",
        targetType: "workspace",
        targetId: member.workspace_id,
        workspaceId: member.workspace_id,
        details: { workspace_name: input.workspaceName, auto_deletion_days: input.autoDeletionDays },
        occurredAt: now,
      });
      const updatedWorkspace = await ctx.mustWorkspace(entities, member.workspace_id);
      return toWebSettings(updatedWorkspace, ctx.usagePolicyFor(updatedWorkspace), ctx.billingEnabled());
    },
  );
}
