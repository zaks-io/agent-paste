import type { buildAgentView, buildFinalizeResult, buildPublishResult } from "../agent-view.js";
import type { UsagePolicyConfig } from "../policy.js";
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
import type { CreateUploadSessionRequest } from "./upload-session-lifecycle.js";
import type { toWebArtifactRow, toWebAuditRow, toWebOperatorEventRow } from "./web-transforms.js";
import type {
  RegisterAgentAnonymousIdentityInput,
  RegisterAgentAnonymousIdentityResult,
  StartAgentAuthAnonymousClaimResult,
} from "./workflows/agent-auth-anonymous-workflow.js";
import type {
  AgentAuthClaimView,
  ExchangeAgentAuthResult,
  RegisterAgentVerifiedIdentityInput,
  RegisterAgentVerifiedIdentityResult,
} from "./workflows/agent-auth-workflow.js";
import type { ClaimEphemeralWorkspaceResult, CreateEphemeralWorkspaceResult } from "./workflows/ephemeral-workflow.js";

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
  usage_policy: UsagePolicyConfig;
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

type WebAccessLinkRow = {
  id: string;
  type: AccessLinkType;
  artifact_id: string;
  revision_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked: boolean;
};

type WebAccessLinkListView = {
  items: WebAccessLinkRow[];
  page_info: { next_cursor: string | null; has_more: boolean };
};

type WebSettings = {
  workspace_name: string;
  auto_deletion_days: number;
  auto_deletion_bounds: { min_days: number; max_days: number };
  usage_policy: { artifacts_per_day: number; bytes_per_day: number };
};

type ArtifactSummary = ReturnType<typeof toArtifactSummary>;

