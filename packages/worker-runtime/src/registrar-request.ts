import {
  type ErrorCode,
  type RequestBodyFor,
  type RouteContract,
  requestSchemaFor,
  type Scope,
} from "@agent-paste/contracts";
import type { Context } from "hono";
import type { Principal, ScopedActor } from "./principal.js";
import type { HeaderGuardState } from "./registrar.js";

export function idempotencyGuard<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
): { ok: true; state: HeaderGuardState<Contract> } | { ok: false; code: ErrorCode } {
  if (contract.idempotency === "none") {
    return { ok: true, state: {} as HeaderGuardState<Contract> };
  }
  const idempotencyKey = context.req.raw.headers.get("idempotency-key");
  const normalized = idempotencyKey?.trim();
  if (!normalized) {
    return { ok: false, code: "invalid_idempotency_key" };
  }
  return { ok: true, state: { idempotencyKey: normalized } as HeaderGuardState<Contract> };
}

/**
 * Hard ceiling on a JSON request body. The largest legitimate body is the
 * create-upload-session manifest (<=100 files, each a bounded path + declared
 * size), which is tens of KB; 1 MiB leaves generous headroom while refusing
 * multi-MB/GB bodies before they are buffered into isolate memory.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export async function parseRequestBody<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
): Promise<{ ok: true; value: RequestBodyFor<Contract> } | { ok: false }> {
  const schema = requestSchemaFor(contract);
  if (!schema) {
    return { ok: true, value: undefined as RequestBodyFor<Contract> };
  }
  const capped = await readBodyTextCapped(context.req.raw, MAX_REQUEST_BODY_BYTES);
  if (!capped.ok) {
    return { ok: false };
  }
  let raw: unknown;
  const bodyText = capped.text;
  if (!bodyText.trim()) {
    if (contract.allowEmptyBody) {
      raw = {};
    } else {
      return { ok: false };
    }
  } else {
    try {
      raw = JSON.parse(bodyText);
    } catch {
      return { ok: false };
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, value: parsed.data as unknown as RequestBodyFor<Contract> };
}

/**
 * Reads the request body as UTF-8 text under a hard byte ceiling. Rejects on the
 * declared content-length first (cheap, no read), then caps the actual stream so a
 * chunked or mis-declared body cannot exceed the limit. Fails closed (`ok: false`)
 * the instant the cap is crossed, cancelling the stream instead of buffering the rest.
 */
async function readBodyTextCapped(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false };
  }
  const body = request.body;
  if (!body) {
    return { ok: true, text: "" };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export function hasScopes(principal: Principal, requiredScopes: readonly Scope[]): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }
  const actor = scopedActorForPrincipal(principal);
  if (!actor) {
    return false;
  }
  const scopes = new Set(actor.scopes ?? []);
  return requiredScopes.every((scope) => scopes.has(scope));
}

export function clientIpFromRequest(request: Request): string | undefined {
  const connecting = request.headers.get("CF-Connecting-IP")?.trim();
  return connecting || undefined;
}

function scopedActorForPrincipal(principal: Principal): ScopedActor | null {
  if (principal.kind === "api_key") {
    return principal.actor;
  }
  if (principal.kind === "workos_access_token" && principal.actor) {
    return principal.actor;
  }
  return null;
}
