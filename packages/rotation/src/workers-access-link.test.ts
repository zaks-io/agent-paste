import { describe, expect, it } from "vitest";
import { accessLinkSigningRingFromEnv } from "./workers.js";

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
});
