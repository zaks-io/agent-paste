import { describe, expect, it } from "vitest";
import { createKeyRingFromVersionedEnv, KeyRing } from "./key-ring.js";
import { describeKeyRingState } from "./playbook.js";

function expectRedactedKeyRingError(
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
  throw new Error("expected key ring construction to fail");
}

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

  it("fails loudly when the active signing kid is not bound", () => {
    expectRedactedKeyRingError(
      () => KeyRing.fromEntries(2, [{ kid: 1, secret: "secret-v1" }]),
      "key_ring_inconsistent_signing_kid:2",
      ["secret-v1"],
    );
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

  it("fails versioned env parsing when the active V2 secret is missing", () => {
    expectRedactedKeyRingError(
      () =>
        createKeyRingFromVersionedEnv({
          baseName: "CONTENT_SIGNING_SECRET",
          kidVarName: "CONTENT_SIGNING_KID",
          env: {
            CONTENT_SIGNING_SECRET: "content-v1",
            CONTENT_SIGNING_KID: "v2",
          },
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["content-v1"],
    );
  });
});
