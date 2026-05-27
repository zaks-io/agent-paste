import { IdempotencyInFlightError } from "@agent-paste/commands";
import {
  type AuthRequirement,
  type ErrorCode,
  type RequestBodyFor,
  type RouteContract,
  requestSchemaFor,
  type Scope,
} from "@agent-paste/contracts";
import type { Context } from "hono";
import { errorResponse, jsonResponse, unknownErrorToCode } from "./errors.js";
import type { AuthResult, Principal, PrincipalFor, ScopedActor } from "./principal.js";
import { applyRateLimit, type RateLimitBindings } from "./rate-limit.js";

export type AuthResolver<P extends Principal = Principal> = (
  context: Context,
  contract: RouteContract,
) => Promise<AuthResult<P>>;
export type AuthResolvers = Partial<Record<AuthRequirement, AuthResolver>>;

export type HeaderGuardState = {
  idempotencyKey?: string;
};

export type GuardState<Contract extends RouteContract = RouteContract> = HeaderGuardState & {
  body: RequestBodyFor<Contract>;
  params: Record<string, string>;
};

export type ReplayHook<Db> = (input: {
  context: Context;
  contract: RouteContract;
  principal: Principal;
  db: Db;
  guard: HeaderGuardState;
}) => Promise<Response | null>;

export type MountableHono = {
  on(method: string, path: string, handler: (context: Context) => Response | Promise<Response>): unknown;
};

export type Handler<Db, Contract extends RouteContract = RouteContract> = Db extends void
  ? (context: Context, principal: PrincipalFor<Contract["auth"]>, guard: GuardState<Contract>) => Promise<Response>
  : (
      context: Context,
      principal: PrincipalFor<Contract["auth"]>,
      db: Db,
      guard: GuardState<Contract>,
    ) => Promise<Response>;

export type RegistrarDeps<Db> = {
  app: MountableHono;
  auth: AuthResolvers;
  db?: (context: Context) => Db | undefined;
  rateLimitBindings?: (context: Context) => RateLimitBindings;
  docsBaseUrl?: (context: Context) => string | undefined;
  defaultErrorHeaders?: (context: Context) => Record<string, string>;
  replay?: ReplayHook<Db>;
  onMount?: (contract: RouteContract) => void;
};

export type Registrar<Db> = {
  mount<Contract extends RouteContract>(contract: Contract, handler: Handler<Db, Contract>): void;
};

