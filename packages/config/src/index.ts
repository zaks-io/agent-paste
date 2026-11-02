export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;
export const MAX_FILE_BYTES = 262_144_000;
export const SINGLE_PUT_MAX_BYTES = 10 * MiB;
export const LEGACY_SINGLE_PUT_MAX_BYTES = 25 * MiB;
export const CHUNK_BYTES = 4 * MiB;
export const MAX_CHUNKS_PER_FILE = Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES);
export const MAX_REVISION_FILES = 10_000;
export const MAX_REVISION_BYTES = 2 * GiB;
export const MAX_FILE_MAP_BYTES = 8 * MiB;
export const UPLOAD_BATCH_MAX_FILES = 1_000;
export const UPLOAD_BATCH_MAX_DELETIONS = 1_000;
export const UPLOAD_TARGETS_PAGE_MAX = 1_000;
export const FILE_LIST_PAGE_MAX = 1_000;
/** @alias MAX_FILE_BYTES. Completion batches share the per-file verification bound. */
export const FILE_COMPLETION_BATCH_MAX_BYTES = MAX_FILE_BYTES;
export const READ_GRANT_TTL_SECONDS = 3_600;
export const REVISION_FILE_ENTRY_BYTES = 1_024;
export const STORAGE_BUDGET_BYTES_FREE = 5 * GiB;
export const STORAGE_BUDGET_BYTES_PRO = 50 * GiB;
export const REVISION_NUMBER_MAX = 2_147_483_647;

export const EPHEMERAL_POLICY_OVERRIDES = {
  file_size_cap_bytes: 10 * MiB,
  artifact_size_cap_bytes: 25 * MiB,
  file_count_cap: 100,
  lifetime_revision_ceiling: 100,
  storage_budget_bytes: 100 * MiB,
} as const;

export const LOCAL_DATA_DIR = ".agent-paste";
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PATH_SEGMENTS = 64;
export const MAX_PATH_LENGTH = 512;
/** Per-URL default cap for Access Link Signed URLs (ADR 0047 / 0056). */
export const ACCESS_LINK_SIGNED_URL_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_API_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CLEANUP_BATCH_SIZE = 100;

export const SECONDS_PER_DAY = 24 * 60 * 60;

/** Shortest auto-deletion window for unclaimed ephemeral workspaces (ADR 0056 row 20). */
export const EPHEMERAL_AUTO_DELETION_DAYS = 1;

/** Platform cap for pinned artifacts per workspace (ADR 0048 / 0056). */
export const PINNED_ARTIFACT_CAP = 50;

/** Daily new-Artifact write allowance for unclaimed ephemeral workspaces (ADR 0056 row 16). */
export const DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL = 20;

/** Daily new-Artifact write allowance for claimed `free` workspaces (ADR 0056 row 17). */
export const DAILY_NEW_ARTIFACT_ALLOWANCE_FREE = 100;

/** Daily new-Artifact write allowance for `pro` workspaces (ADR 0056 row 18). */
export const DAILY_NEW_ARTIFACT_ALLOWANCE_PRO = 2000;

/** @alias REVISION_NUMBER_MAX. Existing policy consumers retain this public name. */
export const LIFETIME_REVISION_CEILING = REVISION_NUMBER_MAX;

export type WorkspacePlan = "free" | "pro";
export type WriteAllowanceTier = "ephemeral" | "free" | "pro";

export const WORKSPACE_PLANS = ["free", "pro"] as const satisfies readonly WorkspacePlan[];

export type AgentPasteEnv = "dev" | "preview" | "production";

export function resolveAgentPasteEnv(value?: string | null): AgentPasteEnv {
  if (value === "dev" || value === "preview") {
    return value;
  }
  return "production";
}

export function isNonProductionAgentPasteEnv(value?: string | null): boolean {
  return resolveAgentPasteEnv(value) !== "production";
}

const MB = 1024 * 1024;

/** Shared caps that do not vary by Plan (rate limits are abuse ceilings, not Plan levers). */
const SHARED_USAGE_POLICY = {
  bundles_enabled: true,
  file_count_cap: MAX_REVISION_FILES,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: DEFAULT_UPLOAD_SESSION_TTL_MS / 1000,
  min_ttl_seconds: SECONDS_PER_DAY,
  lifetime_revision_ceiling: REVISION_NUMBER_MAX,
  single_put_max_bytes: SINGLE_PUT_MAX_BYTES,
  chunk_bytes: CHUNK_BYTES,
  revision_file_entry_bytes: REVISION_FILE_ENTRY_BYTES,
} as const;

