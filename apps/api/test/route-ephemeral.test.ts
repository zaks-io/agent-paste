import { RepositoryError } from "@agent-paste/db";
import { countLeadingZeroBits, issuePowChallenge, type PowChallenge, solvePowChallenge } from "@agent-paste/tokens/pow";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { EPHEMERAL_PROVISION_LIMIT_PER_MINUTE } from "../src/ephemeral-provision-gate.js";
import {
  createMemoryEphemeralProvisionGateNamespace,
  resetMemoryEphemeralProvisionGate,
} from "../src/ephemeral-provision-gate-memory.js";
import { handleRequest } from "../src/index.js";
import { ephemeralClaimRoute, ephemeralProvisionRoute } from "../src/routes/ephemeral.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

const powSecret = "test-ephemeral-pow-secret";

// A hardcoded counter clears `difficulty` ~1/256 of the time by chance, which made
// the "rejects invalid solutions" assertion flake (AP-150). Search for a counter
// whose digest is provably under-difficulty so the solution is deterministically invalid.
async function findInvalidPowCounter(challenge: PowChallenge): Promise<number> {
  for (let counter = 0; counter < 1000; counter += 1) {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${challenge.nonce}:${counter}`)),
    );
    if (countLeadingZeroBits(digest) < challenge.difficulty) {
      return counter;
    }
  }
  throw new Error("no invalid counter found");
}

describe("ephemeral provision route", () => {
  it("returns pow_required for an empty POST body through the registrar", async () => {
    const response = await handleRequest(
      new Request("https://api.test/v1/ephemeral/provision", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.10", "content-type": "application/json" },
      }),
      {
        EPHEMERAL_POW_SECRET: powSecret,
        EPHEMERAL_PROVISION_IP_RATE_LIMIT: { limit: async () => ({ success: true }) },
        EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: { limit: async () => ({ success: true }) },
        DB: { getWhoami: vi.fn(), createEphemeralWorkspace: vi.fn() } as never,
      },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "pow_required" },
      challenge: { difficulty: 20 },
    });
  });

  it("lets the Durable Object, not the native global limiter, enforce the 18th valid provision", async () => {
    resetMemoryEphemeralProvisionGate();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const nativeGlobalLimit = vi.fn(async () => ({ success: true }));
    const env: Env = {
      EPHEMERAL_POW_SECRET: powSecret,
      EPHEMERAL_PROVISION_GATE:
        createMemoryEphemeralProvisionGateNamespace() as unknown as Env["EPHEMERAL_PROVISION_GATE"],
      EPHEMERAL_PROVISION_IP_RATE_LIMIT: { limit: async () => ({ success: true }) },
      EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: { limit: nativeGlobalLimit },
      DB: { getWhoami: vi.fn(), createEphemeralWorkspace } as never,
    };

    for (let index = 0; index < EPHEMERAL_PROVISION_LIMIT_PER_MINUTE; index += 1) {
      const response = await handleRequest(await validProvisionRequest(), env);
      expect(response.status).toBe(201);
    }

    const limited = await handleRequest(await validProvisionRequest(), env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "ephemeral_provision_rate_limited" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(EPHEMERAL_PROVISION_LIMIT_PER_MINUTE);
    expect(nativeGlobalLimit).toHaveBeenCalledTimes(EPHEMERAL_PROVISION_LIMIT_PER_MINUTE + 1);
  });

  it("returns a challenge when proof-of-work is missing", async () => {
    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret } }),
      {} as never,
      guardFor({}),
    );
    expect(response.status).toBe(401);
    await expect(responseJson(response)).resolves.toMatchObject({
      error: { code: "pow_required" },
      challenge: { difficulty: 20 },
    });
  });

  it("issues challenges at the difficulty configured via EPHEMERAL_POW_DIFFICULTY_BITS", async () => {
    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, EPHEMERAL_POW_DIFFICULTY_BITS: "8" } }),
      {} as never,
      guardFor({}),
    );
    expect(response.status).toBe(401);
    await expect(responseJson(response)).resolves.toMatchObject({
      error: { code: "pow_required" },
      challenge: { difficulty: 8 },
    });
  });

  it("fails loudly on a malformed EPHEMERAL_POW_DIFFICULTY_BITS", async () => {
    for (const raw of ["banana", "0", "33", "8.5", "1e1", "0x10", "-8"]) {
      await expect(
        ephemeralProvisionRoute(
          contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, EPHEMERAL_POW_DIFFICULTY_BITS: raw } }),
          {} as never,
          guardFor({}),
        ),
      ).rejects.toThrow(/EPHEMERAL_POW_DIFFICULTY_BITS/);
    }
  });

  it("rejects invalid proof-of-work solutions", async () => {
    const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const counter = await findInvalidPowCounter(challenge);
    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret } }),
      {} as never,
      guardFor({
        challenge,
        solution: { nonce: challenge.nonce, counter },
      }),
    );
    expect(response.status).toBe(400);
    await expect(responseJson(response)).resolves.toMatchObject({ error: { code: "pow_invalid" } });
  });
});

async function validProvisionRequest(): Promise<Request> {
  const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 1 });
  const counter = await solvePowChallenge(challenge);
  return new Request("https://api.test/v1/ephemeral/provision", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.10", "content-type": "application/json" },
    body: JSON.stringify({
      challenge,
      solution: { nonce: challenge.nonce, counter },
    }),
  });
}

function ephemeralWorkspaceFixture() {
  return {
    workspace: { id: "00000000-0000-4000-8000-000000000099" },
    api_key: { id: "key_ephemeral" },
    api_key_secret: "ap_pk_preview_test_secret",
    claim_token: { id: "ct_ephemeral" },
    claim_token_secret: "ap_ct_preview_claim_secret",
  };
}

describe("ephemeral claim route", () => {
  it("redeems a claim token for an authenticated member", async () => {
    const claimEphemeralWorkspace = vi.fn(async () => ({
      destination_workspace_id: "00000000-0000-4000-8000-000000000001",
      source_workspace_id: "00000000-0000-4000-8000-000000000099",
      artifact_ids: ["art_test"],
      claim_token_id: "ct_test",
    }));

    const response = await ephemeralClaimRoute(
      contextFor({}),
      {
        kind: "workos_access_token",
        identity: { workos_user_id: "user", email: "user@example.test" },
        actor: {
          type: "member",
          id: "mem_test",
          workspace_id: "00000000-0000-4000-8000-000000000001",
          email: "user@example.test",
          scopes: ["publish", "read", "admin"],
        },
      },
      { claimEphemeralWorkspace } as never,
      guardFor({ claim_token: "ap_ct_preview_testsecret000000_abc" }, "claim-1"),
    );

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({
      destination_workspace_id: "00000000-0000-4000-8000-000000000001",
      source_workspace_id: "00000000-0000-4000-8000-000000000099",
      artifact_ids: ["art_test"],
      claim_token_id: "ct_test",
    });
    expect(claimEphemeralWorkspace).toHaveBeenCalledWith({
      actor: {
        type: "member",
        id: "mem_test",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        email: "user@example.test",
        scopes: ["publish", "read", "admin"],
      },
      claimTokenSecret: "ap_ct_preview_testsecret000000_abc",
      idempotencyKey: "claim-1",
    });
  });

  it("maps invalid claim tokens to not_found", async () => {
    const response = await ephemeralClaimRoute(
      contextFor({}),
      {
        kind: "workos_access_token",
        identity: { workos_user_id: "user", email: "user@example.test" },
        actor: {
          type: "member",
          id: "mem_test",
          workspace_id: "00000000-0000-4000-8000-000000000001",
          email: "user@example.test",
          scopes: ["publish", "read", "admin"],
        },
      },
      {
        claimEphemeralWorkspace: vi.fn(async () => {
          throw new RepositoryError("not_found");
        }),
      } as never,
      guardFor({ claim_token: "ap_ct_preview_badtoken000000000_bad" }, "claim-2"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects unauthenticated principals", async () => {
    const response = await ephemeralClaimRoute(
      contextFor({}),
      { kind: "workos_access_token", identity: { workos_user_id: "user", email: "user@example.test" } },
      {} as never,
      guardFor({ claim_token: "ap_ct_preview_testsecret000000_abc" }, "claim-3"),
    );
    expect(response.status).toBe(403);
  });

  it("maps forbidden claim errors from the repository", async () => {
    const response = await ephemeralClaimRoute(
      contextFor({}),
      {
        kind: "workos_access_token",
        identity: { workos_user_id: "user", email: "user@example.test" },
        actor: {
          type: "member",
          id: "mem_test",
          workspace_id: "00000000-0000-4000-8000-000000000001",
          email: "user@example.test",
          scopes: ["publish", "read", "admin"],
        },
      },
      {
        claimEphemeralWorkspace: vi.fn(async () => {
          throw new RepositoryError("forbidden");
        }),
      } as never,
      guardFor({ claim_token: "ap_ct_preview_testsecret000000_abc" }, "claim-4"),
    );
    expect(response.status).toBe(403);
  });

  it("returns unauthorized through the registrar when the claim route is hit without auth", async () => {
    const response = await handleRequest(
      new Request("https://api.test/v1/ephemeral/claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "claim-registrar",
        },
        body: JSON.stringify({ claim_token: "ap_ct_preview_testsecret000000_abc" }),
      }),
      {
        EPHEMERAL_POW_SECRET: powSecret,
        DB: { claimEphemeralWorkspace: vi.fn() } as never,
      },
    );
    expect(response.status).toBe(401);
  });
});
