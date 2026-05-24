import { mvpUsagePolicy } from "@agent-paste/contracts";

// The MVP usage policy is owned by @agent-paste/contracts (ADR 0038). Re-export it
// under the historical name and derive the constants the db package already exposes,
// so /v1/whoami and /v1/usage-policy cannot drift apart again.
export const USAGE_POLICY = mvpUsagePolicy;

export const DEFAULT_UPLOAD_SESSION_TTL_MS = mvpUsagePolicy.upload_session_ttl_seconds * 1000;
export const MAX_ARTIFACT_BYTES = mvpUsagePolicy.artifact_size_cap_bytes;
