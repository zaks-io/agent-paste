export { DEFAULT_EPHEMERAL_PROVISION_LIMIT_PER_MINUTE as EPHEMERAL_PROVISION_LIMIT_PER_MINUTE } from "./ephemeral-provision-config.js";

const WINDOW_MS = 60_000;

type SpentNonce = {
  nonce: string;
  expires_at_ms: number;
};

export type StoredGateState = {
  window_start_ms: number;
  consumed: number;
  spent_nonces?: SpentNonce[];
};

export type EphemeralProvisionGateDecision =
  | {
      allowed: true;
      consumed: number;
      remaining: number;
      retry_after_seconds: number;
    }
  | {
      allowed: false;
      reason: "duplicate_nonce" | "rate_limited";
      consumed: number;
      remaining: number;
      retry_after_seconds: number;
    };

type ConsumeGateInput = {
  nonce: string;
  nonceExpiresAtMs: number;
  nowMs: number;
  limitPerMinute: number;
};

export function consumeGateSlot(
  stored: StoredGateState | undefined,
  input: ConsumeGateInput,
): { next: StoredGateState; decision: EphemeralProvisionGateDecision } {
  const current = stateForNow(stored, input.nowMs);
  const duplicate = current.spent_nonces?.find((entry) => entry.nonce === input.nonce);
  if (duplicate) {
    return {
      next: current,
      decision: {
        allowed: false,
        reason: "duplicate_nonce",
        consumed: current.consumed,
        remaining: remainingSlots(current.consumed, input.limitPerMinute),
        retry_after_seconds: secondsUntil(duplicate.expires_at_ms, input.nowMs),
      },
    };
  }

  if (remainingSlots(current.consumed, input.limitPerMinute) <= 0) {
    return {
      next: current,
      decision: {
        allowed: false,
        reason: "rate_limited",
        consumed: current.consumed,
        remaining: 0,
        retry_after_seconds: secondsUntil(current.window_start_ms + WINDOW_MS, input.nowMs),
      },
    };
  }

  const consumed = current.consumed + 1;
  const spentNonces = [...(current.spent_nonces ?? []), { nonce: input.nonce, expires_at_ms: input.nonceExpiresAtMs }];
  return {
    next: {
      window_start_ms: current.window_start_ms,
      consumed,
      spent_nonces: spentNonces,
    },
    decision: {
      allowed: true,
      consumed,
      remaining: remainingSlots(consumed, input.limitPerMinute),
      retry_after_seconds: secondsUntil(current.window_start_ms + WINDOW_MS, input.nowMs),
    },
  };
}

export function stateForNow(stored: StoredGateState | undefined, nowMs: number): StoredGateState {
  const windowStart = windowStartFor(nowMs);
  return {
    window_start_ms: windowStart,
    consumed: stored?.window_start_ms === windowStart ? stored.consumed : 0,
    spent_nonces: (stored?.spent_nonces ?? []).filter((entry) => entry.expires_at_ms > nowMs),
  };
}

export function nextAlarmAt(state: StoredGateState, nowMs: number): number | null {
  const candidates: number[] = [];
  const windowResetAt = state.window_start_ms + WINDOW_MS;
  if (state.consumed > 0 && windowResetAt > nowMs) {
    candidates.push(windowResetAt);
  }
  const nonceExpirations = (state.spent_nonces ?? [])
    .map((entry) => entry.expires_at_ms)
    .filter((expiresAt) => expiresAt > nowMs);
  candidates.push(...nonceExpirations);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function normalizeStoredGateState(value: StoredGateState | undefined): StoredGateState | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Number.isInteger(value.window_start_ms) ||
    value.window_start_ms < 0 ||
    !Number.isInteger(value.consumed) ||
    value.consumed < 0
  ) {
    throw new Error("invalid_gate_state");
  }
  if (value.spent_nonces !== undefined && !value.spent_nonces.every(isSpentNonce)) {
    throw new Error("invalid_gate_state");
  }
  return value;
}

function isSpentNonce(value: unknown): value is SpentNonce {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as SpentNonce).nonce === "string" &&
    (value as SpentNonce).nonce.length > 0 &&
    Number.isInteger((value as SpentNonce).expires_at_ms) &&
    (value as SpentNonce).expires_at_ms >= 0
  );
}

function remainingSlots(consumed: number, limitPerMinute: number): number {
  return Math.max(0, limitPerMinute - consumed);
}

function windowStartFor(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 1000));
}
