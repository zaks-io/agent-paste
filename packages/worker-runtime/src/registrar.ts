import type { AuthRequirement, RequestBodyFor, RouteContract } from "@agent-paste/contracts";
import type { Context } from "hono";
import { boundResponderOptions } from "./bound-responders.js";
import { assertRegistrarGuardErrorsDeclared } from "./contract-errors.js";
import { type ErrorResponseOptions, jsonResponse } from "./errors.js";
import type { AuthResult, Principal, PrincipalFor } from "./principal.js";
import type { RateLimitBindings } from "./rate-limit.js";
import { createRouteHandler } from "./registrar-pipeline.js";

export type AuthResolver<P extends Principal = Principal> = (
  context: Context,
  contract: RouteContract,
) => Promise<AuthResult<P>>;
export type AuthResolvers = Partial<Record<AuthRequirement, AuthResolver>>;

type RequiredIdempotencyContract = { idempotency: "required" };
type NoIdempotencyContract = { idempotency: "none" };

export type HeaderGuardState<Contract extends Pick<RouteContract, "idempotency"> = RouteContract> =
  Contract extends RequiredIdempotencyContract
    ? { idempotencyKey: string }
    : Contract extends NoIdempotencyContract
      ? { idempotencyKey?: undefined }
      : { idempotencyKey?: string | undefined };

export type GuardState<Contract extends RouteContract = RouteContract> = HeaderGuardState<Contract> & {
  body: RequestBodyFor<Contract>;
  params: Record<string, string>;
  respondError: (code: Contract["errors"][number], messageOrOptions?: string | ErrorResponseOptions) => Response;
  respondJson: (body: unknown, status?: number, extraHeaders?: Record<string, string>) => Response;
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

      if (contract.rateLimit !== "none" && !deps.rateLimitBindings) {
        throw new Error(
          `Route ${contract.id} requires the '${contract.rateLimit}' rate limit, but this registrar has no rateLimitBindings provider. ` +
            `A missing binding would fail every request closed; wire rateLimitBindings into the registrar.`,
        );
      }

      assertRegistrarGuardErrorsDeclared(contract, { hasDb: deps.db !== undefined });

      const errorOptions = (context: Context) => {
        const config: Parameters<typeof boundResponderOptions>[1] = {};
        if (deps.docsBaseUrl) {
          config.docsBaseUrl = deps.docsBaseUrl;
        }
        if (deps.defaultErrorHeaders) {
          config.defaultErrorHeaders = deps.defaultErrorHeaders;
        }
        return boundResponderOptions(context, config);
      };

      const routeHandler = createRouteHandler({ deps, contract, resolver, handler, errorOptions });

      deps.app.on(contract.method, honoPath(contract.path), routeHandler);
      deps.onMount?.(contract);
    },
  };
}

function honoPath(path: string): string {
  // A trailing {path} param spans the rest of the URL (file paths keep their `/`
  // separators), which Hono can only match with a wildcard; handlers derive the
  // signed path from the raw URL instead of route params.
  const normalized = path.endsWith("/{path}") ? `${path.slice(0, -"{path}".length)}*` : path;
  // Params are always whole path segments, so a segment map avoids regex
  // backtracking on the route template (CodeQL js/polynomial-redos).
  return normalized
    .split("/")
    .map((segment) =>
      segment.length > 2 && segment.startsWith("{") && segment.endsWith("}") ? `:${segment.slice(1, -1)}` : segment,
    )
    .join("/");
}

export { jsonResponse };
