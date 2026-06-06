import { parseApiKey, verifyApiKeySecret } from "../../api-keys.js";
import { defaultAutoDeletionDaysForWorkspace, type UsagePolicyConfig } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import { toApiKeySummary, toArtifactSummary, toWorkspaceDetail, toWorkspaceSummary } from "../../transforms.js";
import type { AdminActor, ApiActor, ApiKeyActor, Workspace } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import {
  adminCommandActor,
  isApiKeyExpired,
  nowIso,
  PLATFORM_SCOPE,
  workspaceCommandActor,
  workspaceScope,
} from "../core-helpers.js";
import { buildApiKey } from "../shared.js";
import { insertArtifactAuditEvent, toDeletedArtifactResult } from "./artifact-workflow-helpers.js";

export async function createWorkspace(
  ctx: RepositoryCoreContext,
  input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  },
): Promise<Workspace> {
  const now = nowIso(input.now);
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: input.name ?? input.email.split("@")[0] ?? "workspace",
    contact_email: input.email,
    plan: "free",
    plan_operator_override_at: null,
    claimed_at: now,
    auto_deletion_days: defaultAutoDeletionDaysForWorkspace({ plan: "free" }, ctx.billingEnabled()),
    revision_retention_days: null,
    created_at: now,
    updated_at: now,
  };
  return ctx.uow.command(
    {
      actor: adminCommandActor(input.actor, null),
      operation: "admin.workspace.create",
      idempotencyKey: input.idempotencyKey,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      await entities.workspaces.insert(workspace);
      await entities.operationEvents.insert({
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: "workspace.created",
        targetType: "workspace",
        targetId: workspace.id,
        workspaceId: workspace.id,
        details: { email: input.email },
        occurredAt: now,
      });
      return workspace;
    },
  );
}

export async function listWorkspaces(ctx: RepositoryCoreContext) {
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const rows = await entities.workspaces.listAll();
    return { data: rows.map(toWorkspaceDetail), page_info: { next_cursor: null, has_more: false } };
  });
}

export async function createApiKey(
  ctx: RepositoryCoreContext,
  input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
    now?: Date;
  },
) {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: adminCommandActor(input.actor, input.workspaceId),
      operation: "admin.api_key.create",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.workspaceId),
      now,
    },
    async (entities) => {
      await ctx.mustWorkspace(entities, input.workspaceId);
      const { apiKey, secret } = await buildApiKey(ctx.options, {
        workspaceId: input.workspaceId,
        name: input.name,
        now,
        expiresAt: null,
      });
      await entities.apiKeys.insert(apiKey);
      await entities.operationEvents.insert({
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: "api_key.created",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: apiKey.workspace_id,
        details: { name: apiKey.name, public_id: apiKey.public_id },
        occurredAt: now,
      });
      return { api_key: toApiKeySummary(apiKey), secret };
    },
  );
}

export async function revokeApiKey(
  ctx: RepositoryCoreContext,
  input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string; now?: Date },
) {
  const revokedAt = nowIso(input.now);
  const apiKey = await ctx.uow.read(PLATFORM_SCOPE, (entities) => ctx.mustApiKey(entities, input.apiKeyId));
  return ctx.uow.command(
    {
      actor: adminCommandActor(input.actor, apiKey.workspace_id),
      operation: "admin.api_key.revoke",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(apiKey.workspace_id),
      now: revokedAt,
    },
    async (entities) => {
      await entities.apiKeys.updateRevokedAt(input.apiKeyId, revokedAt);
      await entities.operationEvents.insert({
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: apiKey.workspace_id,
        details: { public_id: apiKey.public_id },
        occurredAt: revokedAt,
      });
      return { api_key: toApiKeySummary({ ...apiKey, revoked_at: revokedAt }), revoked_at: revokedAt };
    },
  );
}

export async function verifyApiKey(ctx: RepositoryCoreContext, apiKeySecret: string): Promise<ApiKeyActor | null> {
  const parsed = parseApiKey(apiKeySecret);
  if (!parsed) {
    return null;
  }
  const record = await ctx.uow.read(PLATFORM_SCOPE, (entities) => entities.apiKeys.findByPublicId(parsed.publicId));
  if (!record || record.revoked_at || isApiKeyExpired(record)) {
    return null;
  }
  const pepper = ctx.pepperForRecord(record.pepper_kid);
  if (!pepper) {
    return null;
  }
  const ok = await verifyApiKeySecret(apiKeySecret, record.public_id, record.secret_hmac, pepper);
  if (!ok) {
    return null;
  }
  const lockdown = await ctx.uow.read(PLATFORM_SCOPE, (entities) =>
    entities.platformLockdowns.findEffective("workspace", record.workspace_id),
  );
  if (lockdown) {
    return null;
  }
  await ctx.uow.read(workspaceScope(record.workspace_id), (entities) =>
    entities.apiKeys.updateLastUsedAt(record.id, new Date().toISOString()),
  );
  return {
    type: "api_key",
    id: record.id,
    workspace_id: record.workspace_id,
    scopes: record.scopes,
    expires_at: record.expires_at,
  };
}