const FREE_PLAN_OVERRIDES = {
  file_size_cap_bytes: MAX_FILE_BYTES,
  artifact_size_cap_bytes: MAX_REVISION_BYTES,
  storage_budget_bytes: STORAGE_BUDGET_BYTES_FREE,
  bundle_size_cap_bytes: 25 * MB,
  default_ttl_seconds: 3 * SECONDS_PER_DAY,
  max_ttl_seconds: 7 * SECONDS_PER_DAY,
  live_artifacts_cap: 50,
  live_update_enabled: false,
} as const;

const PRO_PLAN_OVERRIDES = {
  file_size_cap_bytes: MAX_FILE_BYTES,
  artifact_size_cap_bytes: MAX_REVISION_BYTES,
  storage_budget_bytes: STORAGE_BUDGET_BYTES_PRO,
  bundle_size_cap_bytes: 100 * MB,
  default_ttl_seconds: 30 * SECONDS_PER_DAY,
  max_ttl_seconds: 90 * SECONDS_PER_DAY,
  live_artifacts_cap: 1_000,
  live_update_enabled: true,
} as const;

function buildPlanUsagePolicy(plan: WorkspacePlan) {
  const tier = plan === "pro" ? PRO_PLAN_OVERRIDES : FREE_PLAN_OVERRIDES;
  return {
    ...SHARED_USAGE_POLICY,
    ...tier,
    daily_new_artifact_allowance: plan === "pro" ? DAILY_NEW_ARTIFACT_ALLOWANCE_PRO : DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
  };
}

export function resolveWriteAllowanceTier(input: {
  claimed: boolean;
  plan?: WorkspacePlan | null;
  billingEnabled?: boolean;
}): WriteAllowanceTier {
  if (!input.claimed) {
    return "ephemeral";
  }
  const billingEnabled = input.billingEnabled ?? false;
  if (!billingEnabled) {
    return "free";
  }
  return input.plan === "pro" ? "pro" : "free";
}

export function resolveDailyNewArtifactAllowance(input: {
  claimed: boolean;
  plan?: WorkspacePlan | null;
  billingEnabled?: boolean;
}): number {
  switch (resolveWriteAllowanceTier(input)) {
    case "ephemeral":
      return DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL;
    case "free":
      return DAILY_NEW_ARTIFACT_ALLOWANCE_FREE;
    case "pro":
      return DAILY_NEW_ARTIFACT_ALLOWANCE_PRO;
  }
}

/**
 * CLI-first MVP contract defaults (ADR 0066). Matches the `free` Plan tier when billing is on.
 * Runtime enforcement and `GET /v1/usage-policy` use {@link resolveUsagePolicy} instead.
 */
export const USAGE_POLICY = buildPlanUsagePolicy("free");
export type UsagePolicyConfig = {
  [K in keyof ReturnType<typeof buildPlanUsagePolicy>]: ReturnType<typeof buildPlanUsagePolicy>[K] extends number
    ? number
    : boolean;
};

export function isBillingEnabled(value?: string | boolean | null): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * Resolves the effective Usage Policy for a Workspace.
 * When billing is off, the launch default stays on the public `free` cap set.
 */
export function resolveUsagePolicy(input: {
  plan?: WorkspacePlan | null;
  billingEnabled?: boolean;
}): UsagePolicyConfig {
  const billingEnabled = input.billingEnabled ?? false;
  if (!billingEnabled) {
    return buildPlanUsagePolicy("free");
  }
  const plan = input.plan ?? "free";
  return buildPlanUsagePolicy(plan === "pro" ? "pro" : "free");
}

export type NormalizedPath = {
  path: string;
  segments: string[];
};

export function normalizeStoragePath(input: string): NormalizedPath {
  const segments = input
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.some((segment) => segment === "..")) {
    throw new Error("Storage paths cannot traverse upward.");
  }

  if (segments.length > MAX_PATH_SEGMENTS) {
    throw new Error(`Storage paths cannot exceed ${MAX_PATH_SEGMENTS} segments.`);
  }

  const path = segments.join("/");
  if (path.length === 0) {
    throw new Error("Storage paths cannot be empty.");
  }

  if (path.length > MAX_PATH_LENGTH) {
    throw new Error(`Storage paths cannot exceed ${MAX_PATH_LENGTH} characters.`);
  }

  return { path, segments };
}

export function isExpired(expiresAt: string | undefined, now = new Date()): boolean {
  return expiresAt !== undefined && new Date(expiresAt).getTime() <= now.getTime();
}
