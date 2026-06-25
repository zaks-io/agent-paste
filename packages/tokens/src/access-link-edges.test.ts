import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_PAYLOAD_VERSION,
  ACCESS_LINK_SCOPE,
  mintAccessLinkBlob,
  verifyAccessLinkBlob,
} from "./access-link.js";
import { decodeCrockfordPublicId } from "./crockford.js";
import { base64UrlEncode } from "./crypto.js";

const SECRET = "access-link-secret-v1";
const PUBLIC_ID = "0123456789ABCDEF";

async function hmacSha256Bytes(message: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
}

async function signedBlob(input: { version: number; kid: number; exp: number; scopes: number }): Promise<string> {
  const publicIdBytes = decodeCrockfordPublicId(PUBLIC_ID);
  if (!publicIdBytes) {
    throw new Error("bad public id fixture");
  }
  const signatureInput = new Uint8Array(12 + publicIdBytes.length);
  signatureInput[0] = input.version;
  signatureInput[1] = input.kid;
  const view = new DataView(signatureInput.buffer);
  view.setBigUint64(2, BigInt(input.exp), false);
  view.setUint16(10, input.scopes, false);
  signatureInput.set(publicIdBytes, 12);

  const payload = new Uint8Array(44);
  payload.set(signatureInput.subarray(0, 12), 0);
  payload.set(await hmacSha256Bytes(signatureInput, SECRET), 12);
  return base64UrlEncode(payload);
}

describe("access link signed blob codec edges", () => {
  it("mints and verifies boundary kid and scope values", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 255,
      exp,
      scopes: 0xffff,
      signingSecret: SECRET,
    });
    await expect(
      verifyAccessLinkBlob({ publicId: PUBLIC_ID, blob, signingSecret: SECRET, clock: { now: () => exp - 1 } }),
    ).resolves.toMatchObject({ kid: 255, scopes: 0xffff });

    await expect(
      mintAccessLinkBlob({
        publicId: PUBLIC_ID,
        kid: 1,
        exp,
        scopes: 0,
        signingSecret: SECRET,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it("allows exp zero at mint validation", async () => {
    await expect(
      mintAccessLinkBlob({
        publicId: PUBLIC_ID,
        kid: 1,
        exp: 0,
        scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
        signingSecret: SECRET,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it("rejects negative and fractional scopes at mint validation", async () => {
    const base = {
      publicId: PUBLIC_ID,
      kid: 1,
      exp: Date.now() + 60_000,
      signingSecret: SECRET,
    };
    await expect(mintAccessLinkBlob({ ...base, scopes: -1 })).rejects.toThrow("access_link_invalid_scopes");
    await expect(mintAccessLinkBlob({ ...base, scopes: 1.5 })).rejects.toThrow("access_link_invalid_scopes");
  });

  it("rejects signed payloads with unsupported version or kid", async () => {
    const exp = Date.now() + 60_000;
    await expect(
      verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: await signedBlob({ version: ACCESS_LINK_PAYLOAD_VERSION + 1, kid: 1, exp, scopes: 1 }),
        signingSecret: SECRET,
        clock: { now: () => exp - 1 },
      }),
    ).resolves.toBeNull();
    await expect(
      verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: await signedBlob({ version: ACCESS_LINK_PAYLOAD_VERSION, kid: 0, exp, scopes: 1 }),
        signingSecret: SECRET,
        clock: { now: () => exp - 1 },
      }),
    ).resolves.toBeNull();
  });

  it("rejects a signed payload exactly at the expiration instant", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET,
    });
    await expect(
      verifyAccessLinkBlob({ publicId: PUBLIC_ID, blob, signingSecret: SECRET, clock: { now: () => exp } }),
    ).resolves.toBeNull();
  });
});
