import { issuePowChallenge, solvePowChallenge } from "@agent-paste/tokens/pow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { EPHEMERAL_PROVISION_LIMIT_PER_MINUTE } from "../src/ephemeral-provision-gate.js";
import {
  createMemoryEphemeralProvisionGateNamespace,
  resetMemoryEphemeralProvisionGate,
} from "../src/ephemeral-provision-gate-memory.js";
import { ephemeralProvisionRoute } from "../src/routes/ephemeral.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

const powSecret = "test-ephemeral-pow-secret";

beforeEach(() => {
  resetMemoryEphemeralProvisionGate();
});

describe("ephemeral provision gate route", () => {
  it("mints workspace credentials after a valid solution", async () => {
    const { challenge, body } = await validPowBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const response = await ephemeralProvisionRoute(
      contextFor({ env: provisionEnv() }),
      { createEphemeralWorkspace } as never,
      guardFor(body),
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
    const env = provisionEnv();
    const { body } = await validPowBody();
    const db = {
      createEphemeralWorkspace: vi.fn(async () => ephemeralWorkspaceFixture()),
    };

    const first = await ephemeralProvisionRoute(contextFor({ env }), db as never, guardFor(body));
    expect(first.status).toBe(201);

    const replay = await ephemeralProvisionRoute(contextFor({ env }), db as never, guardFor(body));
    expect(replay.status).toBe(400);
    expect(db.createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the Durable Object gate binding is missing", async () => {
    const { body } = await validPowBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_POW_SECRET: powSecret } }),
      { createEphemeralWorkspace } as never,
      guardFor(body),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(responseJson(response)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).not.toHaveBeenCalled();
  });

  it("fails closed when the Durable Object gate fetch fails", async () => {
    const { body } = await validPowBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const response = await ephemeralProvisionRoute(
      contextFor({
        env: provisionEnv({
          EPHEMERAL_PROVISION_GATE: {
            idFromName: (name: string) => name,
            get: () => ({ fetch: async () => Promise.reject(new Error("gate down")) }),
          } as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        }),
      }),
      { createEphemeralWorkspace } as never,
      guardFor(body),
    );

    expect(response.status).toBe(503);
    await expect(responseJson(response)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).not.toHaveBeenCalled();
  });

  it("fails closed when the Durable Object gate response is malformed", async () => {
    const { body } = await validPowBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const response = await ephemeralProvisionRoute(
      contextFor({
        env: provisionEnv({
          EPHEMERAL_PROVISION_GATE: {
            idFromName: (name: string) => name,
            get: () => ({ fetch: async () => Response.json({ allowed: true, consumed: "bad" }) }),
          } as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        }),
      }),
      { createEphemeralWorkspace } as never,
      guardFor(body),
    );

    expect(response.status).toBe(503);
    await expect(responseJson(response)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).not.toHaveBeenCalled();
  });

  it("returns rate_limited after the Durable Object global cap is exhausted", async () => {
    const env = provisionEnv();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    for (let index = 0; index < EPHEMERAL_PROVISION_LIMIT_PER_MINUTE; index += 1) {
      const response = await ephemeralProvisionRoute(
        contextFor({ env }),
        { createEphemeralWorkspace } as never,
        guardFor((await validPowBody(1)).body),
      );
      expect(response.status).toBe(201);
    }

    const limited = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor((await validPowBody(1)).body),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
    await expect(responseJson(limited)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_rate_limited" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(EPHEMERAL_PROVISION_LIMIT_PER_MINUTE);
  });
});

function provisionEnv(overrides: Partial<Env> = {}): Env {
  return {
    EPHEMERAL_POW_SECRET: powSecret,
    EPHEMERAL_PROVISION_GATE:
      createMemoryEphemeralProvisionGateNamespace() as unknown as Env["EPHEMERAL_PROVISION_GATE"],
    ...overrides,
  };
}

async function validPowBody(difficulty = 8) {
  const challenge = await issuePowChallenge({ secret: powSecret, difficulty });
  const counter = await solvePowChallenge(challenge);
  return {
    challenge,
    body: {
      challenge,
      solution: { nonce: challenge.nonce, counter },
    },
  };
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
