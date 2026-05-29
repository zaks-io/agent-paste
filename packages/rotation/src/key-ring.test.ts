import { describe, expect, it } from "vitest";
import { createKeyRingFromVersionedEnv, KeyRing } from "./key-ring.js";
import { describeKeyRingState } from "./playbook.js";

describe("KeyRing rotation playbook", () => {
  it("stages verify-only, promotes signing, then drops the old kid", () => {
    const ring = KeyRing.single("secret-v1", 1);
    expect(describeKeyRingState(ring).stage).toBe("drained");

    ring.stageVerifyKey(2, "secret-v2");
    expect(ring.verifyKids).toEqual([1, 2]);
    expect(ring.signingKid).toBe(1);
    expect(describeKeyRingState(ring).stage).toBe("verify-old");

    ring.promoteSigningKid(2);
    expect(ring.signingSecret()).toBe("secret-v2");
    expect(describeKeyRingState(ring).stage).toBe("sign-new");

    ring.dropKid(1);
    expect(ring.verifyKids).toEqual([2]);
    expect(ring.secretForKid(1)).toBeUndefined();
    expect(describeKeyRingState(ring).stage).toBe("drained");
  });

  it("rejects dropping the active signing kid", () => {
    const ring = KeyRing.fromEntries(2, [
      { kid: 1, secret: "a" },
      { kid: 2, secret: "b" },
    ]);
    expect(() => ring.dropKid(2)).toThrow(/cannot_drop_active_signing/);
  });

  it("parses secondary-only env after kid-1 drop when signing kid is v2", () => {
    const ring = createKeyRingFromVersionedEnv({
      baseName: "ARTIFACT_BYTES_ENCRYPTION_KEY",
      kidVarName: "ARTIFACT_BYTES_ENCRYPTION_KID",
      env: {
        ARTIFACT_BYTES_ENCRYPTION_KEY_V2: "root-v2",
        ARTIFACT_BYTES_ENCRYPTION_KID: "v2",
      },
    });
    expect(ring.signingKid).toBe(2);
    expect(ring.verifyKids).toEqual([2]);
    expect(ring.secretForKid(2)).toBe("root-v2");
  });

  it("parses versioned Worker env bindings", () => {
    const ring = createKeyRingFromVersionedEnv({
      baseName: "CONTENT_SIGNING_SECRET",
      kidVarName: "CONTENT_SIGNING_KID",
      env: {
        CONTENT_SIGNING_SECRET: "one",
        CONTENT_SIGNING_SECRET_V2: "two",
        CONTENT_SIGNING_KID: "v2",
      },
    });
    expect(ring.signingSecret()).toBe("two");
    expect(ring.verifyKids).toEqual([1, 2]);
  });
});
