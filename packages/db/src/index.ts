import { type CommandActor, type CommandAuditEvent, IdempotencyInFlightError, runCommand } from "@agent-paste/commands";
import postgres from "postgres";

export { IdempotencyInFlightError };

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const USAGE_POLICY = {
  file_size_cap_bytes: 10 * 1024 * 1024,
  artifact_size_cap_bytes: MAX_ARTIFACT_BYTES,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 600,
  upload_session_ttl_seconds: DEFAULT_UPLOAD_SESSION_TTL_MS / 1000,
  default_ttl_seconds: 30 * 24 * 60 * 60,
  min_ttl_seconds: 24 * 60 * 60,
  max_ttl_seconds: 90 * 24 * 60 * 60,
} as const;

export type ApiActor = {
  type: "api_key";
  id: string;
  workspace_id: string;
  scopes?: string[];
};

export type AdminActor = { type: "admin" | "system"; id: string };

function apiCommandActor(actor: ApiActor): CommandActor {
  return { type: "api_key", id: actor.id, workspaceId: actor.workspace_id };
}

function adminCommandActor(actor: AdminActor, workspaceId: string | null): CommandActor {
  return { type: actor.type, id: actor.id, workspaceId };
}

export type SqlValue = string | number | boolean | null | Record<string, unknown> | SqlValue[];
export type SqlQueryResult<Row = Record<string, unknown>> = { rows: Row[] };
export type SqlExecutor = {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<SqlQueryResult<Row>>;
  transaction?<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

export type HyperdriveBinding = {
  connectionString: string;
};

type PostgresUnsafeClient = {
  unsafe<Row extends Record<string, unknown>[] = Record<string, unknown>[]>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<Row>;
  begin?<T>(run: (tx: PostgresUnsafeClient) => Promise<T>): Promise<T>;
};

type Workspace = {
  id: string;
  name: string;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
};

type ApiKey = {
  id: string;
  workspace_id: string;
  public_id: string;
  name: string;
  secret_hmac: string;
  pepper_kid: number;
  scopes: Array<"publish" | "read">;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

type Artifact = {
  id: string;
  workspace_id: string;
  revision_id: string;
  status: "active" | "deleted" | "expired";
  title: string;
  entrypoint: string;
  file_count: number;
  size_bytes: number;
  expires_at: string;
  created_by_api_key_id: string;
  deleted_at: string | null;
  delete_reason: string | null;
  created_at: string;
  updated_at: string;
};

type UploadSession = {
  id: string;
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
  status: "pending" | "finalized" | "expired" | "failed";
  title: string;
  entrypoint: string;
  artifact_expires_at: string;
  file_count: number;
  size_bytes: number;
  created_by_api_key_id: string;
  expires_at: string;
  created_at: string;
  finalized_at: string | null;
};

type StoredFile = {
  workspace_id: string;
  artifact_id?: string;
  revision_id?: string;
  upload_session_id?: string;
  path: string;
  size_bytes: number;
  content_type: string;
  r2_key: string;
  uploaded_at: string | null;
  put_url_expires_at?: string;
};

type OperationEvent = {
  id: string;
  workspace_id: string | null;
  actor_type: "api_key" | "admin" | "system";
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  request_id: string | null;
  occurred_at: string;
};

export class LocalRepository {
  readonly workspaces = new Map<string, Workspace>();
  readonly apiKeys = new Map<string, ApiKey>();
  readonly artifacts = new Map<string, Artifact>();
  readonly artifactFiles = new Map<string, StoredFile>();
  readonly uploadSessions = new Map<string, UploadSession>();
  readonly uploadSessionFiles = new Map<string, StoredFile>();
  readonly operationEvents = new Map<string, OperationEvent>();
  private readonly idempotency = new Map<string, unknown>();

  constructor(
    private readonly options: {
      apiKeyPepper: string;
      apiKeyEnv?: "preview" | "production" | "live";
      apiBaseUrl?: string;
      contentBaseUrl?: string;
    },
  ) {}

  async createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace> {
    const now = (input.now ?? new Date()).toISOString();
    return this.runIdempotent(`admin.workspace.create:${input.actor.id}:${input.idempotencyKey}`, () => {
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
    const generated = await generateApiKey(this.options.apiKeyEnv ?? "preview", this.options.apiKeyPepper);
    const now = (input.now ?? new Date()).toISOString();
    return this.runIdempotent(`admin.api_key.create:${input.actor.id}:${input.idempotencyKey}`, () => {
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
    return this.runIdempotent(`admin.api_key.revoke:${input.actor.id}:${input.idempotencyKey}`, () => {
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
    });
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
        {
          artifact_id: artifactId,
          revision_id: revisionId,
          file_count: files.length,
        },
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
      const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.sizeBytes}`));
      const files = this.filesForSession(session.id);
      for (const file of files) {
        if (!observed.has(`${file.path}:${file.size_bytes}`)) {
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
        {
          revision_id: artifact.revision_id,
          file_count: artifact.file_count,
        },
        input.now,
      );
      return this.publishResultForArtifact(artifact, session.id);
    });
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    const artifactId = input.token.split(".")[0] ?? input.token;
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
      return null;
    }
    return this.agentViewForArtifact(artifact, input.contentBaseUrl);
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
    return this.agentViewForArtifact(artifact, input.contentBaseUrl);
  }

  async runCleanup(input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize?: number;
    now: string;
  }) {
    const key = input.idempotencyKey ?? `cleanup:${input.actor.type}:${input.now}`;
    return this.runIdempotent(`admin.cleanup.run:${input.actor.id}:${key}`, () => this.runCleanupSync(input));
  }

  private runCleanupSync(input: { actor: AdminActor; dryRun: boolean; now: string }) {
    let expiredArtifacts = 0;
    let expiredUploadSessions = 0;
    for (const artifact of this.artifacts.values()) {
      if (artifact.status === "active" && new Date(artifact.expires_at).getTime() <= new Date(input.now).getTime()) {
        expiredArtifacts += 1;
        if (!input.dryRun) {
          artifact.status = "expired";
          artifact.deleted_at = input.now;
          artifact.delete_reason = "expired";
        }
      }
    }
    for (const session of this.uploadSessions.values()) {
      if (session.status === "pending" && new Date(session.expires_at).getTime() <= new Date(input.now).getTime()) {
        expiredUploadSessions += 1;
        if (!input.dryRun) {
          session.status = "expired";
        }
      }
    }
    if (!input.dryRun) {
      this.addEvent(
        input.actor.type,
        input.actor.id,
        "cleanup.run",
        "cleanup",
        "manual",
        null,
        {
          expired_artifacts: expiredArtifacts,
          expired_upload_sessions: expiredUploadSessions,
        },
        input.now,
      );
    }
    return {
      dry_run: input.dryRun,
      expired_artifacts: expiredArtifacts,
      expired_artifact_ids: [...this.artifacts.values()]
        .filter((artifact) => artifact.deleted_at === input.now && artifact.delete_reason === "expired")
        .map((artifact) => artifact.id),
      expired_upload_sessions: expiredUploadSessions,
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
    return this.runIdempotent(`admin.artifact.delete:${input.actor.id}:${input.idempotencyKey}`, () => {
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

  private publishResultForArtifact(artifact: Artifact, uploadSessionId: string) {
    const contentBaseUrl = this.options.contentBaseUrl ?? "http://127.0.0.1:8789";
    const apiBaseUrl = this.options.apiBaseUrl ?? "http://127.0.0.1:8787";
    return {
      upload_session_id: uploadSessionId,
      artifact_id: artifact.id,
      revision_id: artifact.revision_id,
      title: artifact.title,
      view_url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${artifact.entrypoint}`,
      agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${artifact.revision_id}`,
      expires_at: artifact.expires_at,
    };
  }

  private agentViewForArtifact(artifact: Artifact, contentBaseUrl: string) {
    const files = this.filesForArtifact(artifact.id);
    return {
      artifact_id: artifact.id,
      revision_id: artifact.revision_id,
      title: artifact.title,
      created_at: artifact.created_at,
      expires_at: artifact.expires_at,
      entrypoint: artifact.entrypoint,
      view_url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${artifact.entrypoint}`,
      files: files.map((file) => ({
        path: file.path,
        size_bytes: file.size_bytes,
        content_type: file.content_type,
        url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${file.path}`,
      })),
    };
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

export function createLocalServices(options: { apiKeyPepper: string; apiBaseUrl?: string; contentBaseUrl?: string }) {
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

export class PostgresRepository {
  constructor(
    private readonly db: SqlExecutor,
    private readonly options: {
      apiKeyPepper: string;
      apiKeyEnv?: "preview" | "production" | "live";
      apiBaseUrl?: string;
      contentBaseUrl?: string;
    },
  ) {}

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
      await tx.query(
        `insert into workspaces (id, name, contact_email, created_at, updated_at)
           values ($1, $2, $3, $4, $5)`,
        [workspace.id, workspace.name, workspace.contact_email, now, now],
      );
      await this.insertEvent(
        tx,
        input.actor.type,
        input.actor.id,
        "workspace.created",
        "workspace",
        workspace.id,
        workspace.id,
        { email: input.email },
        now,
      );
      return { result: workspace };
    });
  }

  async listWorkspaces() {
    const result = await this.db.query<Workspace>(
      `select id, name, contact_email, created_at, updated_at
       from workspaces
       order by created_at desc`,
    );
    return { data: result.rows.map(toWorkspaceDetail), page_info: { next_cursor: null, has_more: false } };
  }

  async createApiKey(input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
    now?: Date;
  }) {
    const now = (input.now ?? new Date()).toISOString();
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
    return this.runAdminCommand(
      input.actor,
      "admin.api_key.create",
      input.idempotencyKey,
      input.workspaceId,
      now,
      async (tx) => {
        await this.mustWorkspace(tx, input.workspaceId);
        await tx.query(
          `insert into api_keys
             (id, workspace_id, public_id, name, secret_hmac, pepper_kid, scopes, revoked_at, last_used_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, null, null, $8)`,
          [
            apiKey.id,
            apiKey.workspace_id,
            apiKey.public_id,
            apiKey.name,
            apiKey.secret_hmac,
            apiKey.pepper_kid,
            apiKey.scopes,
            now,
          ],
        );
        await this.insertEvent(
          tx,
          input.actor.type,
          input.actor.id,
          "api_key.created",
          "api_key",
          apiKey.id,
          apiKey.workspace_id,
          { name: apiKey.name, public_id: apiKey.public_id },
          now,
        );
        return { result: { api_key: toApiKeySummary(apiKey), secret: generated.secret } };
      },
    );
  }

  async revokeApiKey(input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    const revokedAt = (input.now ?? new Date()).toISOString();
    const found = await this.mustApiKey(this.db, input.apiKeyId);
    return this.runAdminCommand(
      input.actor,
      "admin.api_key.revoke",
      input.idempotencyKey,
      found.workspace_id,
      revokedAt,
      async (tx) => {
        const apiKey = await this.mustApiKey(tx, input.apiKeyId);
        const updated = { ...apiKey, revoked_at: revokedAt };
        await tx.query(`update api_keys set revoked_at = $2 where id = $1`, [input.apiKeyId, revokedAt]);
        await this.insertEvent(
          tx,
          input.actor.type,
          input.actor.id,
          "api_key.revoked",
          "api_key",
          apiKey.id,
          apiKey.workspace_id,
          { public_id: apiKey.public_id },
          revokedAt,
        );
        return { result: { api_key: toApiKeySummary(updated), revoked_at: revokedAt } };
      },
    );
  }

  async verifyApiKey(apiKeySecret: string): Promise<ApiActor | null> {
    const parsed = parseApiKey(apiKeySecret);
    if (!parsed) {
      return null;
    }
    const result = await this.db.query<ApiKey>(
      `select id, workspace_id, public_id, name, secret_hmac, pepper_kid, scopes, revoked_at, last_used_at, created_at
       from api_keys
       where public_id = $1
       limit 1`,
      [parsed.publicId],
    );
    const record = result.rows[0];
    if (!record || record.revoked_at) {
      return null;
    }
    const ok = await verifyApiKeySecret(apiKeySecret, record.public_id, record.secret_hmac, this.options.apiKeyPepper);
    if (!ok) {
      return null;
    }
    await this.db.query(`update api_keys set last_used_at = $2 where id = $1`, [record.id, new Date().toISOString()]);
    return { type: "api_key", id: record.id, workspace_id: record.workspace_id, scopes: record.scopes };
  }

  async getWhoami(actor: ApiActor) {
    const apiKey = await this.mustApiKey(this.db, actor.id);
    const workspace = await this.mustWorkspace(this.db, apiKey.workspace_id);
    return {
      actor: { type: "api_key", id: apiKey.id, name: apiKey.name },
      workspace: toWorkspaceSummary(workspace),
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
    return this.runIdempotent(input.actor, "upload.session.create", input.idempotencyKey, input.now, async (tx) => {
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
      await tx.query(
        `insert into upload_sessions
           (id, workspace_id, artifact_id, revision_id, status, title, entrypoint, artifact_expires_at, file_count,
            size_bytes, created_by_api_key_id, expires_at, created_at, finalized_at)
         values ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11, $12, null)`,
        [
          session.id,
          session.workspace_id,
          session.artifact_id,
          session.revision_id,
          session.title,
          session.entrypoint,
          session.artifact_expires_at,
          session.file_count,
          session.size_bytes,
          session.created_by_api_key_id,
          session.expires_at,
          session.created_at,
        ],
      );
      const storedFiles: StoredFile[] = [];
      for (const file of files) {
        const storedFile: StoredFile = {
          workspace_id: input.actor.workspace_id,
          upload_session_id: session.id,
          path: file.path,
          size_bytes: file.size_bytes,
          content_type: contentTypeForPath(file.path),
          r2_key: objectKeyFor(session.artifact_id, session.revision_id, file.path),
          uploaded_at: null,
          put_url_expires_at: expiresAt,
        };
        storedFiles.push(storedFile);
        await tx.query(
          `insert into upload_session_files
             (workspace_id, upload_session_id, path, size_bytes, served_content_type, r2_key, uploaded_at, put_url_expires_at)
           values ($1, $2, $3, $4, $5, $6, null, $7)`,
          [
            storedFile.workspace_id,
            session.id,
            storedFile.path,
            storedFile.size_bytes,
            storedFile.content_type,
            storedFile.r2_key,
            storedFile.put_url_expires_at ?? session.expires_at,
          ],
        );
      }
      await this.insertEvent(
        tx,
        "api_key",
        input.actor.id,
        "upload_session.created",
        "upload_session",
        session.id,
        session.workspace_id,
        {
          artifact_id: artifactId,
          revision_id: revisionId,
          file_count: files.length,
        },
        input.now,
      );
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
    const params: SqlValue[] = [input.sessionId, input.path, input.uploadedAt];
    let predicate = "";
    if (input.objectKey) {
      params.push(input.objectKey);
      predicate += ` and r2_key = $${params.length}`;
    }
    if (typeof input.sizeBytes === "number") {
      params.push(input.sizeBytes);
      predicate += ` and size_bytes = $${params.length}`;
    }
    await this.db.query(
      `update upload_session_files
       set uploaded_at = $3
       where upload_session_id = $1 and path = $2${predicate}`,
      params,
    );
  }

  async getUploadSession(input: { actor: ApiActor; sessionId: string }) {
    const session = await this.findUploadSession(input.sessionId, input.actor.workspace_id);
    if (!session) {
      return null;
    }
    return toUploadSessionRecord(session, await this.filesForSession(this.db, session.id));
  }

  async finalizeUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: Array<{ path: string; objectKey: string; sizeBytes: number }>;
    now: string;
  }) {
    return this.runIdempotent(input.actor, "upload.session.finalize", input.idempotencyKey, input.now, async (tx) => {
      const session = await this.findUploadSession(input.sessionId, input.actor.workspace_id, tx);
      if (!session) {
        throw new Error("upload_session_not_found");
      }
      const files = await this.filesForSession(tx, session.id);
      const observed = new Set(input.observedFiles.map((file) => `${file.path}:${file.objectKey}:${file.sizeBytes}`));
      for (const file of files) {
        if (!observed.has(`${file.path}:${file.r2_key}:${file.size_bytes}`)) {
          throw new Error("upload_incomplete");
        }
      }
      await tx.query(`update upload_sessions set status = 'finalized', finalized_at = $2 where id = $1`, [
        session.id,
        input.now,
      ]);
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
      await tx.query(
        `insert into artifacts
           (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
            created_by_api_key_id, deleted_at, delete_reason, created_at, updated_at)
         values ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, null, null, $10, $10)`,
        [
          artifact.id,
          artifact.workspace_id,
          artifact.revision_id,
          artifact.title,
          artifact.entrypoint,
          artifact.file_count,
          artifact.size_bytes,
          artifact.expires_at,
          artifact.created_by_api_key_id,
          input.now,
        ],
      );
      for (const file of files) {
        await tx.query(
          `insert into artifact_files
             (workspace_id, artifact_id, revision_id, path, size_bytes, served_content_type, r2_key, uploaded_at)
           values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, $9))`,
          [
            artifact.workspace_id,
            artifact.id,
            artifact.revision_id,
            file.path,
            file.size_bytes,
            file.content_type,
            file.r2_key,
            file.uploaded_at,
            input.now,
          ],
        );
      }
      await this.insertEvent(
        tx,
        "api_key",
        input.actor.id,
        "artifact.published",
        "artifact",
        artifact.id,
        artifact.workspace_id,
        {
          revision_id: artifact.revision_id,
          file_count: artifact.file_count,
        },
        input.now,
      );
      return this.publishResultForArtifact(artifact, session.id);
    });
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    const artifactId = input.token.split(".")[0] ?? input.token;
    const artifact = await this.findArtifact(artifactId);
    if (!artifact || artifact.status !== "active" || new Date(artifact.expires_at).getTime() <= Date.now()) {
      return null;
    }
    return this.agentViewForArtifact(artifact, input.contentBaseUrl);
  }

  async getAgentView(input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string }) {
    const artifact = await this.findArtifact(input.artifactId, input.actor.workspace_id);
    if (
      !artifact ||
      artifact.status !== "active" ||
      (input.revisionId && artifact.revision_id !== input.revisionId) ||
      new Date(artifact.expires_at).getTime() <= Date.now()
    ) {
      return null;
    }
    return this.agentViewForArtifact(artifact, input.contentBaseUrl);
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
      await this.insertEvent(
        tx,
        input.actor.type,
        input.actor.id,
        "cleanup.run",
        "cleanup",
        "manual",
        null,
        {
          expired_artifacts: expiredArtifacts.rows.length,
          expired_upload_sessions: expiredSessions.rows.length,
        },
        input.now,
      );
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
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (workspaceId) {
      params.push(workspaceId);
      where.push(`workspace_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const result = await this.db.query<Artifact>(
      `select id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
              created_by_api_key_id, deleted_at, delete_reason, created_at, updated_at
       from artifacts
       ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
       order by created_at desc`,
      params,
    );
    return { data: result.rows.map(toArtifactSummary), page_info: { next_cursor: null, has_more: false } };
  }

  async getArtifactDetail(artifactId: string) {
    const artifact = await this.findArtifact(artifactId);
    if (!artifact) {
      return null;
    }
    const files = await this.filesForArtifact(this.db, artifact.id);
    const events = await this.db.query<{ id: string }>(
      `select id from operation_events where target_id = $1 order by occurred_at asc`,
      [artifact.id],
    );
    return {
      ...toArtifactSummary(artifact),
      files: files.map(({ path, size_bytes, content_type, uploaded_at }) => ({
        path,
        size_bytes,
        content_type,
        uploaded_at: uploaded_at ?? artifact.created_at,
      })),
      operation_event_ids: events.rows.map((event) => event.id),
    };
  }

  async deleteArtifact(input: { actor: AdminActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    const deletedAt = (input.now ?? new Date()).toISOString();
    const target = await this.findArtifact(input.artifactId);
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
        const artifact = await this.findArtifact(input.artifactId, undefined, tx);
        if (!artifact) {
          throw new Error("artifact_not_found");
        }
        await tx.query(
          `update artifacts
           set status = 'deleted', deleted_at = $2, delete_reason = 'admin_delete', updated_at = $2
           where id = $1`,
          [input.artifactId, deletedAt],
        );
        await this.insertEvent(
          tx,
          input.actor.type,
          input.actor.id,
          "artifact.deleted",
          "artifact",
          artifact.id,
          artifact.workspace_id,
          {},
          deletedAt,
        );
        return { result: { artifact_id: artifact.id, deleted_at: deletedAt } };
      },
    );
  }

  async listOperationEvents() {
    const result = await this.db.query<OperationEvent>(
      `select id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at
       from operation_events
       order by occurred_at desc`,
    );
    return { data: result.rows, page_info: { next_cursor: null, has_more: false } };
  }

  private async runIdempotent<T>(
    actor: ApiActor,
    operation: string,
    idempotencyKey: string,
    now: string,
    run: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const command = await runCommand<T>({
      executor: this.db,
      actor: apiCommandActor(actor),
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
    const command = await runCommand<T>({
      executor: this.db,
      actor: adminCommandActor(actor, workspaceId),
      operation,
      idempotencyKey,
      workspaceId,
      now,
      handler: run,
    });
    return command.result;
  }

  private async mustWorkspace(db: SqlExecutor, id: string) {
    const result = await db.query<Workspace>(
      `select id, name, contact_email, created_at, updated_at
       from workspaces
       where id = $1
       limit 1`,
      [id],
    );
    const workspace = result.rows[0];
    if (!workspace) {
      throw new Error("workspace_not_found");
    }
    return workspace;
  }

  private async mustApiKey(db: SqlExecutor, id: string) {
    const result = await db.query<ApiKey>(
      `select id, workspace_id, public_id, name, secret_hmac, pepper_kid, scopes, revoked_at, last_used_at, created_at
       from api_keys
       where id = $1
       limit 1`,
      [id],
    );
    const apiKey = result.rows[0];
    if (!apiKey) {
      throw new Error("api_key_not_found");
    }
    return apiKey;
  }

  private async findUploadSession(sessionId: string, workspaceId?: string, db: SqlExecutor = this.db) {
    const params: SqlValue[] = [sessionId];
    const workspaceFilter = workspaceId ? " and workspace_id = $2" : "";
    if (workspaceId) {
      params.push(workspaceId);
    }
    const result = await db.query<UploadSession>(
      `select id, workspace_id, artifact_id, revision_id, status, title, entrypoint, artifact_expires_at,
              file_count, size_bytes, created_by_api_key_id, expires_at, created_at, finalized_at
       from upload_sessions
       where id = $1${workspaceFilter}
       limit 1`,
      params,
    );
    return result.rows[0] ?? null;
  }

  private async findArtifact(artifactId: string, workspaceId?: string, db: SqlExecutor = this.db) {
    const params: SqlValue[] = [artifactId];
    const workspaceFilter = workspaceId ? " and workspace_id = $2" : "";
    if (workspaceId) {
      params.push(workspaceId);
    }
    const result = await db.query<Artifact>(
      `select id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at,
              created_by_api_key_id, deleted_at, delete_reason, created_at, updated_at
       from artifacts
       where id = $1${workspaceFilter}
       limit 1`,
      params,
    );
    return result.rows[0] ?? null;
  }

  private async filesForSession(db: SqlExecutor, sessionId: string) {
    const result = await db.query<UploadSessionFileRow>(
      `select workspace_id, upload_session_id, path, size_bytes, served_content_type, r2_key, uploaded_at, put_url_expires_at
       from upload_session_files
       where upload_session_id = $1
       order by path asc`,
      [sessionId],
    );
    return result.rows.map(uploadSessionFileFromRow);
  }

  private async filesForArtifact(db: SqlExecutor, artifactId: string) {
    const result = await db.query<ArtifactFileRow>(
      `select workspace_id, artifact_id, revision_id, path, size_bytes, served_content_type, r2_key, uploaded_at
       from artifact_files
       where artifact_id = $1
       order by path asc`,
      [artifactId],
    );
    return result.rows.map(artifactFileFromRow);
  }

  private async agentViewForArtifact(artifact: Artifact, contentBaseUrl: string) {
    const files = await this.filesForArtifact(this.db, artifact.id);
    return {
      artifact_id: artifact.id,
      revision_id: artifact.revision_id,
      title: artifact.title,
      created_at: artifact.created_at,
      expires_at: artifact.expires_at,
      entrypoint: artifact.entrypoint,
      view_url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${artifact.entrypoint}`,
      files: files.map((file) => ({
        path: file.path,
        size_bytes: file.size_bytes,
        content_type: file.content_type,
        url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${file.path}`,
      })),
    };
  }

  private publishResultForArtifact(artifact: Artifact, uploadSessionId: string) {
    const contentBaseUrl = this.options.contentBaseUrl ?? "http://127.0.0.1:8789";
    const apiBaseUrl = this.options.apiBaseUrl ?? "http://127.0.0.1:8787";
    return {
      upload_session_id: uploadSessionId,
      artifact_id: artifact.id,
      revision_id: artifact.revision_id,
      title: artifact.title,
      view_url: `${contentBaseUrl}/v/${artifact.id}.${artifact.revision_id}/${artifact.entrypoint}`,
      agent_view_url: `${apiBaseUrl}/v1/public/agent-view/${artifact.id}.${artifact.revision_id}`,
      expires_at: artifact.expires_at,
    };
  }

  private async insertEvent(
    db: SqlExecutor,
    actorType: "api_key" | "admin" | "system",
    actorId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    workspaceId: string | null,
    details: Record<string, unknown>,
    occurredAt: string,
  ) {
    await db.query(
      `insert into operation_events
         (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, null, $9)`,
      [createId("evt"), workspaceId, actorType, actorId, action, targetType, targetId, details, occurredAt],
    );
  }
}

export function createPostgresServices(options: {
  executor: SqlExecutor;
  apiKeyPepper: string;
  apiKeyEnv?: "preview" | "production" | "live";
  apiBaseUrl?: string;
  contentBaseUrl?: string;
}) {
  const repo = new PostgresRepository(options.executor, options);
  return {
    repo,
    auth: {
      verifyApiKey: (apiKey: string) => repo.verifyApiKey(apiKey),
    },
    apiDb: repo,
    uploadDb: repo,
  };
}

export function createHyperdriveExecutor(binding: HyperdriveBinding | string): SqlExecutor {
  const connectionString = typeof binding === "string" ? binding : binding.connectionString;
  const sql = postgres(connectionString, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  }) as unknown as PostgresUnsafeClient;
  return createPostgresExecutor(sql);
}

export function createPostgresExecutor(sql: PostgresUnsafeClient): SqlExecutor {
  return {
    async query<Row = Record<string, unknown>>(query: string, params: readonly SqlValue[] = []) {
      const rows = await sql.unsafe(query, params);
      return { rows: rows as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      if (!sql.begin) {
        return run(createPostgresExecutor(sql));
      }
      return sql.begin((tx) => run(createPostgresExecutor(tx)));
    },
  };
}

export function createPostgresHttpExecutor(options: {
  endpoint: string;
  token?: string;
  fetch?: typeof fetch;
}): SqlExecutor {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({ sql, params }),
      });
      if (!response.ok) {
        throw new Error(`postgres_http_error:${response.status}`);
      }
      const body = (await response.json()) as { rows?: Row[] };
      return { rows: body.rows ?? [] };
    },
  };
}

