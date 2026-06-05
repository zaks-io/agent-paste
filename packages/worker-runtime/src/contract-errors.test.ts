import { routeContracts } from "@agent-paste/contracts";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertContractError,
  assertRegistrarGuardErrorsDeclared,
  ContractErrorViolation,
  registrarGuardErrorCodes,
  setContractErrorEnforcement,
} from "./contract-errors.js";
import { createRegistrar } from "./registrar.js";
import {
  assertRouteRepositoryErrorsDeclared,
  collectRouteRepositoryDeclarationFailures,
  routeRepositorySurfaces,
} from "./route-repository-errors.js";

const baseContract = routeContracts.find((route) => route.id === "whoami.get");
if (!baseContract) {
  throw new Error("whoami.get contract missing");
}

const allowRateLimitBindings = () => ({
  actor: { limit: async () => ({ success: true }) },
  workspace: { limit: async () => ({ success: true }) },
});

beforeEach(() => {
  setContractErrorEnforcement(true);
});

afterEach(() => {
  setContractErrorEnforcement(undefined);
});

describe("contract error enforcement", () => {
  it("declares registrar guard codes for every route contract", () => {
    const failures: string[] = [];
    for (const contract of routeContracts) {
      try {
        assertRegistrarGuardErrorsDeclared(contract, { hasDb: false });
        if (contract.errors.includes("database_unavailable")) {
          assertRegistrarGuardErrorsDeclared(contract, { hasDb: true });
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    expect(failures).toEqual([]);
  });

  it("declares every repository surface error on the route that can emit it", () => {
    assertRouteRepositoryErrorsDeclared();
  });

  it("fails per-route when a repository surface code is missing from that route contract", () => {
    const failures = collectRouteRepositoryDeclarationFailures({
      ...routeRepositorySurfaces,
      "whoami.get": ["artifact_not_found"],
    });
    expect(failures).toEqual([
      "Route whoami.get can surface artifact_not_found -> artifact_not_found but contract.errors omits artifact_not_found",
    ]);
  });

  it("would pass a global-union check for the same per-route mismatch", () => {
    const unionDeclared = new Set(routeContracts.flatMap((route) => route.errors));
    expect(unionDeclared.has("artifact_not_found")).toBe(true);
    expect(collectRouteRepositoryDeclarationFailures({ "whoami.get": ["artifact_not_found"] }).length).toBe(1);
  });

  it("throws when emitting an undeclared code under test enforcement", () => {
    setContractErrorEnforcement(true);
    expect(() => assertContractError(baseContract, "artifact_not_found")).toThrow(ContractErrorViolation);
    expect(() => assertContractError(baseContract, "not_authenticated")).not.toThrow();
  });

  it("does not throw assertContractError when enforcement is disabled", () => {
    setContractErrorEnforcement(false);
    expect(() => assertContractError(baseContract, "artifact_not_found")).not.toThrow();
  });

  it("rejects registrar mount when guard codes are missing from the contract", () => {
    const app = new Hono();
    expect(() =>
      createRegistrar({
        app,
        auth: {
          async api_key() {
            return {
              ok: true,
              principal: { kind: "api_key", actor: { type: "api_key", id: "k", workspace_id: "w", scopes: [] } },
            };
          },
        },
      }).mount(
        {
          ...baseContract,
          errors: ["not_authenticated"],
        },
        async () => new Response(null, { status: 200 }),
      ),
    ).toThrow(/omits guard error code/);
  });

  it("fails the request when a handler uses respondError with an undeclared code under enforcement", async () => {
    setContractErrorEnforcement(true);
    const app = new Hono();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return {
            ok: true,
            principal: { kind: "api_key", actor: { type: "api_key", id: "k", workspace_id: "w", scopes: [] } },
          };
        },
      },
      rateLimitBindings: allowRateLimitBindings,
    }).mount(baseContract, async (_context, _principal, guard) => guard.respondError("artifact_not_found"));

    const response = await app.fetch(new Request("https://worker.test/v1/whoami"));
    expect(response.status).toBe(500);
  });

  it("returns the typed error in production enforcement mode when a code is undeclared", async () => {
    setContractErrorEnforcement(false);
    const { requestIdMiddleware } = await import("@agent-paste/auth");
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return {
            ok: true,
            principal: { kind: "api_key", actor: { type: "api_key", id: "k", workspace_id: "w", scopes: ["read"] } },
          };
        },
      },
      db: () => ({ ok: true }),
      rateLimitBindings: allowRateLimitBindings,
    }).mount(
      {
        ...baseContract,
        method: "POST",
        scopes: ["read"],
        errors: [...baseContract.errors, "forbidden", "artifact_not_found"],
      },
      async () => {
        throw new Error("artifact_not_found");
      },
    );

    const response = await app.fetch(new Request("https://worker.test/v1/whoami", { method: "POST" }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "artifact_not_found" } });
  });

  it("routes registrar guard failures through contractErrorResponse", async () => {
    const { requestIdMiddleware } = await import("@agent-paste/auth");
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return { ok: false, code: "not_authenticated" };
        },
      },
    }).mount(baseContract, async () => new Response(null, { status: 200 }));

    const response = await app.fetch(new Request("https://worker.test/v1/whoami"));
    expect(response.status).toBe(401);
  });

  it("lists actor rate-limit codes for scoped api-key routes", () => {
    expect(registrarGuardErrorCodes(baseContract, { hasDb: true })).toEqual(
      expect.arrayContaining(["rate_limited_actor", "rate_limited_workspace", "not_authenticated"]),
    );
  });

  it("covers every route id in the repository surface map", () => {
    expect(Object.keys(routeRepositorySurfaces).sort()).toEqual(routeContracts.map((route) => route.id).sort());
  });
});
