import { RepositoryError } from "@agent-paste/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { EPHEMERAL_PROVISION_LIMIT_PER_MINUTE } from "../src/ephemeral-provision-gate.js";
import {
  createMemoryEphemeralProvisionGateNamespace,
  resetMemoryEphemeralProvisionGate,
} from "../src/ephemeral-provision-gate-memory.js";
import { handleRequest } from "../src/index.js";
import { ephemeralClaimRoute, ephemeralProvisionRoute } from "../src/routes/ephemeral.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";
const claimToken = "ap_ct_preview_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyz012345";
const claimTokenWithClaimCode = `ap_ct_preview_0123456789ABCDEF.${claimCode}_abcdefghijklmnopqrstuvwxyz012345`;

afterEach(() => {
  resetMemoryEphemeralProvisionGate();
  vi.unstubAllGlobals();
});

describe("ephemeral provision route", () => {
  it("provisions on an empty POST body through the registrar without a challenge", async () => {
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const response = await handleRequest(
      new Request("https://api.test/v1/ephemeral/provision", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.10", "content-type": "application/json" },
      }),
      {
        EPHEMERAL_PROVISION_DELAY_MS: "0",
        EPHEMERAL_PROVISION_GATE:
          createMemoryEphemeralProvisionGateNamespace() as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        EPHEMERAL_PROVISION_IP_RATE_LIMIT: { limit: async () => ({ success: true }) },
        EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: { limit: async () => ({ success: true }) },
        DB: { getWhoami: vi.fn(), createEphemeralWorkspace } as never,
      },
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      api_key_secret: "ap_pk_preview_test_secret",
      claim_token: "ap_ct_preview_claim_secret",
    });
  });

  it("lets the Durable Object, not the native global limiter, enforce the 18th valid provision", async () => {
    vi.useFakeTimers({ now: new Date("2026-06-20T12:00:00.000Z") });
    try {
      resetMemoryEphemeralProvisionGate();
      const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
      const nativeGlobalLimit = vi.fn(async () => ({ success: true }));
      const env: Env = {
        EPHEMERAL_PROVISION_DELAY_MS: "0",
        EPHEMERAL_PROVISION_GATE:
          createMemoryEphemeralProvisionGateNamespace() as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        EPHEMERAL_PROVISION_IP_RATE_LIMIT: { limit: async () => ({ success: true }) },
        EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: { limit: nativeGlobalLimit },
        DB: { getWhoami: vi.fn(), createEphemeralWorkspace } as never,
      };

      for (let index = 0; index < EPHEMERAL_PROVISION_LIMIT_PER_MINUTE; index += 1) {
        const response = await handleRequest(validProvisionRequest(), env);
        expect(response.status).toBe(201);
      }

      const limited = await handleRequest(validProvisionRequest(), env);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
      await expect(limited.json()).resolves.toMatchObject({
        error: { code: "ephemeral_provision_rate_limited" },
      });
      expect(createEphemeralWorkspace).toHaveBeenCalledTimes(EPHEMERAL_PROVISION_LIMIT_PER_MINUTE);
      expect(nativeGlobalLimit).toHaveBeenCalledTimes(EPHEMERAL_PROVISION_LIMIT_PER_MINUTE + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits after the provision gate allows the request", async () => {
    const scheduler = { wait: vi.fn(async () => {}) };
    vi.stubGlobal("scheduler", scheduler);
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const response = await ephemeralProvisionRoute(
      contextFor({
        env: {
          EPHEMERAL_PROVISION_DELAY_MS: "17",
          EPHEMERAL_PROVISION_GATE:
            createMemoryEphemeralProvisionGateNamespace() as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        },
      }),
      { createEphemeralWorkspace } as never,
      guardFor({}),
    );
    expect(response.status).toBe(201);
    expect(scheduler.wait).toHaveBeenCalledWith(17);
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });
});

function validProvisionRequest(): Request {
  return new Request("https://api.test/v1/ephemeral/provision", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.10", "content-type": "application/json" },
    body: JSON.stringify({}),
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
    const writeDataPoint = vi.fn();
    const claimEphemeralWorkspaceWithReplayState = vi.fn(async () => ({
      result: {
        destination_workspace_id: "00000000-0000-4000-8000-000000000001",
        source_workspace_id: "00000000-0000-4000-8000-000000000099",
        artifact_ids: ["art_test"],
        claim_token_id: "ct_test",
      },
      isReplay: false,
    }));

    const response = await ephemeralClaimRoute(
      contextFor({ env: { FUNNEL_EVENTS: { writeDataPoint } } }),
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
      { claimEphemeralWorkspaceWithReplayState } as never,
      guardFor({ claim_token: claimTokenWithClaimCode }, "claim-1"),
    );

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({
      destination_workspace_id: "00000000-0000-4000-8000-000000000001",
      source_workspace_id: "00000000-0000-4000-8000-000000000099",
      artifact_ids: ["art_test"],
      claim_token_id: "ct_test",
    });
    expect(claimEphemeralWorkspaceWithReplayState).toHaveBeenCalledWith({
      actor: {
        type: "member",
        id: "mem_test",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        email: "user@example.test",
        scopes: ["publish", "read", "admin"],
      },
      claimTokenSecret: claimTokenWithClaimCode,
      idempotencyKey: "claim-1",
    });
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [claimCode],
      blobs: ["link_claimed", "api", claimCode, "00000000-0000-4000-8000-000000000099", "", "ct_test", "", ""],
      doubles: [1, 1],
    });
  });

  it("does not duplicate link_claimed telemetry on idempotent claim replay", async () => {
    const writeDataPoint = vi.fn();
    const claimEphemeralWorkspaceWithReplayState = vi.fn(async () => ({
      result: {
        destination_workspace_id: "00000000-0000-4000-8000-000000000001",
        source_workspace_id: "00000000-0000-4000-8000-000000000099",
        artifact_ids: ["art_test"],
        claim_token_id: "ct_test",
      },
      isReplay: true,
    }));

    const response = await ephemeralClaimRoute(
      contextFor({ env: { FUNNEL_EVENTS: { writeDataPoint } } }),
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
      { claimEphemeralWorkspaceWithReplayState } as never,
      guardFor({ claim_token: claimTokenWithClaimCode }, "claim-1"),
    );

    expect(response.status).toBe(200);
    expect(claimEphemeralWorkspaceWithReplayState).toHaveBeenCalledWith({
      actor: {
        type: "member",
        id: "mem_test",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        email: "user@example.test",
        scopes: ["publish", "read", "admin"],
      },
      claimTokenSecret: claimTokenWithClaimCode,
      idempotencyKey: "claim-1",
    });
    expect(writeDataPoint).not.toHaveBeenCalled();
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
        claimEphemeralWorkspaceWithReplayState: vi.fn(async () => {
          throw new RepositoryError("not_found");
        }),
      } as never,
      guardFor({ claim_token: claimToken }, "claim-2"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects unauthenticated principals", async () => {
    const response = await ephemeralClaimRoute(
      contextFor({}),
      { kind: "workos_access_token", identity: { workos_user_id: "user", email: "user@example.test" } },
      {} as never,
      guardFor({ claim_token: claimToken }, "claim-3"),
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
        claimEphemeralWorkspaceWithReplayState: vi.fn(async () => {
          throw new RepositoryError("forbidden");
        }),
      } as never,
      guardFor({ claim_token: claimToken }, "claim-4"),
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
        DB: { claimEphemeralWorkspace: vi.fn() } as never,
      },
    );
    expect(response.status).toBe(401);
  });
});