type UploadSessionFileRow = {
  workspace_id: string;
  upload_session_id: string;
  path: string;
  size_bytes: number;
  served_content_type: string;
  r2_key: string;
  uploaded_at: string | null;
  put_url_expires_at: string;
};

type ArtifactFileRow = {
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
  path: string;
  size_bytes: number;
  served_content_type: string;
  r2_key: string;
  uploaded_at: string;
};

function uploadSessionFileFromRow(row: UploadSessionFileRow): StoredFile {
  return {
    workspace_id: row.workspace_id,
    upload_session_id: row.upload_session_id,
    path: row.path,
    size_bytes: Number(row.size_bytes),
    content_type: row.served_content_type,
    r2_key: row.r2_key,
    uploaded_at: row.uploaded_at,
    put_url_expires_at: row.put_url_expires_at,
  };
}

function artifactFileFromRow(row: ArtifactFileRow): StoredFile {
  return {
    workspace_id: row.workspace_id,
    artifact_id: row.artifact_id,
    revision_id: row.revision_id,
    path: row.path,
    size_bytes: Number(row.size_bytes),
    content_type: row.served_content_type,
    r2_key: row.r2_key,
    uploaded_at: row.uploaded_at,
  };
}

function validateUpload(files: Array<{ path: string; size_bytes: number }>, entrypoint = "index.html") {
  if (files.length === 0 || files.length > USAGE_POLICY.file_count_cap) {
    throw new Error("file_count_cap_exceeded");
  }
  let total = 0;
  for (const file of files) {
    if (file.size_bytes > USAGE_POLICY.file_size_cap_bytes) {
      throw new Error("file_size_cap_exceeded");
    }
    total += file.size_bytes;
  }
  if (total > USAGE_POLICY.artifact_size_cap_bytes) {
    throw new Error("revision_size_cap_exceeded");
  }
  if (!files.some((file) => file.path === entrypoint)) {
    throw new Error("entrypoint_not_in_revision");
  }
}

