import { describe, expect, it } from "vitest";
import {
  consumePowNonce,
  countLeadingZeroBits,
  DEFAULT_POW_CHALLENGE_TTL_SECONDS,
  DEFAULT_POW_DIFFICULTY_BITS,
  issuePowChallenge,
  solvePowChallenge,
  verifyPowSolution,
} from "./pow.js";

describe("pow", () => {
  const secret = "test-pow-secret";

  it("issues and verifies a hashcash-style solution", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const challenge = await issuePowChallenge({ secret, difficulty: 12, now });
    expect(challenge.difficulty).toBe(12);
    expect(challenge.expires_at).toBe("2026-06-01T12:05:00.000Z");

    const counter = await solvePowChallenge(challenge);
    const valid = await verifyPowSolution({
      secret,
      challenge,
      solution: { nonce: challenge.nonce, counter },
      now,
    });
    expect(valid).toBe(true);
  });

  it("rejects tampered signatures and expired challenges", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const challenge = await issuePowChallenge({ secret, difficulty: 8, now });
    const counter = await solvePowChallenge(challenge);

    await expect(
      verifyPowSolution({
        secret,
        challenge: { ...challenge, signature: `${challenge.signature}x` },
        solution: { nonce: challenge.nonce, counter },
        now,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyPowSolution({
        secret,
        challenge,
        solution: { nonce: challenge.nonce, counter },
        now: new Date("2026-06-01T12:06:00.000Z"),
      }),
    ).resolves.toBe(false);
  });

  it("tracks single-use nonces in a store", async () => {
    const store = new Map<string, string>();
    const nonceStore = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    await expect(consumePowNonce(nonceStore, "nonce-a", DEFAULT_POW_CHALLENGE_TTL_SECONDS)).resolves.toBe(true);
    await expect(consumePowNonce(nonceStore, "nonce-a", DEFAULT_POW_CHALLENGE_TTL_SECONDS)).resolves.toBe(false);
    await expect(consumePowNonce(nonceStore, "nonce-b", DEFAULT_POW_CHALLENGE_TTL_SECONDS)).resolves.toBe(true);
  });

  it("counts leading zero bits across byte boundaries", () => {
    expect(countLeadingZeroBits(new Uint8Array([0, 0, 0x0f]))).toBe(20);
    expect(countLeadingZeroBits(new Uint8Array([0x80]))).toBe(0);
  });

  it("uses documented defaults", async () => {
    const challenge = await issuePowChallenge({ secret });
    expect(challenge.difficulty).toBe(DEFAULT_POW_DIFFICULTY_BITS);
    const ttlMs = Date.parse(challenge.expires_at) - Date.now();
    expect(ttlMs).toBeGreaterThan((DEFAULT_POW_CHALLENGE_TTL_SECONDS - 2) * 1000);
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_POW_CHALLENGE_TTL_SECONDS * 1000);
  });
});
