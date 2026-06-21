import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { EPHEMERAL_PROVISION_CONFIG_KV_KEY } from "../src/ephemeral-provision-config.js";
import { EPHEMERAL_PROVISION_LIMIT_PER_MINUTE } from "../src/ephemeral-provision-gate.js";
import {
  createMemoryEphemeralProvisionGateNamespace,
  resetMemoryEphemeralProvisionGate,
} from "../src/ephemeral-provision-gate-memory.js";
import { ephemeralProvisionRoute } from "../src/routes/ephemeral.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";

beforeEach(() => {
  resetMemoryEphemeralProvisionGate();
});

describe("ephemeral provision gate route", () => {
  it("mints workspace credentials after the gate allows the request", async () => {
    const body = validProvisionBody();
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
    expect(createEphemeralWorkspace).toHaveBeenCalledOnce();
    const input = createEphemeralWorkspace.mock.calls[0]?.[0];
    expect(input?.idempotencyKey).toMatch(/^ephemeral-provision:/);
  });

  it("records claim-code-attributed provision events", async () => {
    const body = validProvisionBody();
    const writeDataPoint = vi.fn();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const response = await ephemeralProvisionRoute(
      contextFor({ env: provisionEnv({ FUNNEL_EVENTS: { writeDataPoint } }) }),
      { createEphemeralWorkspace } as never,
      guardFor({ ...body, claim_code: claimCode }),
    );

    expect(response.status).toBe(201);
    expect(createEphemeralWorkspace).toHaveBeenCalledOnce();
    const input = createEphemeralWorkspace.mock.calls[0]?.[0];
    expect(input?.idempotencyKey).toMatch(/^ephemeral-provision:/);
    expect(input?.claimCode).toBe(claimCode);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [claimCode],
      blobs: [
        "ephemeral_workspace_created",
        "api",
        claimCode,
        "00000000-0000-4000-8000-000000000099",
        "",
        "ct_ephemeral",
        "",
        "",
      ],
      doubles: [1, 0],
    });
  });

  it("ignores malformed claim codes for provision telemetry", async () => {
    const body = validProvisionBody();
    const writeDataPoint = vi.fn();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const response = await ephemeralProvisionRoute(
      contextFor({ env: provisionEnv({ FUNNEL_EVENTS: { writeDataPoint } }) }),
      { createEphemeralWorkspace } as never,
      guardFor({ ...body, claim_code: "bad" }),
    );

    expect(response.status).toBe(201);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["00000000-0000-4000-8000-000000000099"],
      blobs: [
        "ephemeral_workspace_created",
        "api",
        "",
        "00000000-0000-4000-8000-000000000099",
        "",
        "ct_ephemeral",
        "",
        "",
      ],
      doubles: [1, 0],
    });
  });

  it("treats identical provision bodies as independent attempts", async () => {
    const env = provisionEnv();
    const body = validProvisionBody();
    const db = {
      createEphemeralWorkspace: vi.fn(async () => ephemeralWorkspaceFixture()),
    };

    const first = await ephemeralProvisionRoute(contextFor({ env }), db as never, guardFor(body));
    expect(first.status).toBe(201);

    const second = await ephemeralProvisionRoute(contextFor({ env }), db as never, guardFor(body));
    expect(second.status).toBe(201);
    expect(db.createEphemeralWorkspace).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the Durable Object gate binding is missing", async () => {
    const body = validProvisionBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const response = await ephemeralProvisionRoute(
      contextFor({ env: { EPHEMERAL_PROVISION_DELAY_MS: "0" } }),
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
    const body = validProvisionBody();
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
    const body = validProvisionBody();
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

  it("fails closed when the Durable Object gate response has malformed numeric values", async () => {
    const body = validProvisionBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const response = await ephemeralProvisionRoute(
      contextFor({
        env: provisionEnv({
          EPHEMERAL_PROVISION_GATE: {
            idFromName: (name: string) => name,
            get: () => ({
              fetch: async () =>
                Response.json({
                  allowed: true,
                  consumed: -1,
                  remaining: -1,
                  retry_after_seconds: 0,
                }),
            }),
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

  it("fails closed when runtime cap config is invalid", async () => {
    const body = validProvisionBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const response = await ephemeralProvisionRoute(
      contextFor({
        env: provisionEnv({
          EPHEMERAL_PROVISION_CONFIG: {
            get: async () => versionedConfig(999, 1),
            put: async () => {},
            delete: async () => {},
          },
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

  it("fails closed after a successful provision when runtime cap config becomes invalid", async () => {
    let raw: string | null = versionedConfig(5, 1);
    const env = provisionEnv({
      EPHEMERAL_PROVISION_CONFIG: {
        get: async (key) => (key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? raw : null),
        put: async () => {},
        delete: async () => {},
      },
    });
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const first = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );
    expect(first.status).toBe(201);

    raw = '{"limit_per_minute":999,"config_version":2}';
    const blocked = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );

    expect(blocked.status).toBe(503);
    await expect(responseJson(blocked)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a successful provision when KV returns a stale older version", async () => {
    let raw: string | null = versionedConfig(5, 2);
    const env = provisionEnv({
      EPHEMERAL_PROVISION_CONFIG: {
        get: async (key) => (key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? raw : null),
        put: async () => {},
        delete: async () => {},
      },
    });
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const first = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );
    expect(first.status).toBe(201);

    raw = versionedConfig(17, 1);
    const blocked = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );

    expect(blocked.status).toBe(503);
    await expect(responseJson(blocked)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a successful provision when runtime cap config becomes unavailable", async () => {
    let shouldReject = false;
    const env = provisionEnv({
      EPHEMERAL_PROVISION_CONFIG: {
        get: async (key) => {
          if (key !== EPHEMERAL_PROVISION_CONFIG_KV_KEY) {
            return null;
          }
          if (shouldReject) {
            return Promise.reject(new Error("kv offline"));
          }
          return versionedConfig(5, 1);
        },
        put: async () => {},
        delete: async () => {},
      },
    });
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const first = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );
    expect(first.status).toBe(201);

    shouldReject = true;
    const blocked = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );

    expect(blocked.status).toBe(503);
    await expect(responseJson(blocked)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a successful provision when the KV binding is absent but DO state has a versioned cap", async () => {
    const configKv = {
      get: async (key: string) => (key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? versionedConfig(5, 2) : null),
      put: async () => {},
      delete: async () => {},
    };
    const gateWithKv = createMemoryEphemeralProvisionGateNamespace(configKv);
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const first = await ephemeralProvisionRoute(
      contextFor({
        env: {
          EPHEMERAL_PROVISION_DELAY_MS: "0",
          EPHEMERAL_PROVISION_CONFIG: configKv,
          EPHEMERAL_PROVISION_GATE: gateWithKv as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        },
      }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );
    expect(first.status).toBe(201);

    const gateWithoutKv = createMemoryEphemeralProvisionGateNamespace(undefined);
    const blocked = await ephemeralProvisionRoute(
      contextFor({
        env: {
          EPHEMERAL_PROVISION_DELAY_MS: "0",
          EPHEMERAL_PROVISION_GATE: gateWithoutKv as unknown as Env["EPHEMERAL_PROVISION_GATE"],
        },
      }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );

    expect(blocked.status).toBe(503);
    await expect(responseJson(blocked)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a successful provision when KV returns a same-version contradictory limit", async () => {
    let raw: string | null = versionedConfig(5, 2);
    const env = provisionEnv({
      EPHEMERAL_PROVISION_CONFIG: {
        get: async (key) => (key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? raw : null),
        put: async () => {},
        delete: async () => {},
      },
    });
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    const first = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );
    expect(first.status).toBe(201);

    raw = versionedConfig(99, 2);
    const blocked = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );

    expect(blocked.status).toBe(503);
    await expect(responseJson(blocked)).resolves.toMatchObject({
      error: { code: "ephemeral_provision_unavailable" },
    });
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(1);
  });

  it("fails closed when runtime cap config cannot be read", async () => {
    const body = validProvisionBody();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());
    const response = await ephemeralProvisionRoute(
      contextFor({
        env: provisionEnv({
          EPHEMERAL_PROVISION_CONFIG: {
            get: async () => Promise.reject(new Error("kv offline")),
            put: async () => {},
            delete: async () => {},
          },
        }),
      }),
      { createEphemeralWorkspace } as never,
      guardFor(body),
    );

    expect(response.status).toBe(503);
    expect(createEphemeralWorkspace).not.toHaveBeenCalled();
  });

  it("honors a lowered runtime cap from KV", async () => {
    const loweredLimit = 2;
    const env = provisionEnv({
      EPHEMERAL_PROVISION_CONFIG: {
        get: async (key) => (key === EPHEMERAL_PROVISION_CONFIG_KV_KEY ? versionedConfig(loweredLimit, 1) : null),
        put: async () => {},
        delete: async () => {},
      },
    });
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    for (let index = 0; index < loweredLimit; index += 1) {
      const response = await ephemeralProvisionRoute(
        contextFor({ env }),
        { createEphemeralWorkspace } as never,
        guardFor(validProvisionBody()),
      );
      expect(response.status).toBe(201);
    }

    const limited = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
    );
    expect(limited.status).toBe(429);
    expect(createEphemeralWorkspace).toHaveBeenCalledTimes(loweredLimit);
  });

  it("returns rate_limited after the Durable Object global cap is exhausted", async () => {
    const env = provisionEnv();
    const createEphemeralWorkspace = vi.fn(async () => ephemeralWorkspaceFixture());

    for (let index = 0; index < EPHEMERAL_PROVISION_LIMIT_PER_MINUTE; index += 1) {
      const response = await ephemeralProvisionRoute(
        contextFor({ env }),
        { createEphemeralWorkspace } as never,
        guardFor(validProvisionBody()),
      );
      expect(response.status).toBe(201);
    }

    const limited = await ephemeralProvisionRoute(
      contextFor({ env }),
      { createEphemeralWorkspace } as never,
      guardFor(validProvisionBody()),
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
  const env: Env = {
    EPHEMERAL_PROVISION_DELAY_MS: "0",
    ...overrides,
  };
  if (!overrides.EPHEMERAL_PROVISION_GATE) {
    env.EPHEMERAL_PROVISION_GATE = createMemoryEphemeralProvisionGateNamespace(
      env.EPHEMERAL_PROVISION_CONFIG,
    ) as unknown as Env["EPHEMERAL_PROVISION_GATE"];
  }
  return env;
}

function versionedConfig(limitPerMinute: number, configVersion: number): string {
  return JSON.stringify({ limit_per_minute: limitPerMinute, config_version: configVersion });
}

function validProvisionBody() {
  return {};
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
