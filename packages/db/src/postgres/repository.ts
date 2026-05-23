import { type CommandAuditEvent, runCommand } from "@agent-paste/commands";
import { buildAgentView, buildPublishResult } from "../agent-view.js";
import { generateApiKey, parseApiKey, verifyApiKeySecret } from "../api-keys.js";
import { createId } from "../id.js";
import { DEFAULT_UPLOAD_SESSION_TTL_MS, USAGE_POLICY } from "../policy.js";
import {
  apiKeyQueries,
  artifactFileQueries,
  artifactQueries,
  operationEventQueries,
  uploadSessionFileQueries,
  uploadSessionQueries,
  workspaceMemberQueries,
  workspaceQueries,
} from "../queries/index.js";
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
  ApiKey,
  ApiKeyActor,
  Artifact,
  OperationEvent,
  RepositoryOptions,
  SqlExecutor,
  SqlValue,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "../types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "../validation.js";
import { type DrizzleConnection, type DrizzleDb, drizzleForExecutor } from "./drizzle.js";
import { type RlsScope, rlsExecutor } from "./rls.js";

type HandlerContext = { sql: SqlExecutor; drizzle: DrizzleDb };
const DEFAULT_MEMBER_SCOPES = ["publish", "read", "admin"] as const;

function commandActor(actor: ApiActor) {
  if (actor.type !== "api_key") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: "api_key" as const, id: actor.id, workspaceId: actor.workspace_id };
}

function adminCommandActor(actor: AdminActor, workspaceId: string | null) {
  return { type: actor.type, id: actor.id, workspaceId };
}

function withDrizzle(tx: SqlExecutor): HandlerContext {
  const drizzleDb = drizzleForExecutor(tx);
  if (!drizzleDb) {
    throw new Error("drizzle_not_bound_to_executor");
  }
  return { sql: tx, drizzle: drizzleDb };
}

function isDrizzleConnection(value: SqlExecutor | DrizzleConnection): value is DrizzleConnection {
  return "drizzle" in value && "sql" in value;
}

export class PostgresRepository {
  private readonly executor: SqlExecutor;

  constructor(
    connection: SqlExecutor | DrizzleConnection,
    private readonly options: RepositoryOptions,
  ) {
    if (isDrizzleConnection(connection)) {
      this.executor = connection.sql;
    } else {
      this.executor = connection;
      const bound = drizzleForExecutor(connection);
      if (!bound) {
        throw new Error("executor_missing_drizzle_binding");
      }
    }
  }

