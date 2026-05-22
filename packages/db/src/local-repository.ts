import { buildAgentView, buildPublishResult } from "./agent-view.js";
import { generateApiKey, parseApiKey, verifyApiKeySecret } from "./api-keys.js";
import { createId } from "./id.js";
import { DEFAULT_UPLOAD_SESSION_TTL_MS, USAGE_POLICY } from "./policy.js";
import {
  toApiKeySummary,
  toArtifactSummary,
  toUploadSessionRecord,
  toWorkspaceDetail,
  toWorkspaceSummary,
} from "./transforms.js";
import type {
  AdminActor,
  ApiActor,
  ApiKey,
  Artifact,
  OperationEvent,
  RepositoryOptions,
  StoredFile,
  UploadSession,
  Workspace,
} from "./types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "./validation.js";

export class LocalRepository {
  readonly workspaces = new Map<string, Workspace>();
  readonly apiKeys = new Map<string, ApiKey>();
  readonly artifacts = new Map<string, Artifact>();
  readonly artifactFiles = new Map<string, StoredFile>();
  readonly uploadSessions = new Map<string, UploadSession>();
  readonly uploadSessionFiles = new Map<string, StoredFile>();
  readonly operationEvents = new Map<string, OperationEvent>();
  private readonly idempotency = new Map<string, unknown>();

  constructor(private readonly options: RepositoryOptions) {}

