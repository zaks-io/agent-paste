import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_PAYLOAD_BYTE_LENGTH,
  ACCESS_LINK_SCOPE,
  accessLinkBlobLooksValid,
  buildAccessLinkUrl,
  mintAccessLinkBlob,
  verifyAccessLinkBlob,
} from "./access-link.js";
import { base64UrlDecode } from "./crypto.js";

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
    const tampered = `${blob.slice(0, -1)}x`;

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

  it("builds viewer URLs without putting the blob in the path or query", () => {
    const url = buildAccessLinkUrl({
      appBaseUrl: "https://app.agent-paste.sh",
      publicId: PUBLIC_ID,
      blob: "payload",
    });
    expect(url).toBe(`https://app.agent-paste.sh/al/${PUBLIC_ID}#payload`);
  });
});
