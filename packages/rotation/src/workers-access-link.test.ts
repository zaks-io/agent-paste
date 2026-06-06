import { describe, expect, it } from "vitest";
import { accessLinkSigningRingFromEnv } from "./workers.js";

function expectRedactedAccessLinkError(
  action: () => unknown,
  expectedMessage: string,
  secretValues: readonly string[],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe(expectedMessage);
    for (const secretValue of secretValues) {
      expect(message).not.toContain(secretValue);
    }
    return;
  }
  throw new Error("expected access-link key ring resolution to fail");
}

describe("accessLinkSigningRingFromEnv", () => {
  it("returns undefined when the primary signing key is absent", () => {
    expect(accessLinkSigningRingFromEnv({})).toBeUndefined();
  });

  it("loads only V1 when V2 is absent", () => {
    const ring = accessLinkSigningRingFromEnv({
      ACCESS_LINK_SIGNING_KEY_V1: "secret-v1",
    });
    expect(ring?.signingKid).toBe(1);
    expect(ring?.verifyKids).toEqual([1]);
  });

  it("loads V1 and optional V2 overlap keys", () => {
    const ring = accessLinkSigningRingFromEnv({
      ACCESS_LINK_SIGNING_KEY_V1: "secret-v1",
      ACCESS_LINK_SIGNING_KEY_V2: "secret-v2",
      ACCESS_LINK_SIGNING_KID: "v2",
    });
    expect(ring?.signingKid).toBe(2);
    expect(ring?.verifyKids).toEqual([1, 2]);
  });

  it("fails loudly when active signing kid is V2 but the V2 secret is absent", () => {
    expectRedactedAccessLinkError(
      () =>
        accessLinkSigningRingFromEnv({
          ACCESS_LINK_SIGNING_KEY_V1: "access-link-v1",
          ACCESS_LINK_SIGNING_KID: "v2",
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["access-link-v1"],
    );
  });
});