function toUploadSessionRecord(session: UploadSession, files: StoredFile[]) {
  return {
    session_id: session.id,
    upload_session_id: session.id,
    artifact_id: session.artifact_id,
    revision_id: session.revision_id,
    expires_at: session.expires_at,
    files: files.map((file) => ({
      path: file.path,
      size_bytes: file.size_bytes,
      object_key: file.r2_key,
      expires_at: file.put_url_expires_at ?? session.expires_at,
    })),
  };
}

function toWorkspaceDetail(workspace: Workspace) {
  return { ...toWorkspaceSummary(workspace), contact_email: workspace.contact_email };
}

function toWorkspaceSummary(workspace: Workspace) {
  return { id: workspace.id, name: workspace.name, created_at: workspace.created_at };
}

function toApiKeySummary(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    workspace_id: apiKey.workspace_id,
    name: apiKey.name,
    public_id: apiKey.public_id,
    scopes: apiKey.scopes,
    revoked_at: apiKey.revoked_at,
    created_at: apiKey.created_at,
    last_used_at: apiKey.last_used_at,
  };
}

function toArtifactSummary(artifact: Artifact) {
  return {
    id: artifact.id,
    revision_id: artifact.revision_id,
    status: artifact.status,
    title: artifact.title,
    entrypoint: artifact.entrypoint,
    file_count: artifact.file_count,
    size_bytes: artifact.size_bytes,
    expires_at: artifact.expires_at,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    deleted_at: artifact.deleted_at,
    delete_reason: artifact.delete_reason,
  };
}

