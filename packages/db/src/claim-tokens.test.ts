import { describe, expect, it } from "vitest";
import { generateClaimToken, parseClaimToken, verifyClaimTokenSecret } from "./claim-tokens.js";

describe("claim tokens", () => {
  it("mints ap_ct bearer secrets and verifies the stored hash", async () => {
    const pepper = "test-pepper";
    const generated = await generateClaimToken("preview", pepper);
    expect(generated.secret).toMatch(/^ap_ct_preview_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]{32,}$/);
    expect(parseClaimToken(generated.secret)?.publicId).toBe(generated.publicId);
    await expect(verifyClaimTokenSecret(generated.secret, generated.tokenHash, pepper)).resolves.toBe(true);
    await expect(verifyClaimTokenSecret(`${generated.secret}x`, generated.tokenHash, pepper)).resolves.toBe(false);
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
