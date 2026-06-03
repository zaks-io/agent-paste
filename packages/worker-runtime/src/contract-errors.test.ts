import { routeContracts } from "@agent-paste/contracts";
import { RepositoryError, RepositoryErrorCode, repositoryErrorToAppError } from "@agent-paste/db";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  assertContractError,
  assertRegistrarGuardErrorsDeclared,
  ContractErrorViolation,
  contractErrorResponse,
  registrarGuardErrorCodes,
} from "./contract-errors.js";
import { createRegistrar } from "./registrar.js";

const baseContract = routeContracts.find((route) => route.id === "whoami.get");
if (!baseContract) {
  throw new Error("whoami.get contract missing");
}

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

  it("maps every public repository error to a declared route error", () => {
    const declared = new Set(routeContracts.flatMap((route) => route.errors));
    const unmapped: string[] = [];
    for (const kind of Object.values(RepositoryErrorCode)) {
      const mapped = repositoryErrorToAppError(new RepositoryError(kind));
      if (mapped && !declared.has(mapped)) {
        unmapped.push(`${kind} -> ${mapped}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it("throws when emitting an undeclared code under test enforcement", () => {
    expect(() => assertContractError(baseContract, "artifact_not_found")).toThrow(ContractErrorViolation);
    expect(() => assertContractError(baseContract, "not_authenticated")).not.toThrow();
  });

  it("rejects registrar mount when guard codes are missing from the contract", () => {
    const app = new Hono();
    expect(() =>
      createRegistrar({
        app,
        auth: {
          async api_key() {
            return { ok: true, principal: { kind: "api_key", actor: { type: "api_key", id: "k", workspace_id: "w", scopes: [] } } };
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

  it("fails the request when a handler uses respondError with an undeclared code", async () => {
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
    }).mount(baseContract, async (_context, _principal, guard) => guard.respondError("artifact_not_found"));

    const response = await app.fetch(new Request("https://worker.test/v1/whoami"));
    expect(response.status).toBe(500);
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
});
