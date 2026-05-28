import { mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { mintAgentViewToken } from "@agent-paste/tokens/agent-view";
import { mintContentToken } from "@agent-paste/tokens/content";
import { mintUploadToken } from "@agent-paste/tokens/upload-url";
import { describe, expect, it } from "vitest";
import { KeyRing } from "./key-ring.js";
import {
  verifyAccessLinkBlobWithKeyRing,
  verifyAgentViewTokenWithKeyRing,
  verifyContentTokenWithKeyRing,
  verifyUploadTokenWithKeyRing,
} from "./signing.js";

describe("signing key overlap verification", () => {
  it("verifies tokens minted with the old key during overlap, then fails after drop", async () => {
    const ring = KeyRing.single("content-v1", 1);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = {
      artifact_id: "art_test",
      revision_id: "rev_test",
      exp,
    };
    const legacyToken = await mintContentToken(payload, "content-v1");

    expect(await verifyContentTokenWithKeyRing(legacyToken, ring)).not.toBeNull();

    ring.stageVerifyKey(2, "content-v2");
    expect(await verifyContentTokenWithKeyRing(legacyToken, ring)).not.toBeNull();

    ring.promoteSigningKid(2);
    const newToken = await mintContentToken(payload, ring.signingSecret());
    expect(await verifyContentTokenWithKeyRing(newToken, ring)).not.toBeNull();
    expect(await verifyContentTokenWithKeyRing(legacyToken, ring)).not.toBeNull();

    ring.dropKid(1);
    expect(await verifyContentTokenWithKeyRing(newToken, ring)).not.toBeNull();
    expect(await verifyContentTokenWithKeyRing(legacyToken, ring)).toBeNull();
  });

  it("verifies agent-view tokens across content signing key overlap", async () => {
    const ring = KeyRing.single("agent-v1", 1);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = { artifact_id: "art_test", revision_id: "rev_test", exp };
    const legacyToken = await mintAgentViewToken(payload, "agent-v1");

    ring.stageVerifyKey(2, "agent-v2");
    ring.promoteSigningKid(2);
    expect(await verifyAgentViewTokenWithKeyRing(legacyToken, ring)).not.toBeNull();

    ring.dropKid(1);
    expect(await verifyAgentViewTokenWithKeyRing(legacyToken, ring)).toBeNull();
  });

  it("verifies access link blobs across signing key overlap", async () => {
    const ring = KeyRing.single("access-link-v1", 1);
    const exp = Date.now() + 60_000;
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp,
      scopes: 1,
      signingSecret: "access-link-v1",
    });

    ring.stageVerifyKey(2, "access-link-v2");
    ring.promoteSigningKid(2);
    expect(
      await verifyAccessLinkBlobWithKeyRing({ publicId: "0123456789ABCDEF", blob }, ring, {
        now: () => exp - 1,
      }),
    ).not.toBeNull();

    ring.dropKid(1);
    expect(
      await verifyAccessLinkBlobWithKeyRing({ publicId: "0123456789ABCDEF", blob }, ring, {
        now: () => exp - 1,
      }),
    ).toBeNull();
  });

  it("returns null when no kid in the ring verifies the blob", async () => {
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 1,
      signingSecret: "other-secret",
    });
    const ring = KeyRing.single("unused", 9);
    expect(await verifyAccessLinkBlobWithKeyRing({ publicId: "0123456789ABCDEF", blob }, ring)).toBeNull();
  });

  it("verifies upload tokens across upload signing key overlap", async () => {
    const ring = KeyRing.single("upload-v1", 1);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = {
      sid: "usess_test",
      wid: "00000000-0000-4000-8000-000000000001",
      path: "a.txt",
      key: "k",
      size: 1,
      exp,
    };
    const legacyToken = await mintUploadToken(payload, "upload-v1");

    ring.stageVerifyKey(2, "upload-v2");
    ring.promoteSigningKid(2);
    expect(await verifyUploadTokenWithKeyRing(legacyToken, ring)).not.toBeNull();

    ring.dropKid(1);
    expect(await verifyUploadTokenWithKeyRing(legacyToken, ring)).toBeNull();
  });
});
