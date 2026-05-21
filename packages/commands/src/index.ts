export type OperationStatus = "started" | "succeeded" | "failed" | "skipped";

export type OperationEvent = {
  id: string;
  operationId: string;
  type: string;
  status: OperationStatus;
  createdAt: string;
  message?: string;
  metadata?: Record<string, string>;
};

export type IdempotencyEntry<T> = {
  key: string;
  fingerprint: string;
  value: T;
  createdAt: string;
  expiresAt?: string;
};

export type IdempotencyStore<T> = {
  entries: Map<string, IdempotencyEntry<T>>;
};

export type CleanupResult<T> = {
  removed: T[];
  retained: T[];
};

export function createOperationEvent(input: Omit<OperationEvent, "id" | "createdAt"> & { now?: Date }): OperationEvent {
  const createdAt = (input.now ?? new Date()).toISOString();
  return {
    id: `${input.operationId}:${input.type}:${createdAt}`,
    operationId: input.operationId,
    type: input.type,
    status: input.status,
    createdAt,
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function createIdempotencyStore<T>(): IdempotencyStore<T> {
  return { entries: new Map() };
}

export function runIdempotent<T>(
  store: IdempotencyStore<T>,
  input: {
    key: string;
    fingerprint: string;
    ttlMs?: number;
    now?: Date;
    run: () => T;
  },
): { hit: boolean; value: T } {
  const now = input.now ?? new Date();
  const existing = store.entries.get(input.key);
  if (existing !== undefined && existing.fingerprint === input.fingerprint && !isExpired(existing.expiresAt, now)) {
    return { hit: true, value: existing.value };
  }

  const value = input.run();
  const expiresAt = input.ttlMs === undefined ? undefined : new Date(now.getTime() + input.ttlMs).toISOString();
  store.entries.set(input.key, {
    key: input.key,
    fingerprint: input.fingerprint,
    value,
    createdAt: now.toISOString(),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });

  return { hit: false, value };
}

export function cleanupExpired<T extends { expiresAt?: string }>(items: T[], now = new Date()): CleanupResult<T> {
  const removed: T[] = [];
  const retained: T[] = [];

  for (const item of items) {
    if (isExpired(item.expiresAt, now)) {
      removed.push(item);
    } else {
      retained.push(item);
    }
  }

  return { removed, retained };
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
  return expiresAt !== undefined && new Date(expiresAt).getTime() <= now.getTime();
}
