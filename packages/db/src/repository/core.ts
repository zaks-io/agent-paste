import { buildAgentView, buildFinalizeResult, buildPublishResult, inferRenderMode } from "../agent-view.js";
import { parseApiKey, verifyApiKeySecret } from "../api-keys.js";
import { createId } from "../id.js";
import {
  DEFAULT_AUTO_DELETION_DAYS,
  DEFAULT_UPLOAD_SESSION_TTL_MS,
  MAX_AUTO_DELETION_DAYS,
  MIN_AUTO_DELETION_DAYS,
  PINNED_ARTIFACT_CAP,
  USAGE_POLICY,
} from "../policy.js";
import { toRevisionSummary } from "../queries/revisions.js";
import { resolveAccessLinkFromEntities } from "../resolve-access-link.js";
import {
  toApiKeySummary,
  toArtifactSummary,
  toUploadSessionRecord,
  toWorkspaceDetail,
  toWorkspaceSummary,
} from "../transforms.js";
import type {
  AdminActor,
  ApiActor,
  ApiKeyActor,
  Artifact,
  PlatformActor,
  PlatformLockdown,
  RepositoryOptions,
  Revision,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "../types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "../validation.js";
import type { Repository } from "./interface.js";
import { type OperatorEventFilters, resolveOperatorEventActions } from "./operator-event-filters.js";
import type { CommandActor, Entities, RunScope, UnitOfWork } from "./ports.js";
import { buildApiKey, DEFAULT_MEMBER_SCOPES, toWorkspaceMemberSummary, webAuthResponse } from "./shared.js";
import {
  decodeLockdownCursor,
  decodeWebArtifactCursor,
  decodeWebAuditCursor,
  encodeLockdownCursor,
  encodeWebArtifactCursor,
  encodeWebAuditCursor,
  normalizeLockdownLimit,
  normalizeWebArtifactLimit,
  normalizeWebAuditLimit,
  toWebArtifactRow,
  toWebAuditRow,
  toWebOperatorEventRow,
} from "./web-transforms.js";

const PLATFORM_SCOPE: RunScope = { kind: "platform" };

function workspaceScope(workspaceId: string): RunScope {
  return { kind: "workspace", workspaceId };
}

function apiCommandActor(actor: ApiActor): CommandActor {
  if (actor.type !== "api_key") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: "api_key", id: actor.id, workspaceId: actor.workspace_id };
}

function memberCommandActor(actor: ApiActor): CommandActor {
  if (actor.type !== "member") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: "member", id: actor.id, workspaceId: actor.workspace_id };
}

function adminCommandActor(actor: AdminActor, workspaceId: string | null): CommandActor {
  return { type: actor.type, id: actor.id, workspaceId };
}

function platformCommandActor(actor: PlatformActor): CommandActor {
  return { type: "platform", id: actor.id, workspaceId: null };
}

function toLockdownDetail(lockdown: PlatformLockdown) {
  return {
    scope: lockdown.scope,
    target_id: lockdown.target_id,
    reason_code: lockdown.reason_code,
    set_at: lockdown.set_at,
    set_by: lockdown.set_by,
    lifted_at: lockdown.lifted_at,
    lifted_by: lockdown.lifted_by,
  };
}

function nowIso(value?: Date): string {
  return (value ?? new Date()).toISOString();
}

function toWebSettings(workspace: Workspace) {
  return {
    workspace_name: workspace.name,
    auto_deletion_days: workspace.auto_deletion_days,
    usage_policy: { artifacts_per_day: 0, bytes_per_day: USAGE_POLICY.artifact_size_cap_bytes },
  };
}

