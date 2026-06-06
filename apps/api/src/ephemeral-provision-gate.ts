import { DEFAULT_POW_CHALLENGE_TTL_SECONDS } from "@agent-paste/tokens/pow";
import { isValidLimitPerMinute } from "./ephemeral-provision-config.js";
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
export const EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS = DEFAULT_POW_CHALLENGE_TTL_SECONDS;
const STORAGE_KEY = "ephemeral_provision_gate";
const INTERNAL_URL = "https://ephemeral-provision-gate.internal/consume";

export type EphemeralProvisionGateStorage = {
  get(key: string): Promise<StoredGateState | undefined>;
  put(key: string, value: StoredGateState): Promise<void>;
  delete(key: string): Promise<void>;
  deleteAlarm(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
};

export type EphemeralProvisionGateNamespace<Id = DurableObjectId> = {
  idFromName(name: string): Id;
  get(id: Id): { fetch(request: Request): Promise<Response> };
};

export async function consumeEphemeralProvisionGate<Id>(
  namespace: EphemeralProvisionGateNamespace<Id> | undefined,
  nonce: string,
  nonceTtlSeconds: number,
  limitPerMinute: number,
): Promise<EphemeralProvisionGateDecision | null> {
  if (!namespace || !isValidLimitPerMinute(limitPerMinute)) {
    return null;
  }

  try {
    const response = await namespace.get(namespace.idFromName(EPHEMERAL_PROVISION_GATE_NAME)).fetch(
      new Request(INTERNAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce, nonce_ttl_seconds: nonceTtlSeconds, limit_per_minute: limitPerMinute }),
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
): Promise<Response> {
  try {
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/consume")) {
      return new Response("not_found", { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as {
      nonce?: unknown;
      nonce_ttl_seconds?: unknown;
      limit_per_minute?: unknown;
    } | null;
    if (!body || typeof body.nonce !== "string" || body.nonce.length === 0) {
      return new Response("invalid_request", { status: 400 });
    }
    const nonceTtlSeconds = body.nonce_ttl_seconds;
    if (
      typeof nonceTtlSeconds !== "number" ||
      !Number.isInteger(nonceTtlSeconds) ||
      nonceTtlSeconds <= 0 ||
      nonceTtlSeconds > EPHEMERAL_PROVISION_GATE_MAX_NONCE_TTL_SECONDS
    ) {
      return new Response("invalid_request", { status: 400 });
    }
    if (!isValidLimitPerMinute(body.limit_per_minute)) {
      return new Response("invalid_request", { status: 400 });
    }

    const nowMs = Date.now();
    const stored = normalizeStoredGateState(await storage.get(STORAGE_KEY));
    const outcome = consumeGateSlot(stored, {
      nonce: body.nonce,
      nonceExpiresAtMs: nowMs + nonceTtlSeconds * 1000,
      nowMs,
      limitPerMinute: body.limit_per_minute,
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
  const stored = normalizeStoredGateState(await storage.get(STORAGE_KEY));
  await persistGateState(storage, stateForNow(stored, nowMs), nowMs);
}

export class EphemeralProvisionGate implements DurableObject {
  constructor(
    readonly state: DurableObjectState,
    readonly env: Cloudflare.Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    return handleEphemeralProvisionGateRequest(request, this.storageAdapter());
  }

  async alarm(): Promise<void> {
    await resetEphemeralProvisionGateAlarm(this.storageAdapter());
  }

  private storageAdapter(): EphemeralProvisionGateStorage {
    const storage = this.state.storage;
    return {
      get: (key) => storage.get(key),
      put: (key, value) => storage.put(key, value),
      delete: async (key) => {
        await storage.delete(key);
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
    await storage.delete(STORAGE_KEY);
    await storage.deleteAlarm();
    return;
  }

  await storage.put(
    STORAGE_KEY,
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
