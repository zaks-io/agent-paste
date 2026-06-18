import type { AuthRequirement, RequestBodyFor, RouteContract } from "@agent-paste/contracts";
import type { Context } from "hono";
import type { ErrorResponseOptions } from "./errors.js";
import type { AuthResult, Principal, PrincipalFor } from "./principal.js";
import type { RateLimitBindings } from "./rate-limit.js";

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
