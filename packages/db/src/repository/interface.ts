import type { buildAgentView, buildFinalizeResult, buildPublishResult } from "../agent-view.js";
import type {
  toApiKeySummary,
  toArtifactSummary,
  toUploadSessionRecord,
  toWorkspaceDetail,
  toWorkspaceSummary,
} from "../transforms.js";
import type {
  AccessLinkType,
  AdminActor,
  ApiActor,
  ApiKeyActor,
  OperationEvent,
  PlatformActor,
  Workspace,
} from "../types.js";
import type { OperatorEventFilters } from "./operator-event-filters.js";
import type { toWebArtifactRow, toWebAuditRow, toWebOperatorEventRow } from "./web-transforms.js";

type AgentView = ReturnType<typeof buildAgentView>;
type PublishResult = ReturnType<typeof buildPublishResult>;
type FinalizeResult = ReturnType<typeof buildFinalizeResult>;
type WorkspaceSummary = ReturnType<typeof toWorkspaceSummary>;
type ApiKeySummary = ReturnType<typeof toApiKeySummary>;
type UploadSessionRecord = ReturnType<typeof toUploadSessionRecord>;
type WebArtifactRow = ReturnType<typeof toWebArtifactRow>;
type WebAuditRow = ReturnType<typeof toWebAuditRow>;
type WebOperatorEventRow = ReturnType<typeof toWebOperatorEventRow>;
type OperatorEventListInput = OperatorEventFilters & { cursor?: string; limit?: number };

type PageInfo = { next_cursor: string | null; has_more: boolean };

type WorkspaceMemberSummary = {
  id: string;
  workspace_id: string;
  email: string;
  scopes: string[];
  created_at: string;
  last_seen_at: string;
};

type WebMemberActor = {
  type: "member";
  id: string;
  workspace_id: string;
  email: string;
  scopes: Array<"publish" | "read" | "admin">;
};

type WebAuthResponse = {
  workspace: WorkspaceSummary;
  workspace_member: WorkspaceMemberSummary;
  scopes: Array<"publish" | "read" | "admin">;
  default_api_key: { api_key: ApiKeySummary; secret: string } | null;
};

type Whoami = {
  actor: { type: string; id: string; name: string };
  workspace: WorkspaceSummary;
  scopes: Array<"publish" | "read">;
  usage_policy: unknown;
};

type WebWorkspaceView = {
  workspace: WorkspaceSummary;
  workspace_member: WorkspaceMemberSummary;
  usage_policy: unknown;
  default_key_first_run: boolean;
};

type WebArtifactDetail = WebArtifactRow & {
  entrypoint: string;
  file_count: number;
  size_bytes: number;
  viewer: { iframe_src: string; render_mode: string } | null;
};

type WebApiKeyRow = ApiKeySummary & { revoked: boolean };

type WebSettings = {
  workspace_name: string;
  auto_deletion_days: number;
  usage_policy: { artifacts_per_day: number; bytes_per_day: number };
};

type ArtifactSummary = ReturnType<typeof toArtifactSummary>;

type ArtifactDetail = ArtifactSummary & {
  files: Array<{ path: string; size_bytes: number; content_type: string; uploaded_at: string }>;
  operation_event_ids: string[];
};

type CleanupResult = {
  dry_run: boolean;
  expired_artifacts: number;
  expired_artifact_ids: string[];
  expired_upload_sessions: number;
  deleted_r2_objects: number;
  occurred_at: string;
};

type UploadSessionFile = { path: string; objectKey: string; sizeBytes: number };

type LockdownScope = "workspace" | "artifact";

type LockdownDetail = {
  scope: LockdownScope;
  target_id: string;
  reason_code: string;
  set_at: string;
  set_by: string;
  lifted_at: string | null;
  lifted_by: string | null;
};

