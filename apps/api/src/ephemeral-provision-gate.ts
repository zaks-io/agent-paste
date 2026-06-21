import {
  type AppliedProvisionConfig,
  type EphemeralProvisionConfigKv,
  normalizeAppliedProvisionConfig,
  resolveVersionedProvisionConfig,
} from "./ephemeral-provision-config.js";
import {
  consumeGateSlot,
  type EphemeralProvisionGateDecision,
  nextAlarmAt,
  normalizeStoredGateState,
  type StoredGateState,
  stateForNow,
} from "./ephemeral-provision-gate-state.js";

export { DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE as EPHEMERAL_PROVISION_LIMIT_PER_MINUTE } from "./ephemeral-provision-config.js";
export type { EphemeralProvisionGateDecision } from "./ephemeral-provision-gate-state.js";

export const EPHEMERAL_PROVISION_GATE_NAME = "global";
export const EPHEMERAL_PROVISION_GATE_KEY_TTL_SECONDS = 5 * 60;
const GATE_STORAGE_KEY = "ephemeral_provision_gate";
const CONFIG_STORAGE_KEY = "ephemeral_provision_config";
const INTERNAL_URL = "https://ephemeral-provision-gate.internal/consume";

export type EphemeralProvisionGateStorage = {
  getGate(): Promise<StoredGateState | undefined>;
  getConfig(): Promise<AppliedProvisionConfig | undefined>;
  putGate(value: StoredGateState): Promise<void>;
  putConfig(value: AppliedProvisionConfig): Promise<void>;
  deleteGate(): Promise<void>;
  deleteAlarm(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
};

export type EphemeralProvisionGateNamespace<Id = DurableObjectId> = {
  idFromName(name: string): Id;
  get(id: Id): { fetch(request: Request): Promise<Response> };
};

export async function consumeEphemeralProvisionGate<Id>(
  namespace: EphemeralProvisionGateNamespace<Id> | undefined,
  key: string,
  keyTtlSeconds: number,
): Promise<EphemeralProvisionGateDecision | null> {
  if (!namespace) {
    return null;
  }

  try {
    const response = await namespace.get(namespace.idFromName(EPHEMERAL_PROVISION_GATE_NAME)).fetch(
      new Request(INTERNAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, key_ttl_seconds: keyTtlSeconds }),
      }),
    );
    if (!response.ok) {
      return null;
    }
    return parseGateDecision(await response.json().catch(() => null));
  } catch (error) {
    console.warn("Ephemeral provision gate fetch failed; denying request.", error);
    return null;
  }
}

export async function handleEphemeralProvisionGateRequest(
  request: Request,
  storage: EphemeralProvisionGateStorage,
  configKv?: EphemeralProvisionConfigKv,
): Promise<Response> {
  try {
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/consume")) {
      return new Response("not_found", { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as { key?: unknown; key_ttl_seconds?: unknown } | null;
    if (!body || typeof body.key !== "string" || body.key.length === 0) {
      return new Response("invalid_request", { status: 400 });
    }
    const keyTtlSeconds = body.key_ttl_seconds;
    if (
      typeof keyTtlSeconds !== "number" ||
      !Number.isInteger(keyTtlSeconds) ||
      keyTtlSeconds <= 0 ||
      keyTtlSeconds > EPHEMERAL_PROVISION_GATE_KEY_TTL_SECONDS
    ) {
      return new Response("invalid_request", { status: 400 });
    }

    const applied = normalizeAppliedProvisionConfig(await storage.getConfig());
    const configResolution = await resolveVersionedProvisionConfig(configKv, applied);
    if (!configResolution.ok) {
      return new Response("unavailable", { status: 503 });
    }
    if (configResolution.changed) {
      await storage.putConfig(configResolution.config);
    }

    const nowMs = Date.now();
    const stored = normalizeStoredGateState(await storage.getGate());
    const outcome = consumeGateSlot(stored, {
      nonce: body.key,
      nonceExpiresAtMs: nowMs + keyTtlSeconds * 1000,
      nowMs,
      limitPerMinute: configResolution.config.limit_per_minute,
    });
    await persistGateState(storage, outcome.next, nowMs);
    return Response.json(outcome.decision);
  } catch (error) {
    console.warn("Ephemeral provision gate storage failed; denying request.", error);
    return new Response("unavailable", { status: 503 });
  }
}

export async function resetEphemeralProvisionGateAlarm(storage: EphemeralProvisionGateStorage): Promise<void> {
  const nowMs = Date.now();
  const stored = normalizeStoredGateState(await storage.getGate());
  await persistGateState(storage, stateForNow(stored, nowMs), nowMs);
}

export class EphemeralProvisionGate implements DurableObject {
  constructor(
    readonly state: DurableObjectState,
    readonly env: Cloudflare.Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    return handleEphemeralProvisionGateRequest(request, this.storageAdapter(), this.env.EPHEMERAL_PROVISION_CONFIG);
  }

  async alarm(): Promise<void> {
    await resetEphemeralProvisionGateAlarm(this.storageAdapter());
  }

  private storageAdapter(): EphemeralProvisionGateStorage {
    const storage = this.state.storage;
    return {
      getGate: () => storage.get(GATE_STORAGE_KEY),
      getConfig: () => storage.get(CONFIG_STORAGE_KEY),
      putGate: (value) => storage.put(GATE_STORAGE_KEY, value),
      putConfig: (value) => storage.put(CONFIG_STORAGE_KEY, value),
      deleteGate: async () => {
        await storage.delete(GATE_STORAGE_KEY);
      },
      setAlarm: (scheduledTime) => storage.setAlarm(scheduledTime),
      deleteAlarm: () => storage.deleteAlarm(),
    };
  }
}

async function persistGateState(
  storage: EphemeralProvisionGateStorage,
  state: StoredGateState,
  nowMs: number,
): Promise<void> {
  const activeNonces = state.spent_nonces ?? [];
  if (state.consumed === 0 && activeNonces.length === 0) {
    await storage.deleteGate();
    await storage.deleteAlarm();
    return;
  }

  await storage.putGate(
    activeNonces.length > 0 ? state : { window_start_ms: state.window_start_ms, consumed: state.consumed },
  );
  const alarmAt = nextAlarmAt(state, nowMs);
  if (alarmAt) {
    await storage.setAlarm(alarmAt);
  }
}

function parseGateDecision(body: unknown): EphemeralProvisionGateDecision | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const candidate = body as Partial<EphemeralProvisionGateDecision>;
  if (!isGateStatus(candidate)) {
    return null;
  }
  if (candidate.allowed === true) {
    return {
      allowed: true,
      consumed: candidate.consumed,
      remaining: candidate.remaining,
      retry_after_seconds: candidate.retry_after_seconds,
    };
  }
  if (candidate.allowed === false && isGateDenyReason(candidate.reason)) {
    return {
      allowed: false,
      reason: candidate.reason,
      consumed: candidate.consumed,
      remaining: candidate.remaining,
      retry_after_seconds: candidate.retry_after_seconds,
    };
  }
  return null;
}

function isGateStatus(candidate: Partial<EphemeralProvisionGateDecision>): candidate is EphemeralProvisionGateDecision {
  return (
    typeof candidate.allowed === "boolean" &&
    isNonNegativeInteger(candidate.consumed) &&
    isNonNegativeInteger(candidate.remaining) &&
    isPositiveInteger(candidate.retry_after_seconds)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isGateDenyReason(value: unknown): value is "duplicate_nonce" | "rate_limited" {
  return value === "duplicate_nonce" || value === "rate_limited";
}
