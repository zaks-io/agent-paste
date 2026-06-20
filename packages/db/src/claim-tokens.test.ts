import { hmac } from "@agent-paste/tokens/crypto";
import { describe, expect, it } from "vitest";
import { digestToBytes, generateClaimToken, parseClaimToken, verifyClaimTokenSecret } from "./claim-tokens.js";

describe("claim tokens", () => {
  const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";

  it("mints ap_ct bearer secrets and verifies the stored hash", async () => {
    const pepper = "test-pepper";
    const generated = await generateClaimToken("preview", pepper);
    expect(generated.secret).toMatch(/^ap_ct_preview_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]{32,}$/);
    expect(parseClaimToken(generated.secret)?.publicId).toBe(generated.publicId);
    await expect(verifyClaimTokenSecret(generated.secret, generated.tokenHash, pepper)).resolves.toBe(true);
    await expect(verifyClaimTokenSecret(`${generated.secret}x`, generated.tokenHash, pepper)).resolves.toBe(false);
  });

  it("embeds claim code attribution in the bearer and binds it to verification", async () => {
    const pepper = "test-pepper";
    const generated = await generateClaimToken("preview", pepper, claimCode);
    const forged = generated.secret.replace(claimCode, "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCE");
    expect(generated.secret).toMatch(
      /^ap_ct_preview_[0-9A-HJKMNP-TV-Z]{16}\.clm_[0-9A-HJKMNP-TV-Z]{26}_[A-Za-z0-9_-]{32,}$/,
    );
    expect(parseClaimToken(generated.secret)).toMatchObject({
      publicId: generated.publicId,
      claimCode,
    });
    await expect(verifyClaimTokenSecret(generated.secret, generated.tokenHash, pepper)).resolves.toBe(true);
    await expect(verifyClaimTokenSecret(forged, generated.tokenHash, pepper)).resolves.toBe(false);
    await expect(
      verifyClaimTokenSecret(generated.secret.replace(`.${claimCode}`, ""), generated.tokenHash, pepper),
    ).resolves.toBe(false);
  });

  it("accepts legacy hashes only when no claim code is embedded", async () => {
    const pepper = "test-pepper";
    const legacySecretSegment = "abcdefghijklmnopqrstuvwxyz012345";
    const legacySecret = `ap_ct_preview_0123456789ABCDEF_${legacySecretSegment}`;
    const legacyHash = digestToBytes(await hmac(legacySecretSegment, pepper));
    const forged = `ap_ct_preview_0123456789ABCDEF.${claimCode}_${legacySecretSegment}`;

    await expect(verifyClaimTokenSecret(legacySecret, legacyHash, pepper)).resolves.toBe(true);
    expect(parseClaimToken(forged)?.claimCode).toBe(claimCode);
    await expect(verifyClaimTokenSecret(forged, legacyHash, pepper)).resolves.toBe(false);
  });

  it("rejects malformed bearers and wrong peppers", async () => {
    const pepper = "test-pepper";
    const generated = await generateClaimToken("production", pepper);
    expect(parseClaimToken("ap_pk_preview_ABCDEFGHJKLMNP12_secret")).toBeNull();
    expect(parseClaimToken("ap_ct_live_ABCDEFGHJKLMNP12_secret")).toBeNull();
    expect(parseClaimToken("ap_ct_preview_ABCDEFGHJKLMNP12")).toBeNull();
    await expect(verifyClaimTokenSecret("ap_ct_not-a-token", generated.tokenHash, pepper)).resolves.toBe(false);
    await expect(verifyClaimTokenSecret(generated.secret, generated.tokenHash, "other-pepper")).resolves.toBe(false);
    await expect(verifyClaimTokenSecret(generated.secret, new Uint8Array([0]), pepper)).resolves.toBe(false);
  });
});
