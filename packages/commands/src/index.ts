export {
  type RevisionQueueTargetState,
  type SkipRevisionQueueWorkReason,
  shouldSkipRevisionQueueWork,
} from "./queue-target.js";

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

export type ActorType = "api_key" | "member" | "admin" | "system" | "platform";

export type CommandActor = {
  type: ActorType;
  id: string;
  workspaceId: string | null;
};

export type CommandAuditEvent = {
  id?: string;
  workspaceId?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  requestId?: string | null;
  occurredAt?: string;
};

export type CommandHandlerResult<T> = {
  result: T;
  audit?: CommandAuditEvent[];
};

export type SqlValue = string | number | boolean | null | Record<string, unknown> | SqlValue[];
export type SqlQueryResult<Row = Record<string, unknown>> = { rows: Row[] };
export type SqlExecutor = {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<SqlQueryResult<Row>>;
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

export type RunCommandInput<T> = {
  executor: SqlExecutor;
  actor: CommandActor;
  operation: string;
  idempotencyKey: string;
  workspaceId?: string | null;
  now?: Date | string;
  staleAfterMs?: number;
  createEventId?: () => string;
  handler: (tx: SqlExecutor) => Promise<CommandHandlerResult<T>>;
};

export type RunCommandResult<T> = {
  result: T;
  isReplay: boolean;
};

const DEFAULT_STALE_MS = 5 * 60 * 1000;

export class IdempotencyInFlightError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 1) {
    super("idempotency_in_flight");
    this.name = "IdempotencyInFlightError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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

export type PeekIdempotentReplayInput = {
  executor: SqlExecutor;
  actor: CommandActor;
  operation: string;
  idempotencyKey: string;
  workspaceId?: string | null;
  now?: Date | string;
  staleAfterMs?: number;
};

export type PeekIdempotentReplayResult<T> = { result: T } | { inFlight: true } | null;

export async function peekIdempotentReplay<T>(
  input: PeekIdempotentReplayInput,
): Promise<PeekIdempotentReplayResult<T>> {
  const workspaceId = input.workspaceId === undefined ? input.actor.workspaceId : input.workspaceId;
  const existing = await input.executor.query<{ status: string; result_json: T | null; created_at: string }>(
    `select status, result_json, created_at
     from idempotency_records
     where workspace_id is not distinct from $1
       and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5`,
    [workspaceId, input.actor.type, input.actor.id, input.operation, input.idempotencyKey],
  );
  const record = existing.rows[0];
  if (!record) {
    return null;
  }
  if (record.status === "completed") {
    return { result: record.result_json as T };
  }
  // Mirror runCommand's stale-claim semantics: a stale in_flight record is
  // reclaimable by a retry, so reporting it as in-flight would wedge the key.
  const now = toIsoString(input.now ?? new Date());
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_MS;
  if (record.status === "in_flight" && !isStale(record.created_at, now, staleAfterMs)) {
    return { inFlight: true };
  }
  return null;
}

export async function runCommand<T>(input: RunCommandInput<T>): Promise<RunCommandResult<T>> {
  const now = toIsoString(input.now ?? new Date());
  const workspaceId = input.workspaceId === undefined ? input.actor.workspaceId : input.workspaceId;
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_MS;
  const createEventId = input.createEventId ?? defaultEventId;

  const execute = async (tx: SqlExecutor): Promise<RunCommandResult<T>> => {
    const claim = await tx.query<{ workspace_id: string | null }>(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       on conflict do nothing
       returning workspace_id`,
      [workspaceId, input.actor.type, input.actor.id, input.operation, input.idempotencyKey, now],
    );

    const ctx: ExecuteContext<T> = {
      workspaceId,
      actor: input.actor,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      now,
      handler: input.handler,
      createEventId,
    };

    if (claim.rows.length === 0) {
      return resolveExisting(tx, { ...ctx, staleAfterMs });
    }

    return executeHandler(tx, ctx);
  };

  return input.executor.transaction(execute);
}

type ExecuteContext<T> = {
  workspaceId: string | null;
  actor: CommandActor;
  operation: string;
  idempotencyKey: string;
  now: string;
  handler: (tx: SqlExecutor) => Promise<CommandHandlerResult<T>>;
  createEventId: () => string;
};

type ResolveContext<T> = ExecuteContext<T> & { staleAfterMs: number };

async function resolveExisting<T>(tx: SqlExecutor, ctx: ResolveContext<T>): Promise<RunCommandResult<T>> {
  const existing = await tx.query<{ status: string; result_json: T | null; created_at: string }>(
    `select status, result_json, created_at
     from idempotency_records
     where workspace_id is not distinct from $1
       and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5
     for update`,
    [ctx.workspaceId, ctx.actor.type, ctx.actor.id, ctx.operation, ctx.idempotencyKey],
  );
  const record = existing.rows[0];
  if (!record) {
    throw new Error("idempotency_record_missing");
  }
  if (record.status === "completed") {
    return { result: record.result_json as T, isReplay: true };
  }
  if (record.status === "in_flight" && isStale(record.created_at, ctx.now, ctx.staleAfterMs)) {
    await tx.query(
      `update idempotency_records
       set status = 'in_flight', result_json = null, completed_at = null, created_at = $6
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5`,
      [ctx.workspaceId, ctx.actor.type, ctx.actor.id, ctx.operation, ctx.idempotencyKey, ctx.now],
    );
    return executeHandler(tx, ctx);
  }
  throw new IdempotencyInFlightError();
}

async function executeHandler<T>(tx: SqlExecutor, ctx: ExecuteContext<T>): Promise<RunCommandResult<T>> {
  const { result, audit = [] } = await ctx.handler(tx);

  // postgres-js' default jsonb serializer is replaced by drizzle's construct() with an
  // identity function, so raw tx.query() callers must hand the wire encoder a string.
  await tx.query(
    `update idempotency_records
     set status = 'completed', result_json = $6::jsonb, completed_at = $7
     where workspace_id is not distinct from $1
       and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5`,
    [ctx.workspaceId, ctx.actor.type, ctx.actor.id, ctx.operation, ctx.idempotencyKey, JSON.stringify(result), ctx.now],
  );

  for (const event of audit) {
    await tx.query(
      `insert into operation_events
         (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        event.id ?? ctx.createEventId(),
        event.workspaceId === undefined ? ctx.workspaceId : event.workspaceId,
        event.actorType ?? ctx.actor.type,
        event.actorId === undefined ? ctx.actor.id : event.actorId,
        event.action,
        event.targetType,
        event.targetId,
        JSON.stringify(event.details ?? {}),
        event.requestId ?? null,
        event.occurredAt ?? ctx.now,
      ],
    );
  }

  return { result, isReplay: false };
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
  return expiresAt !== undefined && new Date(expiresAt).getTime() <= now.getTime();
}

function isStale(createdAt: string, now: string, staleAfterMs: number): boolean {
  return new Date(now).getTime() - new Date(createdAt).getTime() >= staleAfterMs;
}

function toIsoString(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function defaultEventId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = webCrypto?.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `evt_${uuid.replaceAll("-", "")}`;
}
