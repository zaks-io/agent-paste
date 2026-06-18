import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { RequestBodyFor, RouteContract } from "@agent-paste/contracts";
import type { Context } from "hono";
import { createBoundResponders } from "./bound-responders.js";
import { contractErrorResponse, createContractErrorResponder } from "./contract-errors.js";
import { unknownErrorToCode } from "./errors.js";
import type { Principal, PrincipalFor } from "./principal.js";
import { applyRateLimit } from "./rate-limit.js";
import { clientIpFromRequest, hasScopes, idempotencyGuard, parseRequestBody } from "./registrar-request.js";
import type { AuthResolver, GuardState, Handler, HeaderGuardState, RegistrarDeps } from "./registrar-types.js";

type ErrorOptions = (context: Context) => { docsBaseUrl?: string; defaultHeaders?: Record<string, string> };

type RouteHandlerOptions<Db, Contract extends RouteContract> = {
  deps: RegistrarDeps<Db>;
  contract: Contract;
  resolver: AuthResolver;
  handler: Handler<Db, Contract>;
  errorOptions: ErrorOptions;
};

type GuardHalt = { ok: false; response: Response };
type PrincipalPhase<Contract extends RouteContract> = {
  ok: true;
  principal: PrincipalFor<Contract["auth"]>;
};
type HeaderGuardPhase<Contract extends RouteContract> = {
  ok: true;
  state: HeaderGuardState<Contract>;
};
type DbPhase<Db> = { ok: true; db: Db | undefined };
type PreparedRequest<Db, Contract extends RouteContract> = {
  ok: true;
  principal: PrincipalFor<Contract["auth"]>;
  db: Db | undefined;
  guard: GuardState<Contract>;
};

export function createRouteHandler<Db, Contract extends RouteContract>(
  options: RouteHandlerOptions<Db, Contract>,
): (context: Context) => Promise<Response> {
  return async (context) => {
    const prepared = await prepareRequest(context, options);
    if (!prepared.ok) {
      return prepared.response;
    }
    return invokeHandler(context, options, prepared);
  };
}

async function prepareRequest<Db, Contract extends RouteContract>(
  context: Context,
  options: RouteHandlerOptions<Db, Contract>,
): Promise<PreparedRequest<Db, Contract> | GuardHalt> {
  const principal = await resolvePrincipal(context, options.contract, options.resolver, options.errorOptions);
  if (!principal.ok) {
    return principal;
  }

  const headerGuard = resolveHeaderGuard(context, options.contract, options.errorOptions);
  if (!headerGuard.ok) {
    return headerGuard;
  }

  const db = resolveDb(context, options.contract, options.deps, options.errorOptions);
  if (!db.ok) {
    return db;
  }

  // Order fixed by ADR 0039/0064: scope checks precede idempotency replay, and
  // replays resolve before the rate limiter so they never consume budget.
  const scopes = enforceScopes(context, options.contract, principal.principal, options.errorOptions);
  if (!scopes.ok) {
    return scopes;
  }

  const replay = await replayCompletedRequest(context, options, principal.principal, db.db, headerGuard.state);
  if (replay) {
    return replay;
  }

  const rateLimit = await enforceRateLimit(
    context,
    options.contract,
    options.deps,
    principal.principal,
    options.errorOptions,
  );
  if (!rateLimit.ok) {
    return rateLimit;
  }

  const body = await parseBody(context, options.contract, options.errorOptions);
  if (!body.ok) {
    return body;
  }

  return {
    ok: true,
    principal: principal.principal,
    db: db.db,
    guard: buildGuardState(context, options.contract, headerGuard.state, body.value, options.errorOptions),
  };
}

async function resolvePrincipal<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  resolver: AuthResolver,
  errorOptions: ErrorOptions,
): Promise<PrincipalPhase<Contract> | GuardHalt> {
  const auth = await resolver(context, contract);
  if (!auth.ok) {
    return halt(
      contractErrorResponse(context, contract, auth.code, {
        message: auth.message,
        ...errorOptions(context),
      }),
    );
  }
  return { ok: true, principal: auth.principal as PrincipalFor<Contract["auth"]> };
}

