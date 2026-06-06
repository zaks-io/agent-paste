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

export async function parseRequestBody<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
): Promise<{ ok: true; value: RequestBodyFor<Contract> } | { ok: false }> {
  const schema = requestSchemaFor(contract);
  if (!schema) {
    return { ok: true, value: undefined as RequestBodyFor<Contract> };
  }
  let raw: unknown;
  const bodyText = await context.req.raw.text();
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
