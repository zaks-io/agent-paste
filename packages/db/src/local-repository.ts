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
  ApiKeyActor,
  Artifact,
  OperationEvent,
  RepositoryOptions,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "./types.js";
import { contentTypeForPath, normalizeStoragePath, objectKeyFor, validateUpload } from "./validation.js";

const DEFAULT_MEMBER_SCOPES = ["publish", "read", "admin"] as const;

type ResolveWebMemberInput = { workosUserId: string; email: string; idempotencyKey?: string; now?: string };
type WebAuthDefaultApiKey = { api_key: ReturnType<typeof toApiKeySummary>; secret: string };
type WebAuthResponse = {
  workspace: ReturnType<typeof toWorkspaceSummary>;
  workspace_member: {
    id: string;
    workspace_id: string;
    email: string;
    scopes: string[];
    created_at: string;
    last_seen_at: string;
  };
  scopes: string[];
  default_api_key: WebAuthDefaultApiKey | null;
};

export class LocalRepository {
  readonly workspaces = new Map<string, Workspace>();
  readonly workspaceMembers = new Map<string, WorkspaceMember>();
  readonly apiKeys = new Map<string, ApiKey>();
  readonly artifacts = new Map<string, Artifact>();
  readonly artifactFiles = new Map<string, StoredFile>();
  readonly uploadSessions = new Map<string, UploadSession>();
  readonly uploadSessionFiles = new Map<string, StoredFile>();
  readonly operationEvents = new Map<string, OperationEvent>();
  private readonly idempotency = new Map<string, unknown>();
  private readonly webAuthIdempotency = new Map<string, WebAuthResponse | Promise<WebAuthResponse>>();

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

