import { consumeCounterSlot, readCounterState } from "./counter-state.js";

export type WriteAllowanceStorage = {
  get(key: string): Promise<{ day: string; consumed: number; reservations?: string[] } | undefined>;
  put(key: string, value: { day: string; consumed: number; reservations?: string[] }): Promise<void>;
  delete(key: string): Promise<void>;
  deleteAlarm(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
};

export type WriteAllowanceNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
};

export type WriteAllowanceStatus = {
  consumed: number;
  remaining: number;
  retry_after_seconds: number;
};

export type WriteAllowanceConsumeResult =
  | ({ allowed: true } & WriteAllowanceStatus)
  | ({ allowed: false } & WriteAllowanceStatus);

const STORAGE_KEY = "daily_new_artifacts";

export async function getWriteAllowanceStatus(
  namespace: WriteAllowanceNamespace | undefined,
  workspaceId: string,
  limit: number,
): Promise<WriteAllowanceStatus | null> {
  if (!namespace) {
    return null;
  }
  const response = await namespace.get(namespace.idFromName(workspaceId)).fetch(
    new Request("https://write-allowance.internal/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit }),
    }),
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as Partial<WriteAllowanceStatus>;
  if (
    typeof body.consumed !== "number" ||
    typeof body.remaining !== "number" ||
    typeof body.retry_after_seconds !== "number"
  ) {
    return null;
  }
  return {
    consumed: body.consumed,
    remaining: body.remaining,
    retry_after_seconds: body.retry_after_seconds,
  };
}

export async function consumeWriteAllowance(
  namespace: WriteAllowanceNamespace | undefined,
  workspaceId: string,
  limit: number,
  idempotencyKey?: string,
): Promise<WriteAllowanceConsumeResult | null> {
  if (!namespace) {
    return null;
  }
  const response = await namespace.get(namespace.idFromName(workspaceId)).fetch(
    new Request("https://write-allowance.internal/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit, idempotency_key: idempotencyKey }),
    }),
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as Partial<WriteAllowanceConsumeResult>;
  if (
    typeof body.allowed !== "boolean" ||
    typeof body.consumed !== "number" ||
    typeof body.remaining !== "number" ||
    typeof body.retry_after_seconds !== "number"
  ) {
    return null;
  }
  return body.allowed
    ? {
        allowed: true,
        consumed: body.consumed,
        remaining: body.remaining,
        retry_after_seconds: body.retry_after_seconds,
      }
    : {
        allowed: false,
        consumed: body.consumed,
        remaining: body.remaining,
        retry_after_seconds: body.retry_after_seconds,
      };
}

export async function handleWriteAllowanceRequest(request: Request, storage: WriteAllowanceStorage): Promise<Response> {
  const url = new URL(request.url);
  let limit = 0;
  let body: { limit?: unknown; idempotency_key?: unknown } | null = null;
  if (request.method === "POST") {
    body = (await request.json().catch(() => null)) as { limit?: unknown; idempotency_key?: unknown } | null;
    if (!body || typeof body.limit !== "number" || body.limit <= 0) {
      return new Response("invalid_request", { status: 400 });
    }
    limit = body.limit;
  } else {
    return new Response("not_found", { status: 404 });
  }

  const stored = await storage.get(STORAGE_KEY);
  if (url.pathname.endsWith("/status")) {
    const snapshot = readCounterState(stored, limit);
    return Response.json({
      consumed: snapshot.consumed,
      remaining: snapshot.remaining,
      retry_after_seconds: snapshot.retry_after_seconds,
    });
  }
  if (url.pathname.endsWith("/consume")) {
    const idempotencyKey =
      body && typeof body.idempotency_key === "string" && body.idempotency_key.length > 0
        ? body.idempotency_key
        : undefined;
    const outcome = consumeCounterSlot(stored, limit, undefined, idempotencyKey);
    await storage.put(STORAGE_KEY, outcome.next);
    await storage.setAlarm(outcome.alarmAt);
    return Response.json({
      allowed: outcome.decision.allowed,
      consumed: outcome.decision.consumed,
      remaining: outcome.decision.remaining,
      retry_after_seconds: outcome.decision.retry_after_seconds,
    });
  }
  return new Response("not_found", { status: 404 });
}

export async function resetWriteAllowanceAlarm(storage: WriteAllowanceStorage): Promise<void> {
  await storage.delete(STORAGE_KEY);
  await storage.deleteAlarm();
}

export { STORAGE_KEY };