  async createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace> {
    const now = (input.now ?? new Date()).toISOString();
    const cacheKey = `admin.workspace.create:${input.actor.type}:${input.actor.id}:${input.idempotencyKey}`;
    return this.runIdempotent(cacheKey, () => {
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: input.name ?? input.email.split("@")[0] ?? "workspace",
        contact_email: input.email,
        created_at: now,
        updated_at: now,
      };
      this.workspaces.set(workspace.id, workspace);
      this.addEvent(
        input.actor.type,
        input.actor.id,
        "workspace.created",
        "workspace",
        workspace.id,
        workspace.id,
        { email: input.email },
        now,
      );
      return workspace;
    });
  }

  listWorkspaces() {
    return {
      data: [...this.workspaces.values()].map(toWorkspaceDetail),
      page_info: { next_cursor: null, has_more: false },
    };
  }

  async createApiKey(input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
    now?: Date;
  }) {
    const workspace = this.mustWorkspace(input.workspaceId);
    const key = `admin.api_key.create:${input.actor.type}:${input.actor.id}:${input.idempotencyKey}`;
    if (this.idempotency.has(key)) {
      return this.idempotency.get(key) as { api_key: ReturnType<typeof toApiKeySummary>; secret: string };
    }
    const generated = await generateApiKey(this.options.apiKeyEnv ?? "preview", this.options.apiKeyPepper);
    const now = (input.now ?? new Date()).toISOString();
    return this.runIdempotent(key, () => {
      const apiKey: ApiKey = {
        id: createId("key"),
        workspace_id: workspace.id,
        public_id: generated.publicId,
        name: input.name,
        secret_hmac: generated.secretHmac,
        pepper_kid: 1,
        scopes: ["publish", "read"],
        revoked_at: null,
        last_used_at: null,
        created_at: now,
      };
      this.apiKeys.set(apiKey.id, apiKey);
      this.addEvent(
        input.actor.type,
        input.actor.id,
        "api_key.created",
        "api_key",
        apiKey.id,
        workspace.id,
        { name: apiKey.name, public_id: apiKey.public_id },
        now,
      );
      return { api_key: toApiKeySummary(apiKey), secret: generated.secret };
    });
  }

  revokeApiKey(input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    const apiKey = this.mustApiKey(input.apiKeyId);
    const revokedAt = (input.now ?? new Date()).toISOString();
    return this.runIdempotent(
      `admin.api_key.revoke:${input.actor.type}:${input.actor.id}:${input.idempotencyKey}`,
      () => {
        apiKey.revoked_at = revokedAt;
        this.addEvent(
          input.actor.type,
          input.actor.id,
          "api_key.revoked",
          "api_key",
          apiKey.id,
          apiKey.workspace_id,
          { public_id: apiKey.public_id },
          apiKey.revoked_at,
        );
        return { api_key: toApiKeySummary(apiKey), revoked_at: apiKey.revoked_at };
      },
    );
  }

  async verifyApiKey(apiKeySecret: string): Promise<ApiActor | null> {
    const parsed = parseApiKey(apiKeySecret);
    if (!parsed) {
      return null;
    }
    const record = [...this.apiKeys.values()].find((apiKey) => apiKey.public_id === parsed.publicId);
    if (!record || record.revoked_at) {
      return null;
    }
    const ok = await verifyApiKeySecret(apiKeySecret, record.public_id, record.secret_hmac, this.options.apiKeyPepper);
    if (!ok) {
      return null;
    }
    record.last_used_at = new Date().toISOString();
    return { type: "api_key", id: record.id, workspace_id: record.workspace_id, scopes: record.scopes };
  }

  async getWhoami(actor: ApiActor) {
    const apiKey = this.mustApiKey(actor.id);
    return {
      actor: { type: "api_key", id: apiKey.id, name: apiKey.name },
      workspace: toWorkspaceSummary(this.mustWorkspace(apiKey.workspace_id)),
      scopes: apiKey.scopes,
      usage_policy: USAGE_POLICY,
    };
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
    return this.runIdempotent(`upload.create:${input.actor.id}:${input.idempotencyKey}`, () => {
      const files = input.request.files.map((file) => ({ ...file, path: normalizeStoragePath(file.path) }));
      validateUpload(files, input.request.entrypoint);
      const totalSize = files.reduce((sum, file) => sum + file.size_bytes, 0);
      const artifactId = createId("art");
      const revisionId = createId("rev");
      const sessionId = createId("upl");
      const expiresAt = new Date(new Date(input.now).getTime() + DEFAULT_UPLOAD_SESSION_TTL_MS).toISOString();
      const artifactExpiresAt = new Date(
        new Date(input.now).getTime() + (input.request.ttl_seconds ?? USAGE_POLICY.default_ttl_seconds) * 1000,
      ).toISOString();
      const session: UploadSession = {
        id: sessionId,
        workspace_id: input.actor.workspace_id,
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "pending",
        title: input.request.title ?? "untitled",
        entrypoint: input.request.entrypoint ?? "index.html",
        artifact_expires_at: artifactExpiresAt,
        file_count: files.length,
        size_bytes: totalSize,
        created_by_api_key_id: input.actor.id,
        expires_at: expiresAt,
        created_at: input.now,
        finalized_at: null,
      };
      this.uploadSessions.set(session.id, session);
      for (const file of files) {
        const r2Key = objectKeyFor(session.artifact_id, session.revision_id, file.path);
        this.uploadSessionFiles.set(`${session.id}:${file.path}`, {
          workspace_id: input.actor.workspace_id,
          upload_session_id: session.id,
          path: file.path,
          size_bytes: file.size_bytes,
          content_type: contentTypeForPath(file.path),
          r2_key: r2Key,
          uploaded_at: null,
          put_url_expires_at: expiresAt,
        });
      }
      this.addEvent(
        "api_key",
        input.actor.id,
        "upload_session.created",
        "upload_session",
        session.id,
        session.workspace_id,
        { artifact_id: artifactId, revision_id: revisionId, file_count: files.length },
        input.now,
      );
      return toUploadSessionRecord(session, this.filesForSession(session.id));
    });
  }

  async recordUploadedFile(input: { sessionId: string; path: string; uploadedAt: string }) {
    const file = this.uploadSessionFiles.get(`${input.sessionId}:${input.path}`);
    if (file) {
      file.uploaded_at = input.uploadedAt;
    }
  }

  async getUploadSession(input: { actor: ApiActor; sessionId: string }) {
    const session = this.uploadSessions.get(input.sessionId);
    if (!session || session.workspace_id !== input.actor.workspace_id) {
      return null;
    }
    return toUploadSessionRecord(session, this.filesForSession(session.id));
  }

  async finalizeUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: Array<{ path: string; objectKey: string; sizeBytes: number }>;
    now: string;
  }) {
    return this.runIdempotent(`upload.finalize:${input.actor.id}:${input.idempotencyKey}`, () => {
      const session = this.uploadSessions.get(input.sessionId);
      if (!session || session.workspace_id !== input.actor.workspace_id) {
        throw new Error("upload_session_not_found");
      }
      const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.objectKey}:${file.sizeBytes}`));
      const files = this.filesForSession(session.id);
      for (const file of files) {
        if (!observed.has(`${file.path}:${file.r2_key}:${file.size_bytes}`)) {
          throw new Error("upload_incomplete");
        }
      }
      session.status = "finalized";
      session.finalized_at = input.now;
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
      this.artifacts.set(artifact.id, artifact);
      for (const file of files) {
        this.artifactFiles.set(`${artifact.id}:${file.path}`, {
          ...file,
          artifact_id: artifact.id,
          revision_id: artifact.revision_id,
          uploaded_at: file.uploaded_at ?? input.now,
        });
      }
      this.addEvent(
        "api_key",
        input.actor.id,
        "artifact.published",
        "artifact",
        artifact.id,
        artifact.workspace_id,
        { revision_id: artifact.revision_id, file_count: artifact.file_count },
        input.now,
      );
      return buildPublishResult(artifact, session.id, this.options);
    });
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    const artifactId = input.token.split(".")[0] ?? input.token;
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
      return null;
    }
    return buildAgentView(artifact, this.filesForArtifact(artifact.id), input.contentBaseUrl);
  }

  async getAgentView(input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string }) {
    const artifact = this.artifacts.get(input.artifactId);
    if (
      !artifact ||
      artifact.workspace_id !== input.actor.workspace_id ||
      artifact.status !== "active" ||
      (input.revisionId && artifact.revision_id !== input.revisionId) ||
      new Date(artifact.expires_at).getTime() <= Date.now()
    ) {
      return null;
    }
    return buildAgentView(artifact, this.filesForArtifact(artifact.id), input.contentBaseUrl);
  }

  async runCleanup(input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize?: number;
    now: string;
  }) {
    const key = input.idempotencyKey ?? `cleanup:${input.actor.type}:${input.now}`;
    return this.runIdempotent(`admin.cleanup.run:${input.actor.type}:${input.actor.id}:${key}`, () =>
      this.runCleanupSync(input),
    );
  }

  private runCleanupSync(input: { actor: AdminActor; dryRun: boolean; batchSize?: number; now: string }) {
    const limit = input.batchSize ?? 100;
    const nowMs = new Date(input.now).getTime();
    const expiringArtifacts = [...this.artifacts.values()]
      .filter((artifact) => artifact.status === "active" && new Date(artifact.expires_at).getTime() <= nowMs)
      .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
      .slice(0, limit);
    const expiringSessions = [...this.uploadSessions.values()]
      .filter((session) => session.status === "pending" && new Date(session.expires_at).getTime() <= nowMs)
      .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
      .slice(0, limit);

    if (!input.dryRun) {
      for (const artifact of expiringArtifacts) {
        artifact.status = "expired";
        artifact.deleted_at = input.now;
        artifact.delete_reason = "expired";
        artifact.updated_at = input.now;
      }
      for (const session of expiringSessions) {
        session.status = "expired";
      }
      this.addEvent(
        input.actor.type,
        input.actor.id,
        "cleanup.run",
        "cleanup",
        "manual",
        null,
        { expired_artifacts: expiringArtifacts.length, expired_upload_sessions: expiringSessions.length },
        input.now,
      );
    }
    return {
      dry_run: input.dryRun,
      expired_artifacts: expiringArtifacts.length,
      expired_artifact_ids: input.dryRun ? [] : expiringArtifacts.map((artifact) => artifact.id),
      expired_upload_sessions: expiringSessions.length,
      deleted_r2_objects: 0,
      occurred_at: input.now,
    };
  }

  listArtifacts(workspaceId?: string, status?: string) {
    const data = [...this.artifacts.values()]
      .filter((artifact) => (workspaceId ? artifact.workspace_id === workspaceId : true))
      .filter((artifact) => (status ? artifact.status === status : true))
      .map(toArtifactSummary);
    return { data, page_info: { next_cursor: null, has_more: false } };
  }

  getArtifactDetail(artifactId: string) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return null;
    }
    return {
      ...toArtifactSummary(artifact),
      files: this.filesForArtifact(artifact.id).map(({ path, size_bytes, content_type, uploaded_at }) => ({
        path,
        size_bytes,
        content_type,
        uploaded_at: uploaded_at ?? artifact.created_at,
      })),
      operation_event_ids: [...this.operationEvents.values()]
        .filter((event) => event.target_id === artifact.id)
        .map((event) => event.id),
    };
  }

  deleteArtifact(input: { actor: AdminActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    const artifact = this.artifacts.get(input.artifactId);
    if (!artifact) {
      throw new Error("artifact_not_found");
    }
    const deletedAt = (input.now ?? new Date()).toISOString();
    const cacheKey = `admin.artifact.delete:${input.actor.type}:${input.actor.id}:${input.idempotencyKey}`;
    return this.runIdempotent(cacheKey, () => {
      artifact.status = "deleted";
      artifact.deleted_at = deletedAt;
      artifact.delete_reason = "admin_delete";
      artifact.updated_at = deletedAt;
      this.addEvent(
        input.actor.type,
        input.actor.id,
        "artifact.deleted",
        "artifact",
        artifact.id,
        artifact.workspace_id,
        {},
        deletedAt,
      );
      return { artifact_id: artifact.id, deleted_at: deletedAt };
    });
  }

  listOperationEvents() {
    return {
      data: [...this.operationEvents.values()].sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)),
      page_info: { next_cursor: null, has_more: false },
    };
  }

  async forceExpireArtifact(input: { artifactId: string; expiresAt: string }) {
    const artifact = this.artifacts.get(input.artifactId);
    if (!artifact) {
      return null;
    }
    artifact.expires_at = input.expiresAt;
    artifact.updated_at = new Date().toISOString();
    return { artifact_id: artifact.id, expires_at: artifact.expires_at };
  }

  private filesForSession(sessionId: string) {
    return [...this.uploadSessionFiles.values()].filter((file) => file.upload_session_id === sessionId);
  }

  private filesForArtifact(artifactId: string) {
    return [...this.artifactFiles.values()].filter((file) => file.artifact_id === artifactId);
  }

  private mustWorkspace(id: string) {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      throw new Error("workspace_not_found");
    }
    return workspace;
  }

  private mustApiKey(id: string) {
    const apiKey = this.apiKeys.get(id);
    if (!apiKey) {
      throw new Error("api_key_not_found");
    }
    return apiKey;
  }

  private runIdempotent<T>(key: string, run: () => T): T {
    if (this.idempotency.has(key)) {
      return this.idempotency.get(key) as T;
    }
    const result = run();
    this.idempotency.set(key, result);
    return result;
  }

  private addEvent(
    actorType: "api_key" | "admin" | "system",
    actorId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    workspaceId: string | null,
    details: Record<string, unknown>,
    occurredAt: string,
  ) {
    const event: OperationEvent = {
      id: createId("evt"),
      workspace_id: workspaceId,
      actor_type: actorType,
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      request_id: null,
      occurred_at: occurredAt,
    };
    this.operationEvents.set(event.id, event);
    return event;
  }
}

export function createLocalServices(options: RepositoryOptions) {
  const repo = new LocalRepository(options);
  return {
    repo,
    auth: {
      verifyApiKey: (apiKey: string) => repo.verifyApiKey(apiKey),
    },
    apiDb: repo,
    uploadDb: repo,
  };
}