  async verifyApiKey(apiKeySecret: string): Promise<ApiKeyActor | null> {
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

  async resolveWebMember(input: ResolveWebMemberInput) {
    if (input.idempotencyKey) {
      const cached = this.webAuthIdempotency.get(input.idempotencyKey);
      if (cached) {
        return cached;
      }
      const pending = this.resolveWebMemberOnce(input);
      this.webAuthIdempotency.set(input.idempotencyKey, pending);
      try {
        const response = await pending;
        this.webAuthIdempotency.set(input.idempotencyKey, response);
        return response;
      } catch (error) {
        this.webAuthIdempotency.delete(input.idempotencyKey);
        throw error;
      }
    }
    return this.resolveWebMemberOnce(input);
  }

  private async resolveWebMemberOnce(input: ResolveWebMemberInput): Promise<WebAuthResponse> {
    const now = input.now ?? new Date().toISOString();
    const existing = [...this.workspaceMembers.values()].find((member) => member.workos_user_id === input.workosUserId);
    if (existing) {
      existing.email = input.email;
      existing.last_seen_at = now;
      return this.webAuthResponse(existing, null);
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: `${input.email.split("@")[0] ?? "user"}'s Workspace`,
      contact_email: input.email,
      created_at: now,
      updated_at: now,
    };
    this.workspaces.set(workspace.id, workspace);

    const member: WorkspaceMember = {
      id: createId("mem"),
      workspace_id: workspace.id,
      workos_user_id: input.workosUserId,
      email: input.email,
      scopes: [...DEFAULT_MEMBER_SCOPES],
      created_at: now,
      last_seen_at: now,
    };
    this.workspaceMembers.set(member.id, member);

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
    this.apiKeys.set(apiKey.id, apiKey);
    this.addEvent("system", "web-auth", "workspace.created", "workspace", workspace.id, workspace.id, {}, now);
    this.addEvent(
      "system",
      "web-auth",
      "api_key.created",
      "api_key",
      apiKey.id,
      workspace.id,
      { name: apiKey.name, public_id: apiKey.public_id },
      now,
    );
    return this.webAuthResponse(member, { api_key: toApiKeySummary(apiKey), secret: generated.secret });
  }

  async getWebMemberByWorkOsUserId(input: { workosUserId: string }) {
    const member = [...this.workspaceMembers.values()].find((entry) => entry.workos_user_id === input.workosUserId);
    if (!member) {
      return null;
    }
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
    const member = this.mustWorkspaceMember(actor.id);
    return {
      workspace: toWorkspaceSummary(this.mustWorkspace(actor.workspace_id)),
      workspace_member: this.toWorkspaceMemberSummary(member),
      usage_policy: USAGE_POLICY,
      default_key_first_run: false,
    };
  }

  listWebArtifacts(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    const limit = normalizeWebArtifactLimit(pagination.limit);
    const cursor = pagination.cursor ? decodeWebArtifactCursor(pagination.cursor) : null;
    const rows = [...this.artifacts.values()]
      .filter((artifact) => artifact.workspace_id === actor.workspace_id)
      .filter(
        (artifact) =>
          !cursor ||
          artifact.created_at < cursor.created_at ||
          (artifact.created_at === cursor.created_at && artifact.id < cursor.id),
      )
      .sort(compareArtifactsForWeb);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const hasMore = limit < rows.length;
    return {
      items: page.map(toWebArtifactRow),
      page_info: {
        next_cursor: hasMore && last ? encodeWebArtifactCursor(last) : null,
        has_more: hasMore,
      },
    };
  }

  getWebArtifact(actor: ApiActor, artifactId: string) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.workspace_id !== actor.workspace_id) {
      return null;
    }
    return {
      ...toWebArtifactRow(artifact),
      entrypoint: artifact.entrypoint,
      file_count: artifact.file_count,
      size_bytes: artifact.size_bytes,
    };
  }

  listWebApiKeys(actor: ApiActor) {
    const items = [...this.apiKeys.values()]
      .filter((apiKey) => apiKey.workspace_id === actor.workspace_id)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((apiKey) => ({
        ...toApiKeySummary(apiKey),
        expires_at: null,
        revoked: apiKey.revoked_at !== null,
      }));
    return { items, page_info: { next_cursor: null, has_more: false } };
  }

  async createWebApiKey(input: { actor: ApiActor; idempotencyKey: string; name: string; now?: Date }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    const member = this.mustWorkspaceMember(input.actor.id);
    const key = `web.api_key.create:${input.actor.type}:${input.actor.id}:${input.idempotencyKey}`;
    if (this.idempotency.has(key)) {
      return this.idempotency.get(key) as { api_key: ReturnType<typeof toApiKeySummary>; secret: string };
    }
    const generated = await generateApiKey(this.options.apiKeyEnv ?? "preview", this.options.apiKeyPepper);
    const now = (input.now ?? new Date()).toISOString();
    return this.runIdempotent(key, () => {
      const apiKey: ApiKey = {
        id: createId("key"),
        workspace_id: member.workspace_id,
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
        "member",
        member.id,
        "api_key.created",
        "api_key",
        apiKey.id,
        member.workspace_id,
        { name: apiKey.name, public_id: apiKey.public_id },
        now,
      );
      return { api_key: toApiKeySummary(apiKey), secret: generated.secret };
    });
  }

  async revokeWebApiKey(input: { actor: ApiActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    if (input.actor.type !== "member") {
      throw new Error(`unexpected_actor_type:${input.actor.type}`);
    }
    const member = this.mustWorkspaceMember(input.actor.id);
    const apiKey = this.apiKeys.get(input.apiKeyId);
    if (!apiKey || apiKey.workspace_id !== member.workspace_id) {
      throw new Error("api_key_not_found");
    }
    const revokedAt = (input.now ?? new Date()).toISOString();
    return this.runIdempotent(
      `web.api_key.revoke:${input.actor.type}:${input.actor.id}:${input.idempotencyKey}`,
      () => {
        apiKey.revoked_at = revokedAt;
        this.addEvent(
          "member",
          member.id,
          "api_key.revoked",
          "api_key",
          apiKey.id,
          member.workspace_id,
          { public_id: apiKey.public_id },
          apiKey.revoked_at,
        );
        return { api_key: toApiKeySummary(apiKey), revoked_at: apiKey.revoked_at };
      },
    );
  }

  listWebAuditEvents(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    const limit = normalizeWebAuditLimit(pagination.limit);
    const cursor = pagination.cursor ? decodeWebAuditCursor(pagination.cursor) : null;
    const rows = [...this.operationEvents.values()]
      .filter((event) => event.workspace_id === actor.workspace_id)
      .filter(
        (event) =>
          !cursor ||
          event.occurred_at < cursor.occurred_at ||
          (event.occurred_at === cursor.occurred_at && event.id < cursor.id),
      )
      .sort(compareOperationEventsForWeb);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const hasMore = limit < rows.length;
    return {
      items: page.map(toWebAuditRow),
      page_info: {
        next_cursor: hasMore && last ? encodeWebAuditCursor(last) : null,
        has_more: hasMore,
      },
    };
  }

  getWebSettings(actor: ApiActor) {
    const workspace = this.mustWorkspace(actor.workspace_id);
    return {
      workspace_name: workspace.name,
      auto_deletion_days: Math.floor(USAGE_POLICY.default_ttl_seconds / (24 * 60 * 60)),
      usage_policy: {
        artifacts_per_day: 0,
        bytes_per_day: USAGE_POLICY.artifact_size_cap_bytes,
      },
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

  private mustWorkspaceMember(id: string) {
    const member = this.workspaceMembers.get(id);
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

  private webAuthResponse(
    member: WorkspaceMember,
    defaultApiKey: { api_key: ReturnType<typeof toApiKeySummary>; secret: string } | null,
  ) {
    return {
      workspace: toWorkspaceSummary(this.mustWorkspace(member.workspace_id)),
      workspace_member: this.toWorkspaceMemberSummary(member),
      scopes: member.scopes,
      default_api_key: defaultApiKey,
    };
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
    actorType: "api_key" | "member" | "admin" | "system",
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

function compareArtifactsForWeb(left: Artifact, right: Artifact) {
  const created = right.created_at.localeCompare(left.created_at);
  return created === 0 ? right.id.localeCompare(left.id) : created;
}

function encodeWebArtifactCursor(artifact: Artifact): string {
  return btoa(JSON.stringify({ created_at: artifact.created_at, id: artifact.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeWebArtifactCursor(cursor: string) {
  try {
    const padded = cursor
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const raw = JSON.parse(atob(padded)) as { created_at?: unknown; id?: unknown };
    if (typeof raw.created_at !== "string" || typeof raw.id !== "string") {
      throw new Error("invalid_cursor");
    }
    const createdAt = new Date(raw.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("invalid_cursor");
    }
    return { created_at: createdAt.toISOString(), id: raw.id };
  } catch {
    throw new Error("invalid_cursor");
  }
}

function normalizeWebArtifactLimit(limit: number | undefined) {
  const resolved = limit ?? 50;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    throw new Error("invalid_pagination_limit");
  }
  return resolved;
}

function compareOperationEventsForWeb(left: OperationEvent, right: OperationEvent) {
  const occurred = right.occurred_at.localeCompare(left.occurred_at);
  return occurred === 0 ? right.id.localeCompare(left.id) : occurred;
}

function encodeWebAuditCursor(event: OperationEvent): string {
  return btoa(JSON.stringify({ occurred_at: event.occurred_at, id: event.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeWebAuditCursor(cursor: string) {
  try {
    const padded = cursor
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const raw = JSON.parse(atob(padded)) as { occurred_at?: unknown; id?: unknown };
    if (typeof raw.occurred_at !== "string" || typeof raw.id !== "string") {
      throw new Error("invalid_cursor");
    }
    const occurredAt = new Date(raw.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new Error("invalid_cursor");
    }
    return { occurred_at: occurredAt.toISOString(), id: raw.id };
  } catch {
    throw new Error("invalid_cursor");
  }
}

function normalizeWebAuditLimit(limit: number | undefined) {
  const resolved = limit ?? 50;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    throw new Error("invalid_pagination_limit");
  }
  return resolved;
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
