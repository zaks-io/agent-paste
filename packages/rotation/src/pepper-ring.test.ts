import { constantTimeEqual, hmac } from "@agent-paste/tokens/crypto";
import { describe, expect, it } from "vitest";
import { PepperRing } from "./pepper-ring.js";
import { describePepperRingState } from "./playbook.js";

describe("PepperRing", () => {
  it("follows stage, promote, and drop with explicit overlap kids", () => {
    const ring = PepperRing.single("pepper-v1", 1);
    expect(ring.currentKid).toBe(1);
    expect(describePepperRingState(ring).stage).toBe("drained");

    ring.stageVerifyPepper(2, "pepper-v2");
    expect(ring.verifyKids).toEqual([1, 2]);
    expect(ring.currentKid).toBe(1);
    expect(describePepperRingState(ring).stage).toBe("verify-old");

    ring.promoteSigningPepper(2);
    expect(ring.currentPepper()).toBe("pepper-v2");
    expect(describePepperRingState(ring).stage).toBe("sign-new");

    ring.dropPepper(1);
    expect(ring.verifyKids).toEqual([2]);
    expect(ring.pepperForKid(1)).toBeUndefined();
  });

  it("loads V1 and optional V2 from Worker env shape", () => {
    const ring = PepperRing.fromEnv({
      API_KEY_PEPPER_V1: "one",
      API_KEY_PEPPER_V2: "two",
      API_KEY_PEPPER_CURRENT_KID: "v2",
    });
    expect(ring.currentPepper()).toBe("two");
    expect(ring.verifyKids).toEqual([1, 2]);
  });

  it("requires V1 unless secondary is already the active kid", () => {
    expect(() =>
      PepperRing.fromEnv({
        API_KEY_PEPPER_V2: "two",
        API_KEY_PEPPER_CURRENT_KID: "v1",
      }),
    ).toThrow("pepper_ring_missing_env:API_KEY_PEPPER_V1");
  });

  it("verifies admin token hash against any active pepper during overlap", async () => {
    const ring = PepperRing.single("pepper-v1", 1);
    const adminToken = "ap_admin_testtoken";
    const hashV1 = await hmac(adminToken, "pepper-v1");

    const matchesDuringOverlap = async () => {
      for (const kid of ring.verifyKids) {
        const pepper = ring.pepperForKid(kid);
        if (pepper && (await constantTimeEqual(await hmac(adminToken, pepper), hashV1))) {
          return true;
        }
      }
      return false;
    };

    expect(await matchesDuringOverlap()).toBe(true);

    ring.stageVerifyPepper(2, "pepper-v2");
    ring.promoteSigningPepper(2);
    expect(await matchesDuringOverlap()).toBe(true);

    ring.dropPepper(1);
    expect(await matchesDuringOverlap()).toBe(false);
  });
});
