import { buildAgentView, buildPublishResult } from "../agent-view.js";
import { parseApiKey, verifyApiKeySecret } from "../api-keys.js";
import { createId } from "../id.js";
import { DEFAULT_AUTO_DELETION_DAYS, DEFAULT_UPLOAD_SESSION_TTL_MS, USAGE_POLICY } from "../policy.js";
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
  RepositoryOptions,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "../types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "../validation.js";
import type { Repository } from "./interface.js";
import type { CommandActor, Entities, RunScope, UnitOfWork } from "./ports.js";
import { buildApiKey, DEFAULT_MEMBER_SCOPES, toWorkspaceMemberSummary, webAuthResponse } from "./shared.js";
import {
  decodeWebArtifactCursor,
  decodeWebAuditCursor,
  encodeWebArtifactCursor,
  encodeWebAuditCursor,
  normalizeWebArtifactLimit,
  normalizeWebAuditLimit,
  toWebArtifactRow,
  toWebAuditRow,
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
    const ok = await verifyApiKeySecret(apiKeySecret, record.public_id, record.secret_hmac, this.options.apiKeyPepper);
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
      return {
        ...toWebArtifactRow(artifact),
        entrypoint: artifact.entrypoint,
        file_count: artifact.file_count,
        size_bytes: artifact.size_bytes,
      };
    });
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

  async createUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    request: {
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
        validateUpload(files, input.request.entrypoint);
        const totalSize = files.reduce((sum, file) => sum + file.size_bytes, 0);
        const session: UploadSession = {
          id: createId("upl"),
          workspace_id: input.actor.workspace_id,
          artifact_id: createId("art"),
          revision_id: createId("rev"),
          status: "pending",
          title: input.request.title ?? "untitled",
          entrypoint: input.request.entrypoint ?? "index.html",
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
        await entities.uploadSessions.markFinalized(session.id, input.now);
        const artifact: Artifact = {
          id: session.artifact_id,
          workspace_id: session.workspace_id,
          revision_id: session.revision_id,
          status: "active",
          title: session.title,
          entrypoint: session.entrypoint,
          file_count: session.file_count,
          size_bytes: session.size_bytes,
          expires_at: session.artifact_expires_at,
          created_by_api_key_id: session.created_by_api_key_id,
          deleted_at: null,
          delete_reason: null,
          created_at: input.now,
          updated_at: input.now,
        };
        await entities.artifacts.insert(artifact);
        for (const file of files) {
          await entities.artifactFiles.insert(artifact.id, artifact.revision_id, file, input.now);
        }
        await entities.operationEvents.insert({
          actorType: "api_key",
          actorId: input.actor.id,
          action: "artifact.published",
          targetType: "artifact",
          targetId: artifact.id,
          workspaceId: artifact.workspace_id,
          details: { revision_id: artifact.revision_id, file_count: artifact.file_count },
          occurredAt: input.now,
        });
        return buildPublishResult(artifact, session.id, this.options);
      },
    );
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    const artifactId = input.token.split(".")[0] ?? input.token;
    return this.uow.read(PLATFORM_SCOPE, async (entities) => {
      const artifact = await entities.artifacts.findById(artifactId);
      if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
        return null;
      }
      const files = await entities.artifactFiles.listForArtifact(artifact.id);
      return buildAgentView(artifact, files, input.contentBaseUrl);
    });
  }

  async getAgentView(input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string }) {
    return this.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
      const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
      if (
        !artifact ||
        artifact.status !== "active" ||
        (input.revisionId && artifact.revision_id !== input.revisionId) ||
        new Date(artifact.expires_at).getTime() <= Date.now()
      ) {
        return null;
      }
      const files = await entities.artifactFiles.listForArtifact(artifact.id);
      return buildAgentView(artifact, files, input.contentBaseUrl);
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
      const files = await entities.artifactFiles.listForArtifact(artifact.id);
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