// Backend-agnostic domain orchestration. Every method delegates storage to the
// scope-bound Entities accessor and durability to the UnitOfWork. The Postgres and
// local adapters supply those ports; this class holds the one copy of the logic.
export class RepositoryCore implements Repository {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly options: RepositoryOptions,
  ) {}

  private pepperForRecord(pepperKid: number): string | undefined {
    if (this.options.pepperRing) {
      return this.options.pepperRing.pepperForKid(pepperKid);
    }
    return pepperKid === 1 ? this.options.apiKeyPepper : undefined;
  }

  async createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace> {
    const now = nowIso(input.now);
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: input.name ?? input.email.split("@")[0] ?? "workspace",
      contact_email: input.email,
      auto_deletion_days: DEFAULT_AUTO_DELETION_DAYS,
      revision_retention_days: null,
      created_at: now,
      updated_at: now,
    };
    return this.uow.command(
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

  async listWorkspaces() {
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const rows = await entities.workspaces.listAll();
      return { data: rows.map(toWorkspaceDetail), page_info: { next_cursor: null, has_more: false } };
    });
  }

  async createApiKey(input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
    now?: Date;
  }) {
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: adminCommandActor(input.actor, input.workspaceId),
        operation: "admin.api_key.create",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.workspaceId),
        now,
      },
      async (entities) => {
        await this.mustWorkspace(entities, input.workspaceId);
        const { apiKey, secret } = await buildApiKey(this.options, {
          workspaceId: input.workspaceId,
          name: input.name,
          now,
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

  async revokeApiKey(input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    const revokedAt = nowIso(input.now);
    const apiKey = await this.uow.read(PLATFORM_SCOPE, (entities) => this.mustApiKey(entities, input.apiKeyId));
    return this.uow.command(
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

  async verifyApiKey(apiKeySecret: string): Promise<ApiKeyActor | null> {
    const parsed = parseApiKey(apiKeySecret);
    if (!parsed) {
      return null;
    }
    const record = await this.uow.read(PLATFORM_SCOPE, (entities) => entities.apiKeys.findByPublicId(parsed.publicId));
    if (!record || record.revoked_at) {
      return null;
    }
    const pepper = this.pepperForRecord(record.pepper_kid);
    if (!pepper) {
      return null;
    }
    const ok = await verifyApiKeySecret(apiKeySecret, record.public_id, record.secret_hmac, pepper);
    if (!ok) {
      return null;
    }
    await this.uow.read(workspaceScope(record.workspace_id), (entities) =>
      entities.apiKeys.updateLastUsedAt(record.id, new Date().toISOString()),
    );
    return { type: "api_key", id: record.id, workspace_id: record.workspace_id, scopes: record.scopes };
  }

  async getWhoami(actor: ApiKeyActor) {
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
      const apiKey = await this.mustApiKey(entities, actor.id);
      const workspace = await this.mustWorkspace(entities, apiKey.workspace_id);
      return {
        actor: { type: "api_key", id: apiKey.id, name: apiKey.name },
        workspace: toWorkspaceSummary(workspace),
        scopes: apiKey.scopes,
        usage_policy: USAGE_POLICY,
      };
    });
  }

  async resolveWebMember(input: { workosUserId: string; email: string; idempotencyKey: string; now?: string }) {
    const now = input.now ?? new Date().toISOString();
    const actor: CommandActor = { type: "system", id: "web-auth", workspaceId: null };
    // Replay the exact callback response before branching on member existence; the
    // nested per-user command still serializes concurrent first provisioning.
    return this.uow.command(
      { actor, operation: "web.member.callback", idempotencyKey: input.idempotencyKey, scope: PLATFORM_SCOPE, now },
      async (entities, ctx) => {
        const existing = await entities.members.findByWorkOsUserId(input.workosUserId);
        if (existing) {
          const member = await entities.members.updateSeen(existing.id, { email: input.email, lastSeenAt: now });
          const resolved = member ?? existing;
          const workspace = await this.mustWorkspace(entities, resolved.workspace_id);
          return webAuthResponse(workspace, resolved, null);
        }
        // Keyed by WorkOS user, not token, so concurrent first-login callbacks cannot
        // create duplicate Personal Workspaces for the same user.
        return ctx.command(
          { actor, operation: "web.member.provision", idempotencyKey: `workos-user:${input.workosUserId}`, now },
          (provisionEntities) => this.provisionWebMember(provisionEntities, input, now),
        );
      },
    );
  }

  private async provisionWebMember(entities: Entities, input: { workosUserId: string; email: string }, now: string) {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: `${input.email.split("@")[0] ?? "user"}'s Workspace`,
      contact_email: input.email,
      auto_deletion_days: DEFAULT_AUTO_DELETION_DAYS,
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
    const { apiKey, secret } = await buildApiKey(this.options, { workspaceId: workspace.id, name: "Default", now });
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

  async getWebMemberByWorkOsUserId(input: { workosUserId: string }) {
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
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

  // The CLI is the only flow where a WorkOS identity can arrive without a prior
  // dashboard callback, so it provisions the same Personal Workspace + member on
  // first contact, then exposes the member as an actor. resolveWebMember
  // serializes concurrent first-logins per WorkOS user.
  async ensureWebMember(input: { workosUserId: string; email: string; now?: string }) {
    const existing = await this.getWebMemberByWorkOsUserId({ workosUserId: input.workosUserId });
    if (existing) {
      return existing;
    }
    const provisioned = await this.resolveWebMember({
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

  async getWebWorkspace(actor: ApiActor) {
    if (actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${actor.type}`);
    }
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
      const member = await this.mustMember(entities, actor.id);
      const workspace = await this.mustWorkspace(entities, member.workspace_id);
      return {
        workspace: toWorkspaceSummary(workspace),
        workspace_member: toWorkspaceMemberSummary(member),
        usage_policy: USAGE_POLICY,
        default_key_first_run: false,
      };
    });
  }

  async listWebArtifacts(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    const limit = normalizeWebArtifactLimit(pagination.limit);
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
      const rows = await entities.artifacts.listWebPage({
        workspaceId: actor.workspace_id,
        limit: limit + 1,
        ...(pagination.cursor ? { cursor: decodeWebArtifactCursor(pagination.cursor) } : {}),
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toWebArtifactRow),
        page_info: {
          next_cursor: rows.length > limit && last ? encodeWebArtifactCursor(last) : null,
          has_more: rows.length > limit,
        },
      };
    });
  }

  async getWebArtifact(actor: ApiActor, artifactId: string) {
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
      const artifact = await entities.artifacts.findById(artifactId, actor.workspace_id);
      if (!artifact) {
        return null;
      }
      return this.webArtifactDetailFromArtifact(entities, artifact, actor.workspace_id);
    });
  }

  async pinWebArtifact(input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: memberCommandActor(input.actor),
        operation: "web.artifact.pin",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now,
      },
      async (entities) => {
        const member = await this.mustMember(entities, input.actor.id);
        const artifact = await entities.artifacts.findById(input.artifactId, member.workspace_id);
        if (!artifact || artifact.status !== "active" || !artifact.revision_id) {
          throw new Error("artifact_not_found");
        }
        if (artifact.pinned_at) {
          return this.webArtifactDetailFromArtifact(entities, artifact, member.workspace_id);
        }
        const pinResult = await entities.artifacts.tryPinUnderCap(
          member.workspace_id,
          artifact.id,
          now,
          now,
          PINNED_ARTIFACT_CAP,
        );
        if (pinResult === "cap_exceeded") {
          throw new Error("pinned_artifact_cap_exceeded");
        }
        if (pinResult === "not_found") {
          throw new Error("artifact_not_found");
        }
        await entities.operationEvents.insert({
          actorType: "member",
          actorId: member.id,
          action: "artifact.pinned",
          targetType: "artifact",
          targetId: artifact.id,
          workspaceId: member.workspace_id,
          details: {},
          occurredAt: now,
        });
        const updated = await entities.artifacts.findById(artifact.id, member.workspace_id);
        if (!updated) {
          throw new Error("artifact_not_found");
        }
        return this.webArtifactDetailFromArtifact(entities, updated, member.workspace_id);
      },
    );
  }

  async unpinWebArtifact(input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: memberCommandActor(input.actor),
        operation: "web.artifact.unpin",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now,
      },
      async (entities) => {
        const member = await this.mustMember(entities, input.actor.id);
        const artifact = await entities.artifacts.findById(input.artifactId, member.workspace_id);
        if (!artifact || artifact.status !== "active") {
          throw new Error("artifact_not_found");
        }
        if (!artifact.pinned_at) {
          return this.webArtifactDetailFromArtifact(entities, artifact, member.workspace_id);
        }
        await entities.artifacts.setPinnedAt(artifact.id, null, now);
        await entities.operationEvents.insert({
          actorType: "member",
          actorId: member.id,
          action: "artifact.unpinned",
          targetType: "artifact",
          targetId: artifact.id,
          workspaceId: member.workspace_id,
          details: {},
          occurredAt: now,
        });
        const updated = await entities.artifacts.findById(artifact.id, member.workspace_id);
        if (!updated) {
          throw new Error("artifact_not_found");
        }
        return this.webArtifactDetailFromArtifact(entities, updated, member.workspace_id);
      },
    );
  }

  private async webArtifactDetailFromArtifact(entities: Entities, artifact: Artifact, workspaceId: string) {
    const revisionId = artifact.revision_id;
    let viewer: { iframe_src: string; render_mode: Revision["render_mode"] } | null = null;
    if (revisionId && artifact.status === "active") {
      const revision = await entities.revisions.findById(revisionId, workspaceId);
      if (revision && revision.status === "published") {
        const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
        const agentView = buildAgentView(artifact, revisionId, files, this.options.contentBaseUrl ?? "", revision);
        viewer = {
          iframe_src: agentView.view_url,
          render_mode: revision.render_mode,
        };
      }
    }
    return {
      ...toWebArtifactRow(artifact),
      entrypoint: artifact.entrypoint,
      file_count: artifact.file_count,
      size_bytes: artifact.size_bytes,
      viewer,
    };
  }

  async listWebApiKeys(actor: ApiActor) {
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
      const rows = await entities.apiKeys.listForWorkspace(actor.workspace_id);
      return {
        items: rows.map((apiKey) => ({
          ...toApiKeySummary(apiKey),
          expires_at: null,
          revoked: apiKey.revoked_at !== null,
        })),
        page_info: { next_cursor: null, has_more: false },
      };
    });
  }

  async createWebApiKey(input: { actor: ApiActor; idempotencyKey: string; name: string; now?: Date }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: memberCommandActor(input.actor),
        operation: "web.api_key.create",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now,
      },
      async (entities) => {
        const member = await this.mustMember(entities, input.actor.id);
        const { apiKey, secret } = await buildApiKey(this.options, {
          workspaceId: member.workspace_id,
          name: input.name,
          now,
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

  async revokeWebApiKey(input: { actor: ApiActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    const revokedAt = nowIso(input.now);
    return this.uow.command(
      {
        actor: memberCommandActor(input.actor),
        operation: "web.api_key.revoke",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now: revokedAt,
      },
      async (entities) => {
        const member = await this.mustMember(entities, input.actor.id);
        const apiKey = await entities.apiKeys.findById(input.apiKeyId);
        if (!apiKey || apiKey.workspace_id !== member.workspace_id) {
          throw new Error("api_key_not_found");
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

  async listWebAuditEvents(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    const limit = normalizeWebAuditLimit(pagination.limit);
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
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

  async getWebSettings(actor: ApiActor) {
    return this.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
      const workspace = await this.mustWorkspace(entities, actor.workspace_id);
      return toWebSettings(workspace);
    });
  }

  async updateWebSettings(input: {
    actor: ApiActor;
    idempotencyKey: string;
    workspaceName: string;
    autoDeletionDays: number;
    now?: Date;
  }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    // Fail closed in the core: the local adapter has no DB CHECK constraint, so a
    // direct repository call must not persist a value Postgres would reject.
    if (input.autoDeletionDays < MIN_AUTO_DELETION_DAYS || input.autoDeletionDays > MAX_AUTO_DELETION_DAYS) {
      throw new Error("invalid_auto_deletion_days");
    }
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: memberCommandActor(input.actor),
        operation: "web.settings.update",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now,
      },
      async (entities) => {
        const member = await this.mustMember(entities, input.actor.id);
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
        const workspace = await this.mustWorkspace(entities, member.workspace_id);
        return toWebSettings(workspace);
      },
    );
  }

  async listLockdowns(_actor: PlatformActor, pagination: { cursor?: string; limit?: number } = {}) {
    const limit = normalizeLockdownLimit(pagination.limit);
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const rows = await entities.platformLockdowns.listEffectivePage({
        limit: limit + 1,
        ...(pagination.cursor ? { cursor: decodeLockdownCursor(pagination.cursor) } : {}),
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toLockdownDetail),
        page_info: {
          next_cursor: rows.length > limit && last ? encodeLockdownCursor(last) : null,
          has_more: rows.length > limit,
        },
      };
    });
  }

  async listOperatorEvents(
    _actor: PlatformActor,
    input: OperatorEventFilters & { cursor?: string; limit?: number } = {},
  ) {
    const limit = normalizeWebAuditLimit(input.limit);
    const actions = resolveOperatorEventActions(input);
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const rows = await entities.operationEvents.listOperatorPage({
        limit: limit + 1,
        ...(input.cursor ? { cursor: decodeWebAuditCursor(input.cursor) } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.actorType ? { actorType: input.actorType } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(actions ? { actions } : {}),
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toWebOperatorEventRow),
        page_info: {
          next_cursor: rows.length > limit && last ? encodeWebAuditCursor(last) : null,
          has_more: rows.length > limit,
        },
      };
    });
  }

  async setLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: "workspace" | "artifact";
    targetId: string;
    reasonCode: string;
    now?: Date;
  }) {
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: platformCommandActor(input.actor),
        operation: "platform.lockdown.set",
        idempotencyKey: input.idempotencyKey,
        scope: PLATFORM_SCOPE,
        now,
      },
      async (entities) => {
        // One effective row per target: an existing lockdown is a no-op replay.
        const existing = await entities.platformLockdowns.findEffective(input.scope, input.targetId);
        if (existing) {
          return toLockdownDetail(existing);
        }
        const lockdown: PlatformLockdown = {
          id: createId("lkd"),
          scope: input.scope,
          target_id: input.targetId,
          reason_code: input.reasonCode,
          set_at: now,
          set_by: input.actor.id,
          lifted_at: null,
          lifted_by: null,
        };
        // A concurrent setter can win the partial-unique index between the
        // findEffective check and this insert; treat the loss as a replay.
        const inserted = await entities.platformLockdowns.insert(lockdown);
        if (!inserted) {
          const winner = await entities.platformLockdowns.findEffective(input.scope, input.targetId);
          if (winner) {
            return toLockdownDetail(winner);
          }
          // Insert was rejected but no effective row exists: an inconsistent
          // state we must not paper over with a misleading audit event.
          throw new Error("lockdown_insert_conflict");
        }
        await entities.operationEvents.insert({
          actorType: "platform",
          actorId: input.actor.id,
          action: "platform.lockdown.set",
          targetType: input.scope,
          targetId: input.targetId,
          workspaceId: null,
          details: { scope: input.scope, reason_code: input.reasonCode },
          occurredAt: now,
        });
        return toLockdownDetail(lockdown);
      },
    );
  }

  async liftLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: "workspace" | "artifact";
    targetId: string;
    now?: Date;
  }) {
    const now = nowIso(input.now);
    return this.uow.command(
      {
        actor: platformCommandActor(input.actor),
        operation: "platform.lockdown.lift",
        idempotencyKey: input.idempotencyKey,
        scope: PLATFORM_SCOPE,
        now,
      },
      async (entities) => {
        const existing = await entities.platformLockdowns.findEffective(input.scope, input.targetId);
        if (!existing) {
          throw new Error("not_found");
        }
        // Lost a concurrent lift race: the row is already lifted, so emit no
        // duplicate audit event and report it as already gone.
        const lifted = await entities.platformLockdowns.markLifted(existing.id, {
          liftedAt: now,
          liftedBy: input.actor.id,
        });
        if (!lifted) {
          throw new Error("not_found");
        }
        await entities.operationEvents.insert({
          actorType: "platform",
          actorId: input.actor.id,
          action: "platform.lockdown.lifted",
          targetType: input.scope,
          targetId: input.targetId,
          workspaceId: null,
          details: { scope: input.scope, reason_code: existing.reason_code },
          occurredAt: now,
        });
        return toLockdownDetail({ ...existing, lifted_at: now, lifted_by: input.actor.id });
      },
    );
  }

  async createUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    request: {
      artifact_id?: string;
      title?: string;
      ttl_seconds?: number;
      entrypoint?: string;
      files: Array<{ path: string; size_bytes: number }>;
    };
    now: string;
  }) {
    return this.uow.command(
      {
        actor: apiCommandActor(input.actor),
        operation: "upload.session.create",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now: input.now,
      },
      async (entities) => {
        const files = input.request.files.map((file) => ({ ...file, path: normalizeStoragePath(file.path) }));
        const isUpdate = Boolean(input.request.artifact_id);
        let baseArtifact: Artifact | null = null;
        if (isUpdate) {
          const artifactId = input.request.artifact_id;
          if (!artifactId) {
            throw new Error("artifact_not_found");
          }
          baseArtifact = await entities.artifacts.findById(artifactId, input.actor.workspace_id);
          if (!baseArtifact || baseArtifact.status !== "active") {
            throw new Error("artifact_not_found");
          }
          const existingDraft = await entities.revisions.findDraftForArtifact(baseArtifact.id);
          if (existingDraft) {
            throw new Error("draft_revision_conflict");
          }
        }
        const entrypoint = input.request.entrypoint ?? baseArtifact?.entrypoint ?? "index.html";
        validateUpload(files, entrypoint);
        const totalSize = files.reduce((sum, file) => sum + file.size_bytes, 0);
        const updateArtifactId = input.request.artifact_id;
        const session: UploadSession = {
          id: createId("upl"),
          workspace_id: input.actor.workspace_id,
          artifact_id: isUpdate && updateArtifactId ? updateArtifactId : createId("art"),
          revision_id: createId("rev"),
          status: "pending",
          title: input.request.title ?? baseArtifact?.title ?? "untitled",
          entrypoint,
          artifact_expires_at: new Date(
            new Date(input.now).getTime() + (input.request.ttl_seconds ?? USAGE_POLICY.default_ttl_seconds) * 1000,
          ).toISOString(),
          file_count: files.length,
          size_bytes: totalSize,
          created_by_api_key_id: input.actor.id,
          expires_at: new Date(new Date(input.now).getTime() + DEFAULT_UPLOAD_SESSION_TTL_MS).toISOString(),
          created_at: input.now,
          finalized_at: null,
        };
        await entities.uploadSessions.insert(session);
        const storedFiles: StoredFile[] = files.map((file) => ({
          workspace_id: input.actor.workspace_id,
          upload_session_id: session.id,
          path: file.path,
          size_bytes: file.size_bytes,
          content_type: contentTypeForPath(file.path),
          r2_key: objectKeyFor(session.artifact_id, session.revision_id, file.path),
          uploaded_at: null,
          put_url_expires_at: session.expires_at,
        }));
        for (const file of storedFiles) {
          await entities.uploadSessionFiles.insert(session.id, file);
        }
        await entities.operationEvents.insert({
          actorType: "api_key",
          actorId: input.actor.id,
          action: "upload_session.created",
          targetType: "upload_session",
          targetId: session.id,
          workspaceId: session.workspace_id,
          details: { artifact_id: session.artifact_id, revision_id: session.revision_id, file_count: files.length },
          occurredAt: input.now,
        });
        return toUploadSessionRecord(session, storedFiles);
      },
    );
  }

  async recordUploadedFile(input: {
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    uploadedAt: string;
  }) {
    await this.uow.read(PLATFORM_SCOPE, (entities) => entities.uploadSessionFiles.recordUpload(input));
  }

  async getUploadSession(input: { actor: ApiActor; sessionId: string }) {
    return this.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
      const session = await entities.uploadSessions.findById(input.sessionId, input.actor.workspace_id);
      if (!session) {
        return null;
      }
      const files = await entities.uploadSessionFiles.listForSession(session.id);
      return toUploadSessionRecord(session, files);
    });
  }

  async finalizeUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: Array<{ path: string; objectKey: string; sizeBytes: number }>;
    now: string;
  }) {
    return this.uow.command(
      {
        actor: apiCommandActor(input.actor),
        operation: "upload.session.finalize",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now: input.now,
      },
      async (entities) => {
        const session = await entities.uploadSessions.findById(input.sessionId, input.actor.workspace_id);
        if (!session) {
          throw new Error("upload_session_not_found");
        }
        const files = await entities.uploadSessionFiles.listForSession(session.id);
        const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.objectKey}:${file.sizeBytes}`));
        for (const file of files) {
          if (!observed.has(`${file.path}:${file.r2_key}:${file.size_bytes}`)) {
            throw new Error("upload_incomplete");
          }
        }
        const existingArtifact = await entities.artifacts.findById(session.artifact_id, input.actor.workspace_id);
        if (existingArtifact) {
          const existingDraft = await entities.revisions.findDraftForArtifact(existingArtifact.id);
          if (existingDraft && existingDraft.id !== session.revision_id) {
            throw new Error("draft_revision_conflict");
          }
        } else {
          const artifact: Artifact = {
            id: session.artifact_id,
            workspace_id: session.workspace_id,
            revision_id: null,
            status: "active",
            title: session.title,
            entrypoint: session.entrypoint,
            file_count: session.file_count,
            size_bytes: session.size_bytes,
            expires_at: session.artifact_expires_at,
            pinned_at: null,
            created_by_api_key_id: session.created_by_api_key_id,
            access_link_lockdown_at: null,
            deleted_at: null,
            delete_reason: null,
            created_at: input.now,
            updated_at: input.now,
          };
          await entities.artifacts.insert(artifact);
          await entities.operationEvents.insert({
            actorType: "api_key",
            actorId: input.actor.id,
            action: "artifact.created",
            targetType: "artifact",
            targetId: artifact.id,
            workspaceId: artifact.workspace_id,
            details: {},
            occurredAt: input.now,
          });
        }
        const revision: Revision = {
          id: session.revision_id,
          workspace_id: session.workspace_id,
          artifact_id: session.artifact_id,
          revision_number: null,
          status: "draft",
          entrypoint: session.entrypoint,
          render_mode: inferRenderMode(session.entrypoint),
          file_count: session.file_count,
          size_bytes: session.size_bytes,
          bundle_status: "disabled",
          bundle_status_updated_at: null,
          bundle_size_bytes: null,
          bytes_purge_enqueued_at: null,
          created_by_api_key_id: session.created_by_api_key_id,
          created_at: input.now,
          published_at: null,
        };
        await entities.revisions.insert(revision);
        await entities.uploadSessions.markFinalized(session.id, input.now);
        for (const file of files) {
          await entities.artifactFiles.insert(session.artifact_id, session.revision_id, file, input.now);
        }
        await entities.operationEvents.insert({
          actorType: "api_key",
          actorId: input.actor.id,
          action: "revision.draft_created",
          targetType: "artifact",
          targetId: session.artifact_id,
          workspaceId: session.workspace_id,
          details: { revision_id: session.revision_id, file_count: session.file_count },
          occurredAt: input.now,
        });
        return buildFinalizeResult({
          uploadSessionId: session.id,
          artifactId: session.artifact_id,
          revisionId: session.revision_id,
          title: session.title,
          entrypoint: session.entrypoint,
          fileCount: session.file_count,
          sizeBytes: session.size_bytes,
        });
      },
    );
  }

  async publishRevision(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    revisionId: string;
    now: string;
  }) {
    return this.uow.command(
      {
        actor: apiCommandActor(input.actor),
        operation: "artifact.revision.publish",
        idempotencyKey: input.idempotencyKey,
        scope: workspaceScope(input.actor.workspace_id),
        now: input.now,
      },
      async (entities) => {
        const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
        if (!artifact || artifact.status !== "active") {
          throw new Error("artifact_not_found");
        }
        const revision = await entities.revisions.findById(input.revisionId, input.actor.workspace_id);
        if (!revision || revision.artifact_id !== artifact.id) {
          throw new Error("revision_unpublished");
        }
        if (revision.status === "retained") {
          throw new Error("revision_retained");
        }
        if (revision.status === "published") {
          return buildPublishResult(
            { ...artifact, revision_id: revision.id, entrypoint: revision.entrypoint },
            revision,
            undefined,
            this.options,
          );
        }
        if (revision.status !== "draft") {
          throw new Error("revision_unpublished");
        }
        const revisionFiles = await entities.artifactFiles.listForArtifact(artifact.id, revision.id);
        if (!revisionFiles.some((file) => file.path === revision.entrypoint)) {
          throw new Error("entrypoint_not_in_revision");
        }
        const revisionNumber = await entities.revisions.nextRevisionNumber(artifact.id);
        const bundleStatus = USAGE_POLICY.bundles_enabled ? ("pending" as const) : ("disabled" as const);
        const published = await entities.revisions.publish({
          revisionId: revision.id,
          revisionNumber,
          publishedAt: input.now,
          bundleStatus,
        });
        if (!published) {
          throw new Error("revision_unpublished");
        }
        const sourceSession = await entities.uploadSessions.findByRevisionId(revision.id, input.actor.workspace_id);
        await entities.artifacts.updatePublished(artifact.id, {
          revisionId: revision.id,
          title: sourceSession?.title ?? artifact.title,
          entrypoint: revision.entrypoint,
          fileCount: revision.file_count,
          sizeBytes: revision.size_bytes,
          expiresAt: artifact.expires_at,
          updatedAt: input.now,
        });
        const updatedArtifact = await entities.artifacts.findById(artifact.id, input.actor.workspace_id);
        if (!updatedArtifact) {
          throw new Error("artifact_not_found");
        }
        await entities.operationEvents.insert({
          actorType: "api_key",
          actorId: input.actor.id,
          action: "artifact.published",
          targetType: "artifact",
          targetId: artifact.id,
          workspaceId: artifact.workspace_id,
          details: { revision_id: revision.id, revision_number: revisionNumber, file_count: revision.file_count },
          occurredAt: input.now,
        });
        const publishedRevision = await entities.revisions.findById(revision.id, input.actor.workspace_id);
        if (!publishedRevision) {
          throw new Error("revision_unpublished");
        }
        return buildPublishResult(updatedArtifact, publishedRevision, undefined, this.options);
      },
    );
  }

  async listRevisions(input: { actor: ApiActor; artifactId: string }) {
    return this.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
      const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
      if (!artifact) {
        return null;
      }
      const revisions = await entities.revisions.listForArtifact(artifact.id);
      return {
        artifact_id: artifact.id,
        items: revisions.map(toRevisionSummary),
        page_info: { next_cursor: null, has_more: false },
      };
    });
  }

  async resolveAccessLink(input: { publicId: string; blobScopes: number; contentBaseUrl: string; now?: string }) {
    return this.uow.read(PLATFORM_SCOPE, async (entities) => resolveAccessLinkFromEntities(entities, input));
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    const dotIndex = input.token.indexOf(".");
    const artifactId = dotIndex === -1 ? input.token : input.token.slice(0, dotIndex);
    const requestedRevisionId = dotIndex === -1 ? undefined : input.token.slice(dotIndex + 1);
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const artifact = await entities.artifacts.findById(artifactId);
      if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
        return null;
      }
      const revisionId = requestedRevisionId ?? artifact.revision_id;
      if (!revisionId) {
        return null;
      }
      const revision = await entities.revisions.findById(revisionId);
      if (!revision || revision.artifact_id !== artifact.id || revision.status !== "published") {
        return null;
      }
      const viewArtifact =
        revisionId !== artifact.revision_id ? { ...artifact, entrypoint: revision.entrypoint } : artifact;
      const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
      return buildAgentView(viewArtifact, revisionId, files, input.contentBaseUrl, revision);
    });
  }

  async getAgentView(input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string }) {
    return this.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
      const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
      if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
        return null;
      }
      const revisionId = input.revisionId ?? artifact.revision_id;
      if (!revisionId) {
        return null;
      }
      const revision = await entities.revisions.findById(revisionId, input.actor.workspace_id);
      if (!revision || revision.artifact_id !== artifact.id || revision.status !== "published") {
        return null;
      }
      const viewArtifact =
        revisionId !== artifact.revision_id ? { ...artifact, entrypoint: revision.entrypoint } : artifact;
      const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
      return buildAgentView(viewArtifact, revisionId, files, input.contentBaseUrl, revision);
    });
  }

  async runCleanup(input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize?: number;
    now: string;
  }) {
    const idempotencyKey = input.idempotencyKey ?? `cleanup:${input.actor.type}:${input.now}`;
    return this.uow.command(
      {
        actor: adminCommandActor(input.actor, null),
        operation: "admin.cleanup.run",
        idempotencyKey,
        scope: PLATFORM_SCOPE,
        now: input.now,
      },
      async (entities) => {
        const limit = input.batchSize ?? 100;
        const expiredArtifacts = await entities.artifacts.listExpiring(input.now, limit);
        const expiredSessions = await entities.uploadSessions.listExpiring(input.now, limit);
        if (!input.dryRun) {
          await entities.artifacts.expireBatch(
            input.now,
            expiredArtifacts.map((row) => row.id),
          );
          await entities.uploadSessions.expireBatch(
            input.now,
            expiredSessions.map((row) => row.id),
          );
          await entities.operationEvents.insert({
            actorType: input.actor.type,
            actorId: input.actor.id,
            action: "cleanup.run",
            targetType: "cleanup",
            targetId: "manual",
            workspaceId: null,
            details: {
              expired_artifacts: expiredArtifacts.length,
              expired_upload_sessions: expiredSessions.length,
            },
            occurredAt: input.now,
          });
        }
        return {
          dry_run: input.dryRun,
          expired_artifacts: expiredArtifacts.length,
          expired_artifact_ids: input.dryRun ? [] : expiredArtifacts.map((row) => row.id),
          expired_upload_sessions: expiredSessions.length,
          deleted_r2_objects: 0,
          occurred_at: input.now,
        };
      },
    );
  }

  async listArtifacts(workspaceId?: string, status?: string) {
    const scope = workspaceId ? workspaceScope(workspaceId) : PLATFORM_SCOPE;
    return this.uow.read(scope, async (entities) => {
      const rows = await entities.artifacts.listFiltered(workspaceId, status);
      return { data: rows.map(toArtifactSummary), page_info: { next_cursor: null, has_more: false } };
    });
  }

  async getArtifactDetail(artifactId: string) {
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const artifact = await entities.artifacts.findById(artifactId);
      if (!artifact) {
        return null;
      }
      const revisionId = artifact.revision_id;
      const files = revisionId ? await entities.artifactFiles.listForArtifact(artifact.id, revisionId) : [];
      const eventIds = await entities.operationEvents.listIdsForTarget(artifact.id);
      return {
        ...toArtifactSummary(artifact),
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

  async deleteArtifact(input: { actor: AdminActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    const deletedAt = nowIso(input.now);
    const target = await this.uow.read(PLATFORM_SCOPE, (entities) => entities.artifacts.findById(input.artifactId));
    if (!target) {
      throw new Error("artifact_not_found");
    }
    return this.uow.command(
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
          throw new Error("artifact_not_found");
        }
        await entities.artifacts.markDeleted(artifact.id, deletedAt);
        await entities.operationEvents.insert({
          actorType: input.actor.type,
          actorId: input.actor.id,
          action: "artifact.deleted",
          targetType: "artifact",
          targetId: artifact.id,
          workspaceId: artifact.workspace_id,
          details: {},
          occurredAt: deletedAt,
        });
        return { artifact_id: artifact.id, deleted_at: deletedAt };
      },
    );
  }

  async listOperationEvents() {
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const data = await entities.operationEvents.listAll();
      return { data, page_info: { next_cursor: null, has_more: false } };
    });
  }

  async forceExpireArtifact(input: { artifactId: string; expiresAt: string }) {
    return this.uow.read(PLATFORM_SCOPE, (entities) =>
      entities.artifacts.updateExpiry(input.artifactId, input.expiresAt),
    );
  }

  async peekIdempotentReplay(input: { actor: ApiKeyActor; operation: string; idempotencyKey: string }) {
    return this.uow.peekReplay<unknown>({
      actor: apiCommandActor(input.actor),
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
    });
  }

  private async mustWorkspace(entities: Entities, id: string) {
    const workspace = await entities.workspaces.findById(id);
    if (!workspace) {
      throw new Error("workspace_not_found");
    }
    return workspace;
  }

  private async mustApiKey(entities: Entities, id: string) {
    const apiKey = await entities.apiKeys.findById(id);
    if (!apiKey) {
      throw new Error("api_key_not_found");
    }
    return apiKey;
  }

  private async mustMember(entities: Entities, id: string) {
    const member = await entities.members.findById(id);
    if (!member) {
      throw new Error("workspace_member_not_found");
    }
    return member;
  }
}
