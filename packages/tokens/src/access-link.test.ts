import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_PAYLOAD_BYTE_LENGTH,
  ACCESS_LINK_SCOPE,
  accessLinkBlobLooksValid,
  buildAccessLinkUrl,
  defaultAccessLinkScopesBitmask,
  mintAccessLinkBlob,
  verifyAccessLinkBlob,
} from "./access-link.js";
import { base64UrlDecode, base64UrlEncode } from "./crypto.js";

const SECRET_V1 = "access-link-secret-v1";
const PUBLIC_ID = "0123456789ABCDEF";

describe("access link signed blob codec", () => {
  it("mints a 44-byte payload and verifies it", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });
    expect(accessLinkBlobLooksValid(blob)).toBe(true);
    expect(base64UrlDecode(blob).length).toBe(ACCESS_LINK_PAYLOAD_BYTE_LENGTH);

    const payload = await verifyAccessLinkBlob({
      publicId: PUBLIC_ID,
      blob,
      signingSecret: SECRET_V1,
      clock: { now: () => exp - 1 },
    });
    expect(payload).toMatchObject({ kid: 1, scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT, publicId: PUBLIC_ID });
  });

  it("re-mint produces a different blob when exp advances", async () => {
    const rowExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const first = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp: Math.min(rowExpiresAt, Date.now() + 24 * 60 * 60 * 1000),
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp: Math.min(rowExpiresAt, Date.now() + 24 * 60 * 60 * 1000),
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });
    expect(second).not.toBe(first);
  });

  it("returns null for tampered blobs, wrong secrets, bad versions, and expired urls", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });
    const tamperedBytes = base64UrlDecode(blob);
    tamperedBytes[0] ^= 0xff;
    const tampered = base64UrlEncode(tamperedBytes);

    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: tampered,
        signingSecret: SECRET_V1,
        clock: { now: () => exp - 1 },
      }),
    ).toBeNull();
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob,
        signingSecret: "wrong-secret",
        clock: { now: () => exp - 1 },
      }),
    ).toBeNull();
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob,
        signingSecret: SECRET_V1,
        clock: { now: () => exp + 1 },
      }),
    ).toBeNull();
  });

  it("rejects verification when the path public id does not match the signed id", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });
    expect(
      await verifyAccessLinkBlob({
        publicId: "AAAAAAAAAAAAAAAA",
        blob,
        signingSecret: SECRET_V1,
        clock: { now: () => exp - 1 },
      }),
    ).toBeNull();
  });

  it("throws when mint inputs are invalid", async () => {
    await expect(
      mintAccessLinkBlob({
        publicId: "not-valid",
        kid: 1,
        exp: Date.now() + 1000,
        scopes: 1,
        signingSecret: SECRET_V1,
      }),
    ).rejects.toThrow("access_link_invalid_public_id");
    await expect(
      mintAccessLinkBlob({
        publicId: PUBLIC_ID,
        kid: 0,
        exp: Date.now() + 1000,
        scopes: 1,
        signingSecret: SECRET_V1,
      }),
    ).rejects.toThrow("access_link_invalid_kid");
    await expect(
      mintAccessLinkBlob({
        publicId: PUBLIC_ID,
        kid: 1,
        exp: -1,
        scopes: 1,
        signingSecret: SECRET_V1,
      }),
    ).rejects.toThrow("access_link_invalid_exp");
  });

  it("rejects blobs with unsupported payload versions", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });
    const bytes = base64UrlDecode(blob);
    bytes[0] = 2;
    const reencoded = base64UrlEncode(bytes);
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: reencoded,
        signingSecret: SECRET_V1,
        clock: { now: () => exp - 1 },
      }),
    ).toBeNull();
  });

  it("rejects malformed blobs before signature verification", async () => {
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: "tooshort",
        signingSecret: SECRET_V1,
      }),
    ).toBeNull();
    expect(accessLinkBlobLooksValid("tooshort")).toBe(false);
  });

  it("builds viewer URLs without putting the blob in the path or query", () => {
    const url = buildAccessLinkUrl({
      appBaseUrl: "https://app.agent-paste.sh/",
      publicId: PUBLIC_ID,
      blob: "payload",
    });
    expect(url).toBe(`https://app.agent-paste.sh/al/${PUBLIC_ID}#payload`);
  });

  it("rejects additional mint validation failures and invalid payload shapes", async () => {
    await expect(
      mintAccessLinkBlob({
        publicId: PUBLIC_ID,
        kid: 256,
        exp: Date.now() + 1000,
        scopes: 1,
        signingSecret: SECRET_V1,
      }),
    ).rejects.toThrow("access_link_invalid_kid");
    await expect(
      mintAccessLinkBlob({
        publicId: PUBLIC_ID,
        kid: 1,
        exp: Date.now() + 1000,
        scopes: 70_000,
        signingSecret: SECRET_V1,
      }),
    ).rejects.toThrow("access_link_invalid_scopes");

    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: ACCESS_LINK_SCOPE.VIEW_ARTIFACT,
      signingSecret: SECRET_V1,
    });

    const kidZeroBytes = base64UrlDecode(blob);
    kidZeroBytes[1] = 0;
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: base64UrlEncode(kidZeroBytes),
        signingSecret: SECRET_V1,
        clock: { now: () => exp - 1 },
      }),
    ).toBeNull();

    const shortBytes = base64UrlDecode(blob);
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: base64UrlEncode(shortBytes.slice(0, 20)),
        signingSecret: SECRET_V1,
      }),
    ).toBeNull();
    expect(accessLinkBlobLooksValid("%%%")).toBe(false);

    const corruptBytes = base64UrlDecode(blob);
    corruptBytes.set(expectedSignatureCorrupt(corruptBytes), 12);
    expect(
      await verifyAccessLinkBlob({
        publicId: PUBLIC_ID,
        blob: base64UrlEncode(corruptBytes),
        signingSecret: SECRET_V1,
        clock: { now: () => exp - 1 },
      }),
    ).toBeNull();
  });

  it("verifies without an injected clock and exposes default scopes", async () => {
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: PUBLIC_ID,
      kid: 1,
      exp,
      scopes: defaultAccessLinkScopesBitmask(),
      signingSecret: SECRET_V1,
    });
    expect(await verifyAccessLinkBlob({ publicId: PUBLIC_ID, blob, signingSecret: SECRET_V1 })).toMatchObject({
      scopes: defaultAccessLinkScopesBitmask(),
    });
  });
});

function expectedSignatureCorrupt(bytes: Uint8Array): Uint8Array {
  const corrupt = new Uint8Array(bytes.slice(12));
  corrupt[0] = (corrupt[0] ?? 0) ^ 0xff;
  return corrupt;
}
