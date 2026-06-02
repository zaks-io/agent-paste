import { RepositoryError } from "@agent-paste/db";
import { issuePowChallenge, solvePowChallenge } from "@agent-paste/tokens/pow";
import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.js";
import { ephemeralClaimRoute, ephemeralProvisionRoute } from "../src/routes/ephemeral.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

const powSecret = "test-ephemeral-pow-secret";

describe("ephemeral provision route", () => {
  it("returns pow_required for an empty POST body through the registrar", async () => {
    const response = await handleRequest(
      new Request("https://api.test/v1/ephemeral/provision", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      {
        EPHEMERAL_POW_SECRET: powSecret,
        DENYLIST: memoryKv(),
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

  it("returns a challenge when proof-of-work is missing", async () => {
    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, DENYLIST: memoryKv() } }),
      {} as never,
      guardFor({}),
    );
    expect(response.status).toBe(401);
    await expect(responseJson(response)).resolves.toMatchObject({
      error: { code: "pow_required" },
      challenge: { difficulty: 20 },
    });
  });

  it("rejects invalid proof-of-work solutions", async () => {
    const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, DENYLIST: memoryKv() } }),
      {} as never,
      guardFor({
        challenge,
        solution: { nonce: challenge.nonce, counter: 0 },
      }),
    );
    expect(response.status).toBe(400);
    await expect(responseJson(response)).resolves.toMatchObject({ error: { code: "pow_invalid" } });
  });

  it("mints workspace credentials after a valid solution", async () => {
    const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const counter = await solvePowChallenge(challenge);
    const createEphemeralWorkspace = vi.fn(async () => ({
      workspace: { id: "00000000-0000-4000-8000-000000000099" },
      api_key: { id: "key_ephemeral" },
      api_key_secret: "ap_pk_preview_test_secret",
      claim_token: { id: "ct_ephemeral" },
      claim_token_secret: "ap_ct_preview_claim_secret",
    }));

    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, DENYLIST: memoryKv() } }),
      { createEphemeralWorkspace } as never,
      guardFor({
        challenge,
        solution: { nonce: challenge.nonce, counter },
      }),
    );

    expect(response.status).toBe(201);
    await expect(responseJson(response)).resolves.toEqual({
      api_key_secret: "ap_pk_preview_test_secret",
      claim_token: "ap_ct_preview_claim_secret",
      workspace_id: "00000000-0000-4000-8000-000000000099",
      api_key_id: "key_ephemeral",
      claim_token_id: "ct_ephemeral",
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledWith({
      idempotencyKey: `ephemeral-provision:${challenge.nonce}`,
    });
  });

  it("rejects replayed nonces", async () => {
    const kv = memoryKv();
    const challenge = await issuePowChallenge({ secret: powSecret, difficulty: 8 });
    const counter = await solvePowChallenge(challenge);
    const body = { challenge, solution: { nonce: challenge.nonce, counter } };
    const db = {
      createEphemeralWorkspace: vi.fn(async () => ({
        workspace: { id: "ws" },
        api_key: { id: "key" },
        api_key_secret: "secret",
        claim_token: { id: "ct" },
        claim_token_secret: "claim",
      })),
    };

    const first = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, DENYLIST: kv } }),
      db as never,
      guardFor(body),
    );
    expect(first.status).toBe(201);

    const replay = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret, DENYLIST: kv } }),
      db as never,
      guardFor(body),
    );
    expect(replay.status).toBe(400);
    expect(db.createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });
});

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
        DENYLIST: memoryKv(),
        DB: { claimEphemeralWorkspace: vi.fn() } as never,
      },
    );
    expect(response.status).toBe(401);
  });
});

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}