export async function getWhoami(ctx: RepositoryCoreContext, actor: ApiKeyActor) {
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const apiKey = await ctx.mustApiKey(entities, actor.id);
    const workspace = await ctx.mustWorkspace(entities, apiKey.workspace_id);
    return {
      actor: { type: "api_key", id: apiKey.id, name: apiKey.name },
      workspace: toWorkspaceSummary(workspace),
      scopes: apiKey.scopes,
      usage_policy: ctx.usagePolicyFor(workspace),
    };
  });
}

export async function getUsagePolicy(ctx: RepositoryCoreContext, actor: ApiKeyActor): Promise<UsagePolicyConfig> {
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const workspace = await ctx.mustWorkspace(entities, actor.workspace_id);
    return ctx.usagePolicyFor(workspace);
  });
}

async function peekWorkspaceReplay(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; operation: string; idempotencyKey: string },
) {
  return ctx.uow.peekReplay<unknown>({
    actor: workspaceCommandActor(input.actor),
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    scope: workspaceScope(input.actor.workspace_id),
  });
}

export const peekIdempotentReplay = peekWorkspaceReplay;

export const peekWorkspaceCommandReplay = peekWorkspaceReplay;

export async function listArtifacts(ctx: RepositoryCoreContext, workspaceId?: string, status?: string) {
  const scope = workspaceId ? workspaceScope(workspaceId) : PLATFORM_SCOPE;
  return ctx.uow.read(scope, async (entities) => {
    const rows = await entities.artifacts.listFiltered(workspaceId, status);
    return { data: rows.map(toArtifactSummary), page_info: { next_cursor: null, has_more: false } };
  });
}

export async function getArtifactDetail(ctx: RepositoryCoreContext, artifactId: string) {
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId);
    if (!artifact) {
      return null;
    }
    const revisionId = artifact.revision_id;
    const files = revisionId ? await entities.artifactFiles.listForArtifact(artifact.id, revisionId) : [];
    const eventIds = await entities.operationEvents.listIdsForTarget(artifact.id);
    return {
      ...toArtifactSummary(artifact),
      workspace_id: artifact.workspace_id,
      files: files.map(({ path, size_bytes, content_type, uploaded_at }) => ({
        path,
        size_bytes,
        content_type,
        uploaded_at: uploaded_at ?? artifact.created_at,
      })),
      operation_event_ids: eventIds,
    };
  });
}

export async function deleteArtifact(
  ctx: RepositoryCoreContext,
  input: { actor: AdminActor; idempotencyKey: string; artifactId: string; now?: Date },
) {
  const deletedAt = nowIso(input.now);
  const target = await ctx.uow.read(PLATFORM_SCOPE, (entities) => entities.artifacts.findById(input.artifactId));
  if (!target) {
    repositoryError("artifact_not_found");
  }
  return ctx.uow.command(
    {
      actor: adminCommandActor(input.actor, target.workspace_id),
      operation: "admin.artifact.delete",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(target.workspace_id),
      now: deletedAt,
    },
    async (entities) => {
      const artifact = await entities.artifacts.findById(input.artifactId);
      if (!artifact) {
        repositoryError("artifact_not_found");
      }
      await entities.artifacts.markDeleted(artifact.id, deletedAt);
      await insertArtifactAuditEvent(entities, {
        actor: input.actor,
        action: "artifact.deleted",
        artifact,
        occurredAt: deletedAt,
      });
      return toDeletedArtifactResult(artifact, deletedAt);
    },
  );
}

export async function listOperationEvents(ctx: RepositoryCoreContext) {
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const data = await entities.operationEvents.listAll();
    return { data, page_info: { next_cursor: null, has_more: false } };
  });
}

export async function forceExpireArtifact(
  ctx: RepositoryCoreContext,
  input: { artifactId: string; expiresAt: string },
) {
  return ctx.uow.read(PLATFORM_SCOPE, (entities) => entities.artifacts.updateExpiry(input.artifactId, input.expiresAt));
}