export function createRegistrar<Db = void>(deps: RegistrarDeps<Db>): Registrar<Db> {
  return {
    mount(contract, handler) {
      const resolver = deps.auth[contract.auth];
      if (!resolver) {
        throw new Error(`No auth resolver registered for ${contract.auth} (${contract.id})`);
      }

      const routeHandler = async (context: Context) => {
        const auth = await resolver(context, contract);
        if (!auth.ok) {
          return errorResponse(context, auth.code, {
            message: auth.message,
            docsBaseUrl: deps.docsBaseUrl?.(context),
            defaultHeaders: deps.defaultErrorHeaders?.(context),
          });
        }

        const guard = idempotencyGuard(context, contract);
        if (!guard.ok) {
          return errorResponse(context, guard.code, {
            docsBaseUrl: deps.docsBaseUrl?.(context),
            defaultHeaders: deps.defaultErrorHeaders?.(context),
          });
        }

        const db = deps.db?.(context);
        if (deps.db && db === undefined) {
          return errorResponse(context, "database_unavailable", {
            docsBaseUrl: deps.docsBaseUrl?.(context),
            defaultHeaders: deps.defaultErrorHeaders?.(context),
          });
        }

        if (deps.replay && db !== undefined) {
          const replay = await deps.replay({
            context,
            contract,
            principal: auth.principal,
            db,
            guard: guard.state,
          });
          if (replay) {
            return replay;
          }
        }

        const rateLimit = await applyRateLimit(contract, auth.principal, deps.rateLimitBindings?.(context));
        if (!rateLimit.ok) {
          return errorResponse(context, rateLimit.code, {
            headers: { "Retry-After": rateLimit.retryAfter },
            docsBaseUrl: deps.docsBaseUrl?.(context),
            defaultHeaders: deps.defaultErrorHeaders?.(context),
          });
        }

        if (!hasScopes(auth.principal, contract.scopes)) {
          return errorResponse(context, "forbidden", {
            docsBaseUrl: deps.docsBaseUrl?.(context),
            defaultHeaders: deps.defaultErrorHeaders?.(context),
          });
        }

        const body = await parseRequestBody(context, contract);
        if (!body.ok) {
          return errorResponse(context, "invalid_request", {
            docsBaseUrl: deps.docsBaseUrl?.(context),
            defaultHeaders: deps.defaultErrorHeaders?.(context),
          });
        }

        const finalGuard = {
          ...guard.state,
          body: body.value,
          params: context.req.param(),
        } as GuardState<typeof contract>;

        try {
          if (deps.db) {
            return await (
              handler as (
                context: Context,
                principal: PrincipalFor<typeof contract.auth>,
                db: Db,
                guard: GuardState<typeof contract>,
              ) => Promise<Response>
            )(context, auth.principal as PrincipalFor<typeof contract.auth>, db as Db, finalGuard);
          }
          return await (
            handler as (
              context: Context,
              principal: PrincipalFor<typeof contract.auth>,
              guard: GuardState<typeof contract>,
            ) => Promise<Response>
          )(context, auth.principal as PrincipalFor<typeof contract.auth>, finalGuard);
        } catch (error) {
          if (error instanceof IdempotencyInFlightError) {
            return errorResponse(context, "idempotency_in_flight", {
              docsBaseUrl: deps.docsBaseUrl?.(context),
              defaultHeaders: deps.defaultErrorHeaders?.(context),
            });
          }
          const code = unknownErrorToCode(error);
          if (code) {
            return errorResponse(context, code, {
              docsBaseUrl: deps.docsBaseUrl?.(context),
              defaultHeaders: deps.defaultErrorHeaders?.(context),
            });
          }
          throw error;
        }
      };

      deps.app.on(contract.method, honoPath(contract.path), routeHandler);
      deps.onMount?.(contract);
    },
  };
}

function idempotencyGuard(
  context: Context,
  contract: RouteContract,
): { ok: true; state: HeaderGuardState } | { ok: false; code: ErrorCode } {
  if (contract.idempotency === "none") {
    return { ok: true, state: {} };
  }
  const idempotencyKey = context.req.raw.headers.get("idempotency-key");
  const normalized = idempotencyKey?.trim();
  if (!normalized) {
    return { ok: false, code: "invalid_idempotency_key" };
  }
  return { ok: true, state: { idempotencyKey: normalized } };
}

async function parseRequestBody<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
): Promise<{ ok: true; value: RequestBodyFor<Contract> } | { ok: false }> {
  const schema = requestSchemaFor(contract);
  if (!schema) {
    return { ok: true, value: undefined as RequestBodyFor<Contract> };
  }
  let raw: unknown;
  try {
    raw = await context.req.raw.json();
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, value: parsed.data as unknown as RequestBodyFor<Contract> };
}

function hasScopes(principal: Principal, requiredScopes: readonly Scope[]): boolean {
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

function scopedActorForPrincipal(principal: Principal): ScopedActor | null {
  if (principal.kind === "api_key") {
    return principal.actor;
  }
  if (principal.kind === "workos_access_token" && principal.actor) {
    return principal.actor;
  }
  return null;
}

function honoPath(path: string): string {
  if (path === "/v/{token}/{path}") {
    // Hono needs a trailing wildcard for content tokens whose signed path spans the rest of the URL.
    return "/v/:token/*";
  }
  return path.replaceAll(/\{([^}]+)\}/gu, ":$1");
}

export { jsonResponse };
