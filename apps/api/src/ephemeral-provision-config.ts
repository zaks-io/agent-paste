import type { Env } from "./env.js";

export const EPHEMERAL_PROVISION_CONFIG_KV_KEY = "ephemeral-provision-config";
export const DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE = 17;
export const MIN_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE = 1;
export const MAX_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE = 100;

const CONFIG_MEMO_TTL_MS = 30_000;

type EphemeralProvisionConfig = {
  limit_per_minute: number;
};

export type EphemeralProvisionConfigResult =
  | { ok: true; limitPerMinute: number }
  | { ok: false; reason: "unavailable" | "invalid" };

let memo: { value: EphemeralProvisionConfigResult; expiresAt: number } | null = null;

// Test-only: drop the module memo so cases can assert KV reads in isolation.
export function __resetEphemeralProvisionConfigMemo(): void {
  memo = null;
}

export async function resolveEphemeralProvisionLimitPerMinute(env: Env): Promise<EphemeralProvisionConfigResult> {
  const now = Date.now();
  if (memo && memo.expiresAt > now) {
    return memo.value;
  }

  const result = await readEphemeralProvisionConfig(env);
  memo = { value: result, expiresAt: now + CONFIG_MEMO_TTL_MS };
  return result;
}

async function readEphemeralProvisionConfig(env: Env): Promise<EphemeralProvisionConfigResult> {
  const kv = env.EPHEMERAL_PROVISION_CONFIG;
  if (!kv?.get) {
    return { ok: true, limitPerMinute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE };
  }

  let raw: string | null;
  try {
    raw = await kv.get(EPHEMERAL_PROVISION_CONFIG_KV_KEY);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (raw === null) {
    return { ok: true, limitPerMinute: DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE };
  }

  const parsed = parseEphemeralProvisionConfig(raw);
  if (!parsed) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, limitPerMinute: parsed.limit_per_minute };
}

export function parseEphemeralProvisionConfig(raw: string): EphemeralProvisionConfig | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const candidate = body as Partial<EphemeralProvisionConfig>;
  if (!isValidLimitPerMinute(candidate.limit_per_minute)) {
    return null;
  }

  return { limit_per_minute: candidate.limit_per_minute };
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