function objectKeyFor(artifactId: string, revisionId: string, path: string) {
  return `artifacts/${artifactId}/revisions/${revisionId}/files/${path}`;
}

function createId(prefix: string) {
  return `${prefix}_${randomCrockford(26)}`;
}

function randomCrockford(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte: number) => CROCKFORD[byte % CROCKFORD.length]).join("");
}

async function generateApiKey(env: "preview" | "production" | "live", pepper: string) {
  const publicId = randomCrockford(16);
  const secretSegment = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  return {
    secret: `ap_pk_${env}_${publicId}_${secretSegment}`,
    publicId,
    secretHmac: await hmacBase64Url(secretSegment, pepper),
  };
}

function parseApiKey(value: string) {
  const match = value.match(/^ap_pk_(preview|production|live)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{32,})$/);
  if (!match?.[2] || !match[3]) {
    return null;
  }
  return { publicId: match[2], secret: match[3] };
}

async function verifyApiKeySecret(
  apiKey: string,
  expectedPublicId: string,
  expectedSecretHmac: string,
  pepper: string,
) {
  const parsed = parseApiKey(apiKey);
  if (!parsed || parsed.publicId !== expectedPublicId) {
    return false;
  }
  return constantTimeEqual(await hmacBase64Url(parsed.secret, pepper), expectedSecretHmac);
}

async function hmacBase64Url(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function normalizeStoragePath(input: string) {
  const path = input.replaceAll("\\", "/");
  const parts = path.split("/");
  if (path.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("invalid_request");
  }
  return path;
}

function contentTypeForPath(path: string) {
  const extension = path.toLowerCase().split(".").pop();
  switch (extension) {
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
    case "mjs":
      return "application/javascript; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "txt":
    case "log":
      return "text/plain; charset=utf-8";
    case "md":
    case "markdown":
      return "text/markdown; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
