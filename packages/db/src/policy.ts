export const DEFAULT_UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const SECONDS_PER_DAY = 24 * 60 * 60;

export const USAGE_POLICY = {
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

export const DEFAULT_AUTO_DELETION_DAYS = Math.floor(USAGE_POLICY.default_ttl_seconds / SECONDS_PER_DAY);
export const MIN_AUTO_DELETION_DAYS = Math.floor(USAGE_POLICY.min_ttl_seconds / SECONDS_PER_DAY);
export const MAX_AUTO_DELETION_DAYS = Math.floor(USAGE_POLICY.max_ttl_seconds / SECONDS_PER_DAY);
