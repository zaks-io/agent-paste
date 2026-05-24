type Scope = "publish" | "read" | "admin";

export type ApiKeyActor = {
  type: "api_key";
  id: string;
  workspace_id: string;
  scopes?: Array<Extract<Scope, "publish" | "read">>;
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

export type Workspace = {
  id: string;
  name: string;
  contact_email: string | null;
  auto_deletion_days: number;
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

export type Artifact = {
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
  created_by_api_key_id: string;
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

export type RepositoryOptions = {
  apiKeyPepper: string;
  apiKeyEnv?: "preview" | "production";
  apiBaseUrl?: string;
  contentBaseUrl?: string;
};
