import { ErrorCode, type ErrorCode as ErrorCodeValue } from "@agent-paste/contracts";

export const RepositoryErrorCode = {
  access_link_inactive_artifact_missing: "access_link_inactive_artifact_missing",
  access_link_inactive_expired: "access_link_inactive_expired",
  access_link_inactive_revoked: "access_link_inactive_revoked",
  access_link_invalid_expires_at: "access_link_invalid_expires_at",
  access_link_invalid_scopes_bitmask: "access_link_invalid_scopes_bitmask",
  access_link_lockdown_active: "access_link_lockdown_active",
  access_link_revision_requires_revision_id: "access_link_revision_requires_revision_id",
  access_link_share_cannot_pin_revision: "access_link_share_cannot_pin_revision",
  api_key_not_found: "api_key_not_found",
  artifact_not_found: "artifact_not_found",
  create_postgres_services_missing_connection_or_executor:
    "create_postgres_services_missing_connection_or_executor",
  current_api_key_not_found: "current_api_key_not_found",
  draft_revision_conflict: "draft_revision_conflict",
  drizzle_not_bound_to_executor: "drizzle_not_bound_to_executor",
  entrypoint_not_in_revision: "entrypoint_not_in_revision",
  executor_missing_drizzle_binding: "executor_missing_drizzle_binding",
  file_count_cap_exceeded: "file_count_cap_exceeded",
  file_size_cap_exceeded: "file_size_cap_exceeded",
  forbidden: "forbidden",
  invalid_auto_deletion_days: "invalid_auto_deletion_days",
  invalid_cursor: "invalid_cursor",
  invalid_pagination_limit: "invalid_pagination_limit",
  invalid_request: "invalid_request",
  invalid_ttl_seconds: "invalid_ttl_seconds",
  lockdown_insert_conflict: "lockdown_insert_conflict",
  not_found: "not_found",
  pinned_artifact_cap_exceeded: "pinned_artifact_cap_exceeded",
  postgres_http_error: "postgres_http_error",
  postgres_http_executor_no_transactions: "postgres_http_executor_no_transactions",
  revision_ceiling_exceeded: "revision_ceiling_exceeded",
  revision_retained: "revision_retained",
  revision_size_cap_exceeded: "revision_size_cap_exceeded",
  revision_unpublished: "revision_unpublished",
  unexpected_actor_type: "unexpected_actor_type",
  upload_incomplete: "upload_incomplete",
  upload_session_not_found: "upload_session_not_found",
  workspace_member_not_found: "workspace_member_not_found",
  workspace_not_found: "workspace_not_found",
} as const;

export type RepositoryErrorCode = (typeof RepositoryErrorCode)[keyof typeof RepositoryErrorCode];

export class RepositoryError extends Error {
  readonly name = "RepositoryError";

  constructor(
    readonly kind: RepositoryErrorCode,
    options?: ErrorOptions,
  ) {
    super(kind, options);
  }
}

export function isRepositoryError(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError;
}

export function repositoryError(kind: RepositoryErrorCode, options?: ErrorOptions): never {
  throw new RepositoryError(kind, options);
}

/** null means intentional internal_error (500); every {@link RepositoryErrorCode} must have an entry. */
const repositoryErrorToAppErrorMap: Record<RepositoryErrorCode, ErrorCodeValue | null> = {
  access_link_inactive_artifact_missing: "not_found",
  access_link_inactive_expired: "not_found",
  access_link_inactive_revoked: "not_found",
  access_link_invalid_expires_at: "invalid_request",
  access_link_invalid_scopes_bitmask: "invalid_request",
  access_link_lockdown_active: "not_found",
  access_link_revision_requires_revision_id: "invalid_request",
  access_link_share_cannot_pin_revision: "invalid_request",
  api_key_not_found: "api_key_not_found",
  artifact_not_found: "artifact_not_found",
  create_postgres_services_missing_connection_or_executor: null,
  current_api_key_not_found: "not_authenticated",
  draft_revision_conflict: "draft_revision_conflict",
  drizzle_not_bound_to_executor: null,
  entrypoint_not_in_revision: "entrypoint_not_in_revision",
  executor_missing_drizzle_binding: null,
  file_count_cap_exceeded: "file_count_cap_exceeded",
  file_size_cap_exceeded: "file_size_cap_exceeded",
  forbidden: "forbidden",
  invalid_auto_deletion_days: "invalid_request",
  invalid_cursor: "invalid_cursor",
  invalid_pagination_limit: "invalid_request",
  invalid_request: "invalid_request",
  invalid_ttl_seconds: "invalid_request",
  lockdown_insert_conflict: null,
  not_found: "not_found",
  pinned_artifact_cap_exceeded: "pinned_artifact_cap_exceeded",
  postgres_http_error: null,
  postgres_http_executor_no_transactions: null,
  revision_ceiling_exceeded: "revision_ceiling_exceeded",
  revision_retained: "revision_retained",
  revision_size_cap_exceeded: "revision_size_cap_exceeded",
  revision_unpublished: "revision_unpublished",
  unexpected_actor_type: null,
  upload_incomplete: "upload_incomplete",
  upload_session_not_found: "upload_session_not_found",
  workspace_member_not_found: null,
  workspace_not_found: null,
};

export function repositoryErrorToAppError(error: unknown): ErrorCodeValue | null {
  if (!isRepositoryError(error)) {
    return null;
  }
  return repositoryErrorToAppErrorMap[error.kind];
}
