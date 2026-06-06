export const EPHEMERAL_PROVISION_CONFIG_KV_KEY = "ephemeral-provision-config";
export const DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE = 17;
export const MIN_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE = 1;
export const MAX_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE = 100;

export type VersionedEphemeralProvisionConfig = {
  limit_per_minute: number;
  config_version: number;
};

export type AppliedProvisionConfig = VersionedEphemeralProvisionConfig;

export type EphemeralProvisionConfigKv = {
  get?(key: string): Promise<string | null>;
};

export type VersionedProvisionConfigResult =
  | { ok: true; config: AppliedProvisionConfig; changed: boolean }
  | { ok: false; reason: "unavailable" | "invalid" | "stale" };

export function defaultAppliedProvisionConfig(): AppliedProvisionConfig {
  return {
    config_version: 0,
    limit_per_minute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE,
  };
}

export async function resolveVersionedProvisionConfig(
  configKv: EphemeralProvisionConfigKv | undefined,
  applied: AppliedProvisionConfig | undefined,
): Promise<VersionedProvisionConfigResult> {
  const current = applied ?? defaultAppliedProvisionConfig();
  if (!configKv?.get) {
    if (current.config_version > 0) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, config: defaultAppliedProvisionConfig(), changed: applied === undefined };
  }

  let raw: string | null;
  try {
    raw = await configKv.get(EPHEMERAL_PROVISION_CONFIG_KV_KEY);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  return reconcileVersionedProvisionConfig(raw, applied);
}

export function reconcileVersionedProvisionConfig(
  raw: string | null,
  applied: AppliedProvisionConfig | undefined,
): VersionedProvisionConfigResult {
  const current = applied ?? defaultAppliedProvisionConfig();

  if (raw === null) {
    if (current.config_version > 0) {
      return { ok: false, reason: "stale" };
    }
    return { ok: true, config: defaultAppliedProvisionConfig(), changed: applied === undefined };
  }

  const parsed = parseVersionedEphemeralProvisionConfig(raw);
  if (!parsed) {
    return { ok: false, reason: "invalid" };
  }

  if (parsed.config_version < current.config_version) {
    return { ok: false, reason: "stale" };
  }

  if (parsed.config_version === current.config_version) {
    if (parsed.limit_per_minute !== current.limit_per_minute) {
      return { ok: false, reason: "stale" };
    }
    return { ok: true, config: current, changed: false };
  }

  return { ok: true, config: parsed, changed: true };
}

export function parseVersionedEphemeralProvisionConfig(raw: string): VersionedEphemeralProvisionConfig | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const candidate = body as Partial<VersionedEphemeralProvisionConfig>;
  if (!isValidConfigVersion(candidate.config_version) || !isValidLimitPerMinute(candidate.limit_per_minute)) {
    return null;
  }

  return {
    config_version: candidate.config_version,
    limit_per_minute: candidate.limit_per_minute,
  };
}

export function isValidLimitPerMinute(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE &&
    value <= MAX_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE
  );
}

function isValidConfigVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function normalizeAppliedProvisionConfig(value: unknown): AppliedProvisionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<AppliedProvisionConfig>;
  if (!isValidConfigVersion(candidate.config_version) || !isValidLimitPerMinute(candidate.limit_per_minute)) {
    return undefined;
  }
  return {
    config_version: candidate.config_version,
    limit_per_minute: candidate.limit_per_minute,
  };
}