  async createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace> {
    const now = (input.now ?? new Date()).toISOString();
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: input.name ?? input.email.split("@")[0] ?? "workspace",
      contact_email: input.email,
      created_at: now,
      updated_at: now,
    };
    return this.runAdminCommand(input.actor, "admin.workspace.create", input.idempotencyKey, null, now, async (tx) => {
      const ctx = withDrizzle(tx);
      await workspaceQueries.insert(ctx.drizzle, workspace);
      await operationEventQueries.insert(ctx.drizzle, {
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: "workspace.created",
        targetType: "workspace",
        targetId: workspace.id,
        workspaceId: workspace.id,
        details: { email: input.email },
        occurredAt: now,
      });
      return { result: workspace };
    });
  }

  async listWorkspaces() {
    return this.withScope(this.platformScope(), async (ctx) => {
      const rows = await workspaceQueries.listAll(ctx.drizzle);
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
    const now = (input.now ?? new Date()).toISOString();
    return this.runAdminCommand(
      input.actor,
      "admin.api_key.create",
      input.idempotencyKey,
      input.workspaceId,
      now,
      async (tx) => {
        const ctx = withDrizzle(tx);
        await this.mustWorkspace(ctx, input.workspaceId);
        const generated = await generateApiKey(this.options.apiKeyEnv ?? "preview", this.options.apiKeyPepper);
        const apiKey: ApiKey = {
          id: createId("key"),
          workspace_id: input.workspaceId,
          public_id: generated.publicId,
          name: input.name,
          secret_hmac: generated.secretHmac,
          pepper_kid: 1,
          scopes: ["publish", "read"],
          revoked_at: null,
          last_used_at: null,
          created_at: now,
        };
        await apiKeyQueries.insert(ctx.drizzle, apiKey);
        await operationEventQueries.insert(ctx.drizzle, {
          actorType: input.actor.type,
          actorId: input.actor.id,
          action: "api_key.created",
          targetType: "api_key",
          targetId: apiKey.id,
          workspaceId: apiKey.workspace_id,
          details: { name: apiKey.name, public_id: apiKey.public_id },
          occurredAt: now,
        });
        return { result: { api_key: toApiKeySummary(apiKey), secret: generated.secret } };
      },
    );
  }

  async revokeApiKey(input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    const revokedAt = (input.now ?? new Date()).toISOString();
    const apiKey = await this.withScope(this.platformScope(), (ctx) => this.mustApiKey(ctx, input.apiKeyId));
    return this.runAdminCommand(
      input.actor,
      "admin.api_key.revoke",
      input.idempotencyKey,
      apiKey.workspace_id,
      revokedAt,
      async (tx) => {
        const ctx = withDrizzle(tx);
        await apiKeyQueries.updateRevokedAt(ctx.drizzle, input.apiKeyId, revokedAt);
        await operationEventQueries.insert(ctx.drizzle, {
          actorType: input.actor.type,
          actorId: input.actor.id,
          action: "api_key.revoked",
          targetType: "api_key",
          targetId: apiKey.id,
          workspaceId: apiKey.workspace_id,
          details: { public_id: apiKey.public_id },
          occurredAt: revokedAt,
        });
        const updated = { ...apiKey, revoked_at: revokedAt };
        return { result: { api_key: toApiKeySummary(updated), revoked_at: revokedAt } };
      },
    );
  }

  async verifyApiKey(apiKeySecret: string): Promise<ApiKeyActor | null> {
    const parsed = parseApiKey(apiKeySecret);
    if (!parsed) {
      return null;
    }
    const record = await this.withScope(this.platformScope(), (ctx) =>
      apiKeyQueries.findByPublicId(ctx.drizzle, parsed.publicId),
    );
    if (!record || record.revoked_at) {
      return null;
    }
    const ok = await verifyApiKeySecret(apiKeySecret, record.public_id, record.secret_hmac, this.options.apiKeyPepper);
    if (!ok) {
      return null;
    }
    await this.withScope(this.workspaceScope(record.workspace_id), (ctx) =>
      apiKeyQueries.updateLastUsedAt(ctx.drizzle, record.id, new Date().toISOString()),
    );
    return { type: "api_key", id: record.id, workspace_id: record.workspace_id, scopes: record.scopes };
  }

  async getWhoami(actor: ApiActor) {
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const apiKey = await this.mustApiKey(ctx, actor.id);
      const workspace = await this.mustWorkspace(ctx, apiKey.workspace_id);
      return {
        actor: { type: "api_key", id: apiKey.id, name: apiKey.name },
        workspace: toWorkspaceSummary(workspace),
        scopes: apiKey.scopes,
        usage_policy: USAGE_POLICY,
      };
    });
  }

  async resolveWebMember(input: { workosUserId: string; email: string; now?: string }) {
    const now = input.now ?? new Date().toISOString();
    return this.withScope(this.platformScope(), async (ctx) => {
      const existing = await workspaceMemberQueries.findByWorkOsUserId(ctx.drizzle, input.workosUserId);
      if (existing) {
        const member = await workspaceMemberQueries.updateSeen(ctx.drizzle, existing.id, {
          email: input.email,
          lastSeenAt: now,
        });
        return this.webAuthResponse(ctx, member ?? existing, null);
      }

      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: `${input.email.split("@")[0] ?? "user"}'s Workspace`,
        contact_email: input.email,
        created_at: now,
        updated_at: now,
      };
      await workspaceQueries.insert(ctx.drizzle, workspace);

      const member: WorkspaceMember = {
        id: createId("mem"),
        workspace_id: workspace.id,
        workos_user_id: input.workosUserId,
        email: input.email,
        scopes: [...DEFAULT_MEMBER_SCOPES],
        created_at: now,
        last_seen_at: now,
      };
      await workspaceMemberQueries.insert(ctx.drizzle, member);

      const generated = await generateApiKey(this.options.apiKeyEnv ?? "preview", this.options.apiKeyPepper);
      const apiKey: ApiKey = {
        id: createId("key"),
        workspace_id: workspace.id,
        public_id: generated.publicId,
        name: "Default",
        secret_hmac: generated.secretHmac,
        pepper_kid: 1,
        scopes: ["publish", "read"],
        revoked_at: null,
        last_used_at: null,
        created_at: now,
      };
      await apiKeyQueries.insert(ctx.drizzle, apiKey);
      await operationEventQueries.insert(ctx.drizzle, {
        actorType: "system",
        actorId: "web-auth",
        action: "workspace.created",
        targetType: "workspace",
        targetId: workspace.id,
        workspaceId: workspace.id,
        details: {},
        occurredAt: now,
      });
      await operationEventQueries.insert(ctx.drizzle, {
        actorType: "system",
        actorId: "web-auth",
        action: "api_key.created",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: workspace.id,
        details: { name: apiKey.name, public_id: apiKey.public_id },
        occurredAt: now,
      });

      return this.webAuthResponse(ctx, member, { api_key: toApiKeySummary(apiKey), secret: generated.secret });
    });
  }

  async getWebMemberByWorkOsUserId(input: { workosUserId: string; email: string; now?: string }) {
    const now = input.now ?? new Date().toISOString();
    return this.withScope(this.platformScope(), async (ctx) => {
      const existing = await workspaceMemberQueries.findByWorkOsUserId(ctx.drizzle, input.workosUserId);
      if (!existing) {
        return null;
      }
      const member = await workspaceMemberQueries.updateSeen(ctx.drizzle, existing.id, {
        email: input.email,
        lastSeenAt: now,
      });
      const updated = member ?? existing;
      return {
        type: "member" as const,
        id: updated.id,
        workspace_id: updated.workspace_id,
        email: updated.email,
        scopes: updated.scopes,
      };
    });
  }

  async getWebWorkspace(actor: ApiActor) {
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const member = await this.mustWorkspaceMember(ctx, actor.id);
      const workspace = await this.mustWorkspace(ctx, member.workspace_id);
      return {
        workspace: toWorkspaceSummary(workspace),
        workspace_member: this.toWorkspaceMemberSummary(member),
        usage_policy: USAGE_POLICY,
        default_key_first_run: false,
      };
    });
  }

  async listWebArtifacts(actor: ApiActor) {
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const rows = await artifactQueries.listFiltered(ctx.drizzle, actor.workspace_id);
      return { items: rows.map(toWebArtifactRow), page_info: { next_cursor: null, has_more: false } };
    });
  }

  async getWebArtifact(actor: ApiActor, artifactId: string) {
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const artifact = await artifactQueries.findById(ctx.drizzle, artifactId, actor.workspace_id);
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
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const rows = await apiKeyQueries.listForWorkspace(ctx.drizzle, actor.workspace_id);
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

  async listWebAuditEvents(actor: ApiActor) {
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const rows = await operationEventQueries.listForWorkspace(ctx.drizzle, actor.workspace_id);
      return { items: rows.map(toWebAuditRow), page_info: { next_cursor: null, has_more: false } };
    });
  }

  async getWebSettings(actor: ApiActor) {
    return this.withScope(this.workspaceScope(actor.workspace_id), async (ctx) => {
      const workspace = await this.mustWorkspace(ctx, actor.workspace_id);
      return {
        workspace_name: workspace.name,
        auto_deletion_days: Math.floor(USAGE_POLICY.default_ttl_seconds / (24 * 60 * 60)),
        usage_policy: {
          artifacts_per_day: 0,
          bytes_per_day: USAGE_POLICY.artifact_size_cap_bytes,
        },
      };
    });
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
    return this.runIdempotent(input.actor, "upload.session.create", input.idempotencyKey, input.now, async (tx) => {
      const ctx = withDrizzle(tx);
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
      await uploadSessionQueries.insert(ctx.drizzle, session);
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
        await uploadSessionFileQueries.insert(ctx.drizzle, session.id, file);
      }
      await operationEventQueries.insert(ctx.drizzle, {
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
    });
  }

  async recordUploadedFile(input: {
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    uploadedAt: string;
  }) {
    await this.withScope(this.platformScope(), (ctx) => uploadSessionFileQueries.recordUpload(ctx.drizzle, input));
  }

  async getUploadSession(input: { actor: ApiActor; sessionId: string }) {
    return this.withScope(this.workspaceScope(input.actor.workspace_id), async (ctx) => {
      const session = await uploadSessionQueries.findById(ctx.drizzle, input.sessionId, input.actor.workspace_id);
      if (!session) {
        return null;
      }
      const files = await uploadSessionFileQueries.listForSession(ctx.drizzle, session.id);
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
    return this.runIdempotent(input.actor, "upload.session.finalize", input.idempotencyKey, input.now, async (tx) => {
      const ctx = withDrizzle(tx);
      const session = await uploadSessionQueries.findById(ctx.drizzle, input.sessionId, input.actor.workspace_id);
      if (!session) {
        throw new Error("upload_session_not_found");
      }
      const files = await uploadSessionFileQueries.listForSession(ctx.drizzle, session.id);
      const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.objectKey}:${file.sizeBytes}`));
      for (const file of files) {
        if (!observed.has(`${file.path}:${file.r2_key}:${file.size_bytes}`)) {
          throw new Error("upload_incomplete");
        }
      }
      await uploadSessionQueries.markFinalized(ctx.drizzle, session.id, input.now);
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
      await artifactQueries.insert(ctx.drizzle, artifact);
      for (const file of files) {
        await artifactFileQueries.insert(ctx.drizzle, artifact.id, artifact.revision_id, file, input.now);
      }
      await operationEventQueries.insert(ctx.drizzle, {
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
    });
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    const artifactId = input.token.split(".")[0] ?? input.token;
    return this.withScope(this.platformScope(), async (ctx) => {
      const artifact = await artifactQueries.findById(ctx.drizzle, artifactId);
      if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
        return null;
      }
      const files = await artifactFileQueries.listForArtifact(ctx.drizzle, artifact.id);
      return buildAgentView(artifact, files, input.contentBaseUrl);
    });
  }

  async getAgentView(input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string }) {
    return this.withScope(this.workspaceScope(input.actor.workspace_id), async (ctx) => {
      const artifact = await artifactQueries.findById(ctx.drizzle, input.artifactId, input.actor.workspace_id);
      if (
        !artifact ||
        artifact.status !== "active" ||
        (input.revisionId && artifact.revision_id !== input.revisionId) ||
        new Date(artifact.expires_at).getTime() <= Date.now()
      ) {
        return null;
      }
      const files = await artifactFileQueries.listForArtifact(ctx.drizzle, artifact.id);
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
    return this.runAdminCommand(input.actor, "admin.cleanup.run", idempotencyKey, null, input.now, async (tx) => ({
      result: await this.runCleanupInternal(tx, input),
    }));
  }

  private async runCleanupInternal(
    tx: SqlExecutor,
    input: { actor: AdminActor; dryRun: boolean; batchSize?: number; now: string },
  ) {
    const limit = input.batchSize ?? 100;
    const expiredArtifacts = await tx.query<{ id: string; workspace_id: string }>(
      `select id, workspace_id
       from artifacts
       where status = 'active' and expires_at <= $1
       order by expires_at asc
       limit $2`,
      [input.now, limit],
    );
    const expiredSessions = await tx.query<{ id: string; workspace_id: string }>(
      `select id, workspace_id
       from upload_sessions
       where status = 'pending' and expires_at <= $1
       order by expires_at asc
       limit $2`,
      [input.now, limit],
    );
    if (!input.dryRun) {
      await tx.query(
        `update artifacts
         set status = 'expired', deleted_at = $1, delete_reason = 'expired', updated_at = $1
         where status = 'active' and expires_at <= $1 and id = any($2::text[])`,
        [input.now, expiredArtifacts.rows.map((row) => row.id)],
      );
      await tx.query(
        `update upload_sessions
         set status = 'expired'
         where status = 'pending' and expires_at <= $1 and id = any($2::text[])`,
        [input.now, expiredSessions.rows.map((row) => row.id)],
      );
      const ctx = withDrizzle(tx);
      await operationEventQueries.insert(ctx.drizzle, {
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: "cleanup.run",
        targetType: "cleanup",
        targetId: "manual",
        workspaceId: null,
        details: {
          expired_artifacts: expiredArtifacts.rows.length,
          expired_upload_sessions: expiredSessions.rows.length,
        },
        occurredAt: input.now,
      });
    }
    return {
      dry_run: input.dryRun,
      expired_artifacts: expiredArtifacts.rows.length,
      expired_artifact_ids: input.dryRun ? [] : expiredArtifacts.rows.map((row) => row.id),
      expired_upload_sessions: expiredSessions.rows.length,
      deleted_r2_objects: 0,
      occurred_at: input.now,
    };
  }

  async listArtifacts(workspaceId?: string, status?: string) {
    const scope: RlsScope = workspaceId ? this.workspaceScope(workspaceId) : this.platformScope();
    return this.withScope(scope, async (ctx) => {
      const rows = await artifactQueries.listFiltered(ctx.drizzle, workspaceId, status);
      return { data: rows.map(toArtifactSummary), page_info: { next_cursor: null, has_more: false } };
    });
  }

  async getArtifactDetail(artifactId: string) {
    return this.withScope(this.platformScope(), async (ctx) => {
      const artifact = await artifactQueries.findById(ctx.drizzle, artifactId);
      if (!artifact) {
        return null;
      }
      const files = await artifactFileQueries.listForArtifact(ctx.drizzle, artifact.id);
      const eventIds = await operationEventQueries.listIdsForTarget(ctx.drizzle, artifact.id);
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
    const deletedAt = (input.now ?? new Date()).toISOString();
    const target = await this.withScope(this.platformScope(), (ctx) =>
      artifactQueries.findById(ctx.drizzle, input.artifactId),
    );
    if (!target) {
      throw new Error("artifact_not_found");
    }
    return this.runAdminCommand(
      input.actor,
      "admin.artifact.delete",
      input.idempotencyKey,
      target.workspace_id,
      deletedAt,
      async (tx) => {
        const ctx = withDrizzle(tx);
        const artifact = await artifactQueries.findById(ctx.drizzle, input.artifactId);
        if (!artifact) {
          throw new Error("artifact_not_found");
        }
        await tx.query(
          `update artifacts
           set status = 'deleted', deleted_at = $2, delete_reason = 'admin_delete', updated_at = $2
           where id = $1`,
          [input.artifactId, deletedAt],
        );
        await operationEventQueries.insert(ctx.drizzle, {
          actorType: input.actor.type,
          actorId: input.actor.id,
          action: "artifact.deleted",
          targetType: "artifact",
          targetId: artifact.id,
          workspaceId: artifact.workspace_id,
          details: {},
          occurredAt: deletedAt,
        });
        return { result: { artifact_id: artifact.id, deleted_at: deletedAt } };
      },
    );
  }

  async listOperationEvents() {
    return this.withScope(this.platformScope(), async (ctx) => {
      const data = await operationEventQueries.listAll(ctx.drizzle);
      return { data, page_info: { next_cursor: null, has_more: false } };
    });
  }

  async forceExpireArtifact(input: { artifactId: string; expiresAt: string }) {
    return this.withScope(this.platformScope(), (ctx) =>
      artifactQueries.updateExpiry(ctx.drizzle, input.artifactId, input.expiresAt),
    );
  }

  private withScope<T>(scope: RlsScope, run: (ctx: HandlerContext) => Promise<T>): Promise<T> {
    return rlsExecutor(this.executor, scope).transaction(async (tx) => run(withDrizzle(tx)));
  }

  private workspaceScope(workspaceId: string): RlsScope {
    return { kind: "workspace", workspaceId };
  }

  private platformScope(): RlsScope {
    return { kind: "platform" };
  }

  private async runIdempotent<T>(
    actor: ApiActor,
    operation: string,
    idempotencyKey: string,
    now: string,
    run: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const scope: RlsScope = { kind: "workspace", workspaceId: actor.workspace_id };
    const command = await runCommand<T>({
      executor: rlsExecutor(this.executor, scope),
      actor: commandActor(actor),
      operation,
      idempotencyKey,
      workspaceId: actor.workspace_id,
      now,
      handler: async (tx) => ({ result: await run(tx) }),
    });
    return command.result;
  }

  private async runAdminCommand<T>(
    actor: AdminActor,
    operation: string,
    idempotencyKey: string,
    workspaceId: string | null,
    now: string,
    run: (tx: SqlExecutor) => Promise<{ result: T; audit?: CommandAuditEvent[] }>,
  ): Promise<T> {
    const scope: RlsScope = workspaceId ? { kind: "workspace", workspaceId } : { kind: "platform" };
    const command = await runCommand<T>({
      executor: rlsExecutor(this.executor, scope),
      actor: adminCommandActor(actor, workspaceId),
      operation,
      idempotencyKey,
      workspaceId,
      now,
      handler: run,
    });
    return command.result;
  }

  private async mustWorkspace(ctx: HandlerContext, id: string) {
    const workspace = await workspaceQueries.findById(ctx.drizzle, id);
    if (!workspace) {
      throw new Error("workspace_not_found");
    }
    return workspace;
  }

  private async mustApiKey(ctx: HandlerContext, id: string) {
    const apiKey = await apiKeyQueries.findById(ctx.drizzle, id);
    if (!apiKey) {
      throw new Error("api_key_not_found");
    }
    return apiKey;
  }

  private async mustWorkspaceMember(ctx: HandlerContext, id: string) {
    const member = await workspaceMemberQueries.findById(ctx.drizzle, id);
    if (!member) {
      throw new Error("workspace_member_not_found");
    }
    return member;
  }

  private toWorkspaceMemberSummary(member: WorkspaceMember) {
    return {
      id: member.id,
      workspace_id: member.workspace_id,
      email: member.email,
      scopes: member.scopes,
      created_at: member.created_at,
      last_seen_at: member.last_seen_at,
    };
  }

  private async webAuthResponse(
    ctx: HandlerContext,
    member: WorkspaceMember,
    defaultApiKey: { api_key: ReturnType<typeof toApiKeySummary>; secret: string } | null,
  ) {
    const workspace = await this.mustWorkspace(ctx, member.workspace_id);
    return {
      workspace: toWorkspaceSummary(workspace),
      workspace_member: this.toWorkspaceMemberSummary(member),
      scopes: member.scopes,
      default_api_key: defaultApiKey,
    };
  }
}

function toWebArtifactRow(artifact: Artifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    status: webArtifactStatus(artifact),
    latest_revision_id: artifact.revision_id,
    pinned: false,
    lockdown: false,
    last_published_at: artifact.created_at,
    auto_delete_at: artifact.status === "deleted" ? null : artifact.expires_at,
  };
}

function webArtifactStatus(artifact: Artifact): "Published" | "Deleted" | "Expired" {
  if (artifact.status === "deleted") {
    return "Deleted";
  }
  if (artifact.status === "expired") {
    return "Expired";
  }
  return "Published";
}

function toWebAuditRow(event: OperationEvent) {
  return {
    id: event.id,
    time: event.occurred_at,
    actor: `${event.actor_type}:${event.actor_id ?? "unknown"}`,
    action: event.action,
    target: `${event.target_type}:${event.target_id}`,
    change_summary: summarizeEventDetails(event.details),
    request_id: event.request_id ?? "",
  };
}

function summarizeEventDetails(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) {
    return "";
  }
  return keys
    .sort()
    .map((key) => `${key}=${String(details[key])}`)
    .join(", ");
}

// Re-export type for legacy SqlValue users
export type { SqlValue };