function resolveHeaderGuard<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  errorOptions: ErrorOptions,
): HeaderGuardPhase<Contract> | GuardHalt {
  const guard = idempotencyGuard(context, contract);
  if (!guard.ok) {
    return halt(contractErrorResponse(context, contract, guard.code, errorOptions(context)));
  }
  return { ok: true, state: guard.state };
}

function resolveDb<Db, Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  deps: RegistrarDeps<Db>,
  errorOptions: ErrorOptions,
): DbPhase<Db> | GuardHalt {
  if (!deps.db) {
    return { ok: true, db: undefined };
  }

  const db = deps.db(context);
  if (db === undefined) {
    return halt(contractErrorResponse(context, contract, "database_unavailable", errorOptions(context)));
  }
  return { ok: true, db };
}

async function replayCompletedRequest<Db, Contract extends RouteContract>(
  context: Context,
  options: RouteHandlerOptions<Db, Contract>,
  principal: Principal,
  db: Db | undefined,
  guard: HeaderGuardState<Contract>,
): Promise<GuardHalt | null> {
  if (!options.deps.replay || db === undefined) {
    return null;
  }

  const replay = await options.deps.replay({
    context,
    contract: options.contract,
    principal,
    db,
    guard,
  });
  return replay ? halt(replay) : null;
}

async function enforceRateLimit<Db, Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  deps: RegistrarDeps<Db>,
  principal: Principal,
  errorOptions: ErrorOptions,
): Promise<{ ok: true } | GuardHalt> {
  const rateLimit = await applyRateLimit(contract, principal, deps.rateLimitBindings?.(context), {
    clientIp: clientIpFromRequest(context.req.raw),
  });
  if (rateLimit.ok) {
    return { ok: true };
  }
  return halt(
    contractErrorResponse(context, contract, rateLimit.code, {
      headers: { "Retry-After": rateLimit.retryAfter },
      ...errorOptions(context),
    }),
  );
}

function enforceScopes<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  principal: Principal,
  errorOptions: ErrorOptions,
): { ok: true } | GuardHalt {
  if (hasScopes(principal, contract.scopes)) {
    return { ok: true };
  }
  return halt(contractErrorResponse(context, contract, "forbidden", errorOptions(context)));
}

async function parseBody<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  errorOptions: ErrorOptions,
): Promise<{ ok: true; value: RequestBodyFor<Contract> } | GuardHalt> {
  const body = await parseRequestBody(context, contract);
  if (body.ok) {
    return body;
  }
  return halt(contractErrorResponse(context, contract, "invalid_request", errorOptions(context)));
}

function buildGuardState<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  headerGuard: HeaderGuardState<Contract>,
  body: RequestBodyFor<Contract>,
  errorOptions: ErrorOptions,
): GuardState<Contract> {
  const bound = createBoundResponders(context, errorOptions(context));
  const respondError = createContractErrorResponder(context, contract, errorOptions(context));
  return {
    ...headerGuard,
    body,
    params: context.req.param(),
    respondError,
    respondJson: bound.respondJson,
  } as GuardState<Contract>;
}

async function invokeHandler<Db, Contract extends RouteContract>(
  context: Context,
  options: RouteHandlerOptions<Db, Contract>,
  prepared: PreparedRequest<Db, Contract>,
): Promise<Response> {
  try {
    if (options.deps.db) {
      return await (
        options.handler as (
          context: Context,
          principal: PrincipalFor<Contract["auth"]>,
          db: Db,
          guard: GuardState<Contract>,
        ) => Promise<Response>
      )(context, prepared.principal, prepared.db as Db, prepared.guard);
    }
    return await (
      options.handler as (
        context: Context,
        principal: PrincipalFor<Contract["auth"]>,
        guard: GuardState<Contract>,
      ) => Promise<Response>
    )(context, prepared.principal, prepared.guard);
  } catch (error) {
    return mapHandlerError(context, options.contract, error, options.errorOptions);
  }
}

function mapHandlerError<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  error: unknown,
  errorOptions: ErrorOptions,
): Response {
  if (error instanceof IdempotencyInFlightError) {
    return contractErrorResponse(context, contract, "idempotency_in_flight", errorOptions(context));
  }

  const code = unknownErrorToCode(error);
  if (code) {
    return contractErrorResponse(context, contract, code, errorOptions(context));
  }
  throw error;
}

function halt(response: Response): GuardHalt {
  return { ok: false, response };
}