type ArtifactDetail = ArtifactSummary & {
  workspace_id: string;
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
/** Domain failures throw {@link RepositoryError}; map with {@link repositoryErrorToAppError}. */
export type Repository = {
  createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace>;
  createEphemeralWorkspace(input: {
    idempotencyKey: string;
    now?: Date;
    claimTokenExpiresInSeconds?: number;
    claimCode?: string;
  }): Promise<CreateEphemeralWorkspaceResult>;
  claimEphemeralWorkspace(input: {
    actor: ApiActor;
    claimTokenSecret: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<ClaimEphemeralWorkspaceResult>;
  claimEphemeralWorkspaceWithReplayState(input: {
    actor: ApiActor;
    claimTokenSecret: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<{ result: ClaimEphemeralWorkspaceResult; isReplay: boolean }>;
  peekEphemeralClaimReplay(input: {
    actor: ApiActor;
    idempotencyKey: string;
  }): Promise<{ result: ClaimEphemeralWorkspaceResult } | { inFlight: true } | null>;
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
  getUsagePolicy(actor: ApiKeyActor): Promise<UsagePolicyConfig>;
  resolveWebMember(input: {
    workosUserId: string;
    email: string;
    idempotencyKey: string;
    now?: string;
  }): Promise<WebAuthResponse>;
  getWebMemberByWorkOsUserId(input: { workosUserId: string }): Promise<WebMemberActor | null>;
  ensureWebMember(input: { workosUserId: string; email: string; now?: string }): Promise<WebMemberActor>;
  registerAgentVerifiedIdentity(
    input: RegisterAgentVerifiedIdentityInput,
  ): Promise<RegisterAgentVerifiedIdentityResult>;
  registerAgentAnonymousIdentity(
    input: RegisterAgentAnonymousIdentityInput,
  ): Promise<RegisterAgentAnonymousIdentityResult>;
  getAgentAuthClaim(input: { claimToken: string; now?: Date }): Promise<AgentAuthClaimView | null>;
  completeAgentAuthClaim(input: {
    actor: WebMemberActor;
    claimToken: string;
    userCode: string;
    now?: Date;
  }): Promise<{ id: string; expires_at: string; scopes: Array<"read" | "publish"> } | null>;
  startAgentAuthAnonymousClaim(input: {
    claimToken: string;
    claimAttemptExpiresInSeconds: number;
    now?: Date;
  }): Promise<StartAgentAuthAnonymousClaimResult>;
  completeAgentAuthAnonymousClaim(input: {
    actor: WebMemberActor;
    claimAttemptToken: string;
    userCode: string;
    now?: Date;
  }): Promise<{ id: string; expires_at: string; scopes: Array<"read" | "publish"> } | null>;
  exchangeAgentAuthIdentityAssertion(input: {
    registrationId: string;
    anonymousClaimState?: "pre_claim" | "post_claim";
    accessTokenExpiresInSeconds: number;
    now?: Date;
  }): Promise<ExchangeAgentAuthResult>;
  exchangeAgentAuthClaimToken(input: {
    claimToken: string;
    accessTokenExpiresInSeconds: number;
    now?: Date;
  }): Promise<ExchangeAgentAuthResult>;
  revokeAgentAuthAccessToken(input: { token: string; now?: Date }): Promise<boolean>;
  revokeAgentAuthProviderIdentity(input: {
    providerIssuer: string;
    providerSubject: string;
    audience: string;
    jti: string;
    jtiExpiresAt: string;
    now?: Date;
  }): Promise<"revoked" | "not_found" | "replay_detected">;
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
    requestId?: string;
    now?: Date;
  }): Promise<LockdownDetail>;
  liftLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: LockdownScope;
    targetId: string;
    requestId?: string;
    now?: Date;
  }): Promise<LockdownDetail>;
  createUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    request: CreateUploadSessionRequest;
    now: string;
  }): Promise<UploadSessionRecord>;
  recordUploadedFile(input: {
    workspaceId?: string;
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    sha256?: string;
    uploadedAt: string;
  }): Promise<void>;
  getUploadSession(input: { actor: ApiActor; sessionId: string }): Promise<UploadSessionRecord | null>;
  getUploadSessionState(input: {
    workspaceId: string;
    sessionId: string;
  }): Promise<{ status: string; expiresAt: string } | null>;
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
  peekPublishWriteGate(input: { actor: ApiActor; artifactId: string; revisionId: string }): Promise<{
    is_already_published: boolean;
    is_new_artifact: boolean;
    next_revision_number: number;
    daily_new_artifact_allowance?: number;
    lifetime_revision_ceiling?: number;
  } | null>;
  listMemberArtifacts(
    actor: ApiActor,
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ data: ArtifactSummary[]; page_info: PageInfo }>;
  deleteMemberArtifact(input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date }): Promise<{
    artifact_id: string;
    workspace_id: string;
    revision_id: string | null;
    deleted_at: string;
  }>;
  updateArtifactDisplayMetadata(input: {
    actor: ApiActor;
    artifactId: string;
    title: string;
    now?: Date;
  }): Promise<{ title: string; description: string | null }>;
  createMemberAccessLink(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    type: AccessLinkType;
    revisionId?: string | null;
    now?: Date;
  }): Promise<{
    id: string;
    type: AccessLinkType;
    artifact_id: string;
    revision_id: string | null;
    created_at: string;
  }>;
  listMemberAccessLinks(
    actor: ApiActor,
    artifactId: string,
  ): Promise<{
    artifact_id: string;
    items: Array<{
      id: string;
      type: AccessLinkType;
      artifact_id: string;
      revision_id: string | null;
      created_at: string;
      expires_at: string | null;
      revoked_at: string | null;
    }>;
  } | null>;
  listWorkspaceAccessLinks(actor: ApiActor): Promise<WebAccessLinkListView>;
  listWebArtifactAccessLinks(actor: ApiActor, artifactId: string): Promise<WebAccessLinkListView | null>;
  setMemberAccessLinkLockdown(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    locked: boolean;
    now?: Date;
  }): Promise<WebArtifactDetail>;
  revokeMemberAccessLink(input: {
    actor: ApiActor;
    accessLinkId: string;
    now?: Date;
  }): Promise<{ access_link_id: string; revoked_at: string }>;
  peekArtifactDenylistRetention(artifactId: string): Promise<boolean>;
  peekArtifactPlatformLockdownRetention(artifactId: string): Promise<boolean>;
  mintMemberAccessLink(input: {
    actor: ApiActor;
    accessLinkId: string;
    appBaseUrl: string;
    signingSecret: string;
    signingKid: number;
    now?: Date;
  }): Promise<{ url: string }>;
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
  }): Promise<{ artifact_id: string; workspace_id: string; revision_id: string | null; deleted_at: string }>;
  listOperationEvents(): Promise<{ data: OperationEvent[]; page_info: PageInfo }>;
  forceExpireArtifact(input: {
    artifactId: string;
    expiresAt: string;
  }): Promise<{ artifact_id: string; expires_at: string } | null>;
  peekIdempotentReplay(input: {
    actor: ApiActor;
    operation: string;
    idempotencyKey: string;
  }): Promise<{ result: unknown } | { inFlight: true } | null>;
  peekWorkspaceCommandReplay(input: {
    actor: ApiActor;
    operation: string;
    idempotencyKey: string;
  }): Promise<{ result: unknown } | { inFlight: true } | null>;
};
