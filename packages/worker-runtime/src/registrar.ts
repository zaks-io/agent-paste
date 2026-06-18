import type { Context } from "hono";
import { boundResponderOptions } from "./bound-responders.js";
import { assertRegistrarGuardErrorsDeclared } from "./contract-errors.js";
import { jsonResponse } from "./errors.js";
import { createRouteHandler } from "./registrar-pipeline.js";
import type { Registrar, RegistrarDeps } from "./registrar-types.js";

// Registrar type surface lives in ./registrar-types.js so the pipeline and
// request helpers can share it without importing back into this module (which
// imports them at runtime). Re-exported here to preserve the public API.
export type {
  AuthResolver,
  AuthResolvers,
  GuardState,
  Handler,
  HeaderGuardState,
  MountableHono,
  Registrar,
  RegistrarDeps,
  ReplayHook,
} from "./registrar-types.js";

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
