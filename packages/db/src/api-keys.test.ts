import { describe, expect, it } from "vitest";
import { generateApiKey, parseApiKey, verifyApiKeySecret } from "./api-keys";

describe("api keys", () => {
  const pepper = "local-pepper";

  it("generates API keys that verify with an HMAC pepper", async () => {
    const generated = await generateApiKey("preview", pepper);

    expect(generated.secret).toMatch(/^ap_pk_preview_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]+$/u);
    expect(generated.secretHmac).not.toContain(generated.secret);
    expect(await verifyApiKeySecret(generated.secret, generated.publicId, generated.secretHmac, pepper)).toBe(true);
  });

  it("rejects wrong API key material", async () => {
    const generated = await generateApiKey("preview", pepper);

    expect(await verifyApiKeySecret(`${generated.secret}x`, generated.publicId, generated.secretHmac, pepper)).toBe(
      false,
    );
    expect(await verifyApiKeySecret(generated.secret, generated.publicId, generated.secretHmac, "wrong")).toBe(false);
  });

  it("parses the production bearer format", async () => {
    const generated = await generateApiKey("production", pepper);
    expect(parseApiKey(generated.secret)).toMatchObject({ publicId: generated.publicId });
  });

  it("rejects the retired `live` env segment", () => {
    expect(parseApiKey("ap_pk_live_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF")).toBeNull();
  });
});