// Single backend-agnostic contract. Both the Postgres and local repositories
// implement this exactly; the api and upload workers consume it directly.
export type Repository = {
  createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace>;
  listWorkspaces(): Promise<{ data: ReturnType<typeof toWorkspaceDetail>[]; page_info: PageInfo }>;
  createApiKey(input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
    now?: Date;
  }): Promise<{ api_key: ApiKeySummary; secret: string }>;
  revokeApiKey(input: {
    actor: AdminActor;
    idempotencyKey: string;
    apiKeyId: string;
    now?: Date;
  }): Promise<{ api_key: ApiKeySummary; revoked_at: string }>;
  verifyApiKey(apiKeySecret: string): Promise<ApiKeyActor | null>;
  getWhoami(actor: ApiKeyActor): Promise<Whoami>;
  resolveWebMember(input: {
    workosUserId: string;
    email: string;
    idempotencyKey: string;
    now?: string;
  }): Promise<WebAuthResponse>;
  getWebMemberByWorkOsUserId(input: { workosUserId: string }): Promise<WebMemberActor | null>;
  ensureWebMember(input: { workosUserId: string; email: string; now?: string }): Promise<WebMemberActor>;
  getWebWorkspace(actor: ApiActor): Promise<WebWorkspaceView>;
  listWebArtifacts(
    actor: ApiActor,
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: WebArtifactRow[]; page_info: PageInfo }>;
  getWebArtifact(actor: ApiActor, artifactId: string): Promise<WebArtifactDetail | null>;
  pinWebArtifact(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    now?: Date;
  }): Promise<WebArtifactDetail>;
  unpinWebArtifact(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    now?: Date;
  }): Promise<WebArtifactDetail>;
  listWebApiKeys(actor: ApiActor): Promise<{ items: WebApiKeyRow[]; page_info: PageInfo }>;
  createWebApiKey(input: {
    actor: ApiActor;
    idempotencyKey: string;
    name: string;
    expiresInSeconds?: number;
    now?: Date;
  }): Promise<{ api_key: ApiKeySummary; secret: string }>;
  revokeCurrentApiKey(input: {
    actor: ApiKeyActor;
    now?: Date;
  }): Promise<{ api_key: ApiKeySummary; revoked_at: string }>;
  revokeWebApiKey(input: {
    actor: ApiActor;
    idempotencyKey: string;
    apiKeyId: string;
    now?: Date;
  }): Promise<{ api_key: ApiKeySummary; revoked_at: string }>;
  listWebAuditEvents(
    actor: ApiActor,
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: WebAuditRow[]; page_info: PageInfo }>;
  getWebSettings(actor: ApiActor): Promise<WebSettings>;
  updateWebSettings(input: {
    actor: ApiActor;
    idempotencyKey: string;
    workspaceName: string;
    autoDeletionDays: number;
    now?: Date;
  }): Promise<WebSettings>;
  listLockdowns(
    actor: PlatformActor,
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: LockdownDetail[]; page_info: PageInfo }>;
  listOperatorEvents(
    actor: PlatformActor,
    filters?: OperatorEventListInput,
  ): Promise<{ items: WebOperatorEventRow[]; page_info: PageInfo }>;
  setLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: LockdownScope;
    targetId: string;
    reasonCode: string;
    now?: Date;
  }): Promise<LockdownDetail>;
  liftLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: LockdownScope;
    targetId: string;
    now?: Date;
  }): Promise<LockdownDetail>;
  createUploadSession(input: {
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
  }): Promise<UploadSessionRecord>;
  recordUploadedFile(input: {
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    uploadedAt: string;
  }): Promise<void>;
  getUploadSession(input: { actor: ApiActor; sessionId: string }): Promise<UploadSessionRecord | null>;
  finalizeUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: UploadSessionFile[];
    now: string;
  }): Promise<FinalizeResult>;
  publishRevision(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    revisionId: string;
    now: string;
  }): Promise<PublishResult>;
  listRevisions(input: { actor: ApiActor; artifactId: string }): Promise<{
    artifact_id: string;
    items: Array<{
      revision_id: string;
      revision_number: number | null;
      status: string;
      entrypoint: string;
      render_mode: string;
      file_count: number;
      size_bytes: number;
      created_at: string;
      published_at: string | null;
    }>;
    page_info: PageInfo;
  } | null>;
  resolveAccessLink(input: { publicId: string; blobScopes: number; contentBaseUrl: string; now?: string }): Promise<{
    access_link_id: string;
    access_link_type: AccessLinkType;
    workspace_id: string;
    agent_view: AgentView;
    render_mode: string;
    title: string;
    iframe_src: string;
  } | null>;
  getPublicAgentView(input: { token: string; contentBaseUrl: string }): Promise<AgentView | null>;
  getAgentView(input: {
    actor: ApiActor;
    artifactId: string;
    revisionId?: string;
    contentBaseUrl: string;
  }): Promise<AgentView | null>;
  runCleanup(input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize?: number;
    now: string;
  }): Promise<CleanupResult>;
  listArtifacts(workspaceId?: string, status?: string): Promise<{ data: ArtifactSummary[]; page_info: PageInfo }>;
  getArtifactDetail(artifactId: string): Promise<ArtifactDetail | null>;
  deleteArtifact(input: {
    actor: AdminActor;
    idempotencyKey: string;
    artifactId: string;
    now?: Date;
  }): Promise<{ artifact_id: string; deleted_at: string }>;
  listOperationEvents(): Promise<{ data: OperationEvent[]; page_info: PageInfo }>;
  forceExpireArtifact(input: {
    artifactId: string;
    expiresAt: string;
  }): Promise<{ artifact_id: string; expires_at: string } | null>;
  peekIdempotentReplay(input: {
    actor: ApiKeyActor;
    operation: string;
    idempotencyKey: string;
  }): Promise<{ result: unknown } | { inFlight: true } | null>;
};
