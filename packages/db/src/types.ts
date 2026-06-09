type Scope = "publish" | "read" | "admin";

export type ApiKeyActor = {
  type: "api_key";
  id: string;
  workspace_id: string;
  scopes?: Array<Extract<Scope, "publish" | "read">>;
  expires_at?: string | null;
};

export type WorkspaceMemberActor = {
  type: "member";
  id: string;
  workspace_id: string;
  email: string;
  scopes: Scope[];
};

export type ApiActor = ApiKeyActor | WorkspaceMemberActor;

export type AdminActor = { type: "admin" | "system"; id: string };

// Platform operator identity (ADR 0046). Always platform-scoped; never tied to a
// single workspace. id is the operator email or the Access service-token common_name.
export type PlatformActor = { type: "platform"; id: string };

export type SqlValue = string | number | boolean | null | Record<string, unknown> | SqlValue[];

export type SqlQueryResult<Row = Record<string, unknown>> = { rows: Row[] };

export type SqlExecutor = {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<SqlQueryResult<Row>>;
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

export type HyperdriveBinding = {
  connectionString: string;
};

export type WorkspacePlan = "free" | "pro";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type Workspace = {
  id: string;
  name: string;
  contact_email: string | null;
  plan: WorkspacePlan;
  plan_operator_override_at: string | null;
  claimed_at: string | null;
  auto_deletion_days: number;
  revision_retention_days: number | null;
  created_at: string;
  updated_at: string;
};

export type ClaimToken = {
  id: string;
  workspace_id: string;
  public_id: string;
  token_hash: Uint8Array;
  pepper_kid: number;
  expires_at: string;
  redeemed_at: string | null;
  created_at: string;
};

export type WorkspaceBilling = {
  workspace_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  current_period_end: string | null;
  price_interval: "month" | "year" | null;
  synced_at: string;
  updated_at: string;
};

export type StripeWebhookEvent = {
  event_id: string;
  processing_started_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiKey = {
  id: string;
  workspace_id: string;
  public_id: string;
  name: string;
  secret_hmac: string;
  pepper_kid: number;
  scopes: Array<"publish" | "read">;
  revoked_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  workos_user_id: string;
  email: string;
  scopes: Array<"publish" | "read" | "admin">;
  created_at: string;
  last_seen_at: string;
};

export type RevisionStatus = "draft" | "published" | "retained";

export type RenderMode = "html" | "markdown" | "text" | "image" | "audio" | "video";

export type BundleStatus = "pending" | "ready" | "failed" | "disabled";

/** Bundle status set when a revision is first published (not replayed terminal states). */
export type PublishBundleStatus = "pending" | "disabled";

export type SafetyWarningSeverity = "info" | "warning";

export type SafetyWarningScope = "artifact" | "revision" | "file";

export type Revision = {
  id: string;
  workspace_id: string;
  artifact_id: string;
  revision_number: number | null;
  status: RevisionStatus;
  entrypoint: string;
  render_mode: RenderMode;
  file_count: number;
  size_bytes: number;
  bundle_status: BundleStatus;
  bundle_status_updated_at: string | null;
  bundle_size_bytes: number | null;
  bytes_purge_enqueued_at: string | null;
  created_by_type: PublishCreatedByType;
  created_by_id: string;
  created_at: string;
  published_at: string | null;
};

export type Artifact = {
  id: string;
  workspace_id: string;
  revision_id: string | null;
  status: "active" | "deleted" | "expired";
  title: string;
  entrypoint: string;
  file_count: number;
  size_bytes: number;
  expires_at: string;
  pinned_at: string | null;
  created_by_type: PublishCreatedByType;
  created_by_id: string;
  access_link_lockdown_at: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessLinkType = "share" | "revision";

export type AccessLinkCreatedByType = "api_key" | "member";

export type PublishCreatedByType = AccessLinkCreatedByType;

export type AccessLink = {
  id: string;
  workspace_id: string;
  artifact_id: string;
  revision_id: string | null;
  public_id: string;
  type: AccessLinkType;
  scopes_bitmask: number;
  expires_at: string | null;
  created_by_type: AccessLinkCreatedByType;
  created_by_id: string;
  created_at: string;
  revoked_at: string | null;
};

export type UploadSession = {
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
  created_by_type: PublishCreatedByType;
  created_by_id: string;
  expires_at: string;
  created_at: string;
  finalized_at: string | null;
};

export type StoredFile = {
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

export type SafetyWarning = {
  id: string;
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
  scanner_id: string;
  scanner_version: string;
  code: string;
  severity: SafetyWarningSeverity;
  scope: SafetyWarningScope;
  file_path: string | null;
  message: string;
  created_at: string;
};

export type PlatformLockdown = {
  id: string;
  scope: "workspace" | "artifact";
  target_id: string;
  reason_code: string;
  set_at: string;
  set_by: string;
  lifted_at: string | null;
  lifted_by: string | null;
};

export type OperationEvent = {
  id: string;
  workspace_id: string | null;
  actor_type: "api_key" | "member" | "admin" | "system" | "platform";
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  request_id: string | null;
  occurred_at: string;
};

import type { PepperRing } from "@agent-paste/rotation";

export type RepositoryOptions = {
  apiKeyPepper: string;
  /** When set, verification and minting use multi-pepper overlap from ADR 0045. */
  pepperRing?: PepperRing;
  apiKeyEnv?: "preview" | "production";
  apiBaseUrl?: string;
  contentBaseUrl?: string;
  webBaseUrl?: string;
  /** When false (default), `workspaces.plan` is ignored and caps default to `pro`. */
  billingEnabled?: boolean;
};
