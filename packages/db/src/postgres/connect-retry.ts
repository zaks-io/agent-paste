// Neon's serverless Postgres scales the compute to zero when idle. The first
// query after an idle period must wake it, and a cold wake plus connect can
// exceed postgres.js' connect_timeout, so the connection attempt throws before
// any statement runs (observed in prod as Hyperdrive "Timed out while creating a
// new server connection" / postgres.js CONNECT_TIMEOUT). The compute is warm by
// the time the error surfaces, so a bounded retry reconnects transparently
// instead of bubbling a 500.
//
// Retry safety hinges on WHEN the failure can surface, so there are two
// predicates:
//
//   - Establishment failures (isConnectEstablishmentError) happen BEFORE the
//     first statement runs — the connection never opened. Re-running the whole
//     operation, including a multi-statement transaction, cannot double-apply
//     work. Only these are safe to retry on the transaction path.
//
//   - Mid-flight connection drops (CONNECTION_CLOSED / CONNECTION_DESTROYED) can
//     fire AFTER statements were sent — e.g. the socket closing after COMMIT was
//     written but before its acknowledgement was read, when the server may have
//     already committed. Retrying a single client.unsafe query on these is safe
//     (a lone failed query applied nothing), but retrying a whole transaction
//     callback would re-run non-idempotent writes. So they belong to the broader
//     query-only predicate, never the transaction predicate.
//
// Every other error (query, constraint, auth) is rethrown immediately: fail
// fast, fail loud.

// Raised by postgres.js (connection.js:262 / errors.js) only at connect time,
// and the wording Cloudflare Hyperdrive surfaces when a cold-start connect times
// out. Safe to retry anywhere because no statement has executed yet.
const ESTABLISHMENT_CODES = new Set(["CONNECT_TIMEOUT"]);
const ESTABLISHMENT_MESSAGE = /timed out while creating a new server connection|econnrefused/i;

// Additional codes postgres.js raises when an already-open socket drops
// (connection.js:425/453). Retryable for a single query, NOT for a transaction.
const MIDFLIGHT_DROP_CODES = new Set(["CONNECTION_CLOSED", "CONNECTION_DESTROYED"]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/** Connection never opened: no statement ran, so retrying any operation is safe. */
export function isConnectEstablishmentError(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== undefined && ESTABLISHMENT_CODES.has(code)) {
    return true;
  }
  return ESTABLISHMENT_MESSAGE.test(errorMessage(error));
}

/** Establishment failure OR a mid-flight socket drop. Only safe to retry on a single query. */
export function isConnectError(error: unknown): boolean {
  if (isConnectEstablishmentError(error)) {
    return true;
  }
  const code = errorCode(error);
  return code !== undefined && MIDFLIGHT_DROP_CODES.has(code);
}

export type ConnectRetryOptions = {
  /** Total attempts including the first. Cold Neon wakes well within one retry. */
  attempts?: number;
  /** Base backoff in ms; doubles each retry, with full jitter. */
  baseDelayMs?: number;
  /** Cap on a single backoff wait in ms. */
  maxDelayMs?: number;
  /** Predicate deciding which errors are retryable; defaults to the query-safe set. */
  retryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export const DEFAULT_CONNECT_RETRY: Required<Pick<ConnectRetryOptions, "attempts" | "baseDelayMs" | "maxDelayMs">> = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Full-jitter exponential backoff: random in [0, min(cap, base * 2^attempt)].
// Jitter avoids a thundering-herd reconnect when many requests cold-start at once.
function backoffDelay(attemptIndex: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attemptIndex);
  return Math.floor(random() * ceiling);
}

async function runWithRetry<T>(run: () => Promise<T>, options: ConnectRetryOptions): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_CONNECT_RETRY.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_CONNECT_RETRY.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_CONNECT_RETRY.maxDelayMs;
  const retryable = options.retryable ?? isConnectError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !retryable(error)) {
        throw error;
      }
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs, random));
    }
  }
  throw lastError;
}

/** Retry a single query on any connect-class failure (establishment or mid-flight drop). */
export function withConnectRetry<T>(run: () => Promise<T>, options: ConnectRetryOptions = {}): Promise<T> {
  return runWithRetry(run, options);
}

/**
 * Retry a whole transaction ONLY on an establishment failure, never on a
 * mid-flight drop — a drop can fire after COMMIT, and re-running the callback
 * would double-apply non-idempotent writes.
 */
export function withTransactionConnectRetry<T>(run: () => Promise<T>, options: ConnectRetryOptions = {}): Promise<T> {
  return runWithRetry(run, { ...options, retryable: options.retryable ?? isConnectEstablishmentError });
}
