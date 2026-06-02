import { describe, expect, it, vi } from "vitest";
import { issuePowChallenge, solvePowChallenge } from "@agent-paste/tokens/pow";
import { ephemeralProvisionRoute } from "../src/routes/ephemeral.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

const powSecret = "test-ephemeral-pow-secret";

describe("ephemeral provision route", () => {
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
