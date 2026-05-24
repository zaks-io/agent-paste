import type {
  ApiKey,
  Artifact,
  OperationEvent,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "../types.js";
import type { WebArtifactCursor, WebAuditCursor } from "./web-transforms.js";

// Scope a unit of work to a single workspace or to the whole platform. Adapters
// translate this into RLS config (Postgres) or simple Map filtering (local).
export type RunScope = { kind: "workspace"; workspaceId: string } | { kind: "platform" };

export type CommandActor = { type: "api_key" | "member" | "admin" | "system"; id: string; workspaceId: string | null };

// Inputs the durable command runner needs to claim, replay, or recover idempotency.
export type CommandSpec = {
  actor: CommandActor;
  operation: string;
  idempotencyKey: string;
  scope: RunScope;
  now: string;
};

// Scope-bound accessor over every table the core touches. The Postgres adapter
// binds these to scope-bound Drizzle queries; the local adapter binds them to Maps.
export type Entities = {
  workspaces: {
    insert(workspace: Workspace): Promise<void>;
    findById(id: string): Promise<Workspace | null>;
    listAll(): Promise<Workspace[]>;
  };
  apiKeys: {
    insert(apiKey: ApiKey): Promise<void>;
    findById(id: string): Promise<ApiKey | null>;
    findByPublicId(publicId: string): Promise<ApiKey | null>;
    listForWorkspace(workspaceId: string): Promise<ApiKey[]>;
    updateLastUsedAt(id: string, lastUsedAt: string): Promise<void>;
    updateRevokedAt(id: string, revokedAt: string): Promise<void>;
  };
  members: {
    insert(member: WorkspaceMember): Promise<void>;
    findById(id: string): Promise<WorkspaceMember | null>;
    findByWorkOsUserId(workosUserId: string): Promise<WorkspaceMember | null>;
    updateSeen(id: string, input: { email: string; lastSeenAt: string }): Promise<WorkspaceMember | null>;
  };
  artifacts: {
    insert(artifact: Artifact): Promise<void>;
    findById(artifactId: string, workspaceId?: string): Promise<Artifact | null>;
    listFiltered(workspaceId?: string, status?: string): Promise<Artifact[]>;
    listWebPage(input: { workspaceId: string; limit: number; cursor?: WebArtifactCursor }): Promise<Artifact[]>;
    updateExpiry(artifactId: string, expiresAt: string): Promise<{ artifact_id: string; expires_at: string } | null>;
    markDeleted(artifactId: string, deletedAt: string): Promise<void>;
    listExpiring(now: string, limit: number): Promise<Array<{ id: string }>>;
    expireBatch(now: string, ids: string[]): Promise<void>;
  };
  artifactFiles: {
    insert(artifactId: string, revisionId: string, file: StoredFile, fallbackUploadedAt: string): Promise<void>;
    listForArtifact(artifactId: string): Promise<StoredFile[]>;
  };
  uploadSessions: {
    insert(session: UploadSession): Promise<void>;
    findById(sessionId: string, workspaceId?: string): Promise<UploadSession | null>;
    markFinalized(sessionId: string, finalizedAt: string): Promise<void>;
    listExpiring(now: string, limit: number): Promise<Array<{ id: string }>>;
    expireBatch(now: string, ids: string[]): Promise<void>;
  };
  uploadSessionFiles: {
    insert(sessionId: string, file: StoredFile): Promise<void>;
    listForSession(sessionId: string): Promise<StoredFile[]>;
    recordUpload(input: {
      sessionId: string;
      path: string;
      objectKey?: string;
      sizeBytes?: number;
      uploadedAt: string;
    }): Promise<void>;
  };
  operationEvents: {
    insert(input: {
      actorType: "api_key" | "member" | "admin" | "system";
      actorId: string | null;
      action: string;
      targetType: string;
      targetId: string;
      workspaceId: string | null;
      details: Record<string, unknown>;
      occurredAt: string;
    }): Promise<void>;
    listAll(): Promise<OperationEvent[]>;
    listForWorkspace(workspaceId: string): Promise<OperationEvent[]>;
    listWebPage(input: { workspaceId: string; limit: number; cursor?: WebAuditCursor }): Promise<OperationEvent[]>;
    listIdsForTarget(targetId: string): Promise<string[]>;
  };
};

// Lets a command handler run a nested, independently keyed command that shares
// the same backing transaction. Only resolveWebMember needs this (callback wraps
// per-user provisioning so concurrent first logins cannot duplicate a workspace).
export type CommandRunContext = {
  command<T>(spec: Omit<CommandSpec, "scope">, run: (entities: Entities) => Promise<T>): Promise<T>;
};

// The unit of work the core depends on. read() runs a scoped query; command()
// wraps a mutation in durable idempotency; peekReplay() returns a completed result.
export type UnitOfWork = {
  read<T>(scope: RunScope, run: (entities: Entities) => Promise<T>): Promise<T>;
  command<T>(spec: CommandSpec, run: (entities: Entities, ctx: CommandRunContext) => Promise<T>): Promise<T>;
  peekReplay<T>(input: {
    actor: CommandActor;
    operation: string;
    idempotencyKey: string;
    scope: RunScope;
  }): Promise<{ result: T } | null>;
};
