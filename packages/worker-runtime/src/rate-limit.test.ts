import { describe, expect, it } from "vitest";
import { applyEphemeralProvisionRateLimit } from "./rate-limit.js";

describe("applyEphemeralProvisionRateLimit", () => {
  it("returns unavailable when the global circuit breaker trips", async () => {
    const result = await applyEphemeralProvisionRateLimit(
      {
        ephemeralProvisionGlobal: {
          limit: async () => ({ success: false }),
        },
        ephemeralProvisionIp: {
          limit: async () => ({ success: true }),
        },
      },
      "203.0.113.10",
    );
    expect(result).toEqual({
      ok: false,
      code: "ephemeral_provision_unavailable",
      retryAfter: "3600",
    });
  });

  it("returns rate limited when the per-ip binding trips", async () => {
    const result = await applyEphemeralProvisionRateLimit(
      {
        ephemeralProvisionGlobal: {
          limit: async () => ({ success: true }),
        },
        ephemeralProvisionIp: {
          limit: async () => ({ success: false }),
        },
      },
      "203.0.113.10",
    );
    expect(result).toEqual({
      ok: false,
      code: "ephemeral_provision_rate_limited",
      retryAfter: "3600",
    });
  });
});
