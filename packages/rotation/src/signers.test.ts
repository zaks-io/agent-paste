import { mintAgentViewToken } from "@agent-paste/tokens/agent-view";
import { mintContentToken } from "@agent-paste/tokens/content";
import { describe, expect, it } from "vitest";
import {
  resolveAccessLinkSigner,
  resolveAgentViewTokenSigner,
  resolveContentTokenSigner,
  resolveUploadTokenSigner,
} from "./signers.js";

const PUBLIC_ID = "0123456789ABCDEF";

function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("expected a resolved signer");
  }
  return value;
}

function expectRedactedSignerError(
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
  throw new Error("expected signer resolution to fail");
}

const contentPayload = { artifact_id: "art_1", revision_id: "rev_1", exp: 4_102_444_800 };
const uploadPayload = {
  sid: "us_1",
  wid: "ws_1",
  path: "index.html",
  key: "artifacts/art_1/revisions/rev_1/files/index.html",
  size: 12,
  exp: 4_102_444_800,
};

describe("resolveContentTokenSigner", () => {
  it("round-trips a token signed by the ring's active kid and exposes the signing secret", async () => {
    const signer = defined(resolveContentTokenSigner({ CONTENT_SIGNING_SECRET: "c1" }));
    expect(signer.signingSecret).toBe("c1");
    const token = await signer.sign(contentPayload);
    expect(await signer.verify(token)).toMatchObject(contentPayload);
  });

  it("verifies a token minted under the prior kid after the signing kid is promoted", async () => {
    const minted = await mintContentToken(contentPayload, "c1");
    const rotated = defined(
      resolveContentTokenSigner({
        CONTENT_SIGNING_SECRET: "c1",
        CONTENT_SIGNING_SECRET_V2: "c2",
        CONTENT_SIGNING_KID: "v2",
      }),
    );
    expect(await rotated.verify(minted)).toMatchObject(contentPayload);
  });

  it("returns undefined when no content signing secret is configured", () => {
    expect(resolveContentTokenSigner({})).toBeUndefined();
  });

  it("fails loudly when active content signing kid is V2 but the V2 secret is absent", () => {
    expectRedactedSignerError(
      () =>
        resolveContentTokenSigner({
          CONTENT_SIGNING_SECRET: "content-v1",
          CONTENT_SIGNING_KID: "v2",
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["content-v1"],
    );
  });

  it("ignores AGENT_VIEW_SIGNING_SECRET so content URLs verify under the content worker's secret", async () => {
    // Regression: content URLs must be signed with content material, not the agent-view
    // override, because the content worker verifies with the content ring only.
    const env = { AGENT_VIEW_SIGNING_SECRET: "av", CONTENT_SIGNING_SECRET: "c1" };
    const content = defined(resolveContentTokenSigner(env));
    expect(content.signingSecret).toBe("c1");
    const token = await content.sign(contentPayload);
    expect(await content.verify(token)).toMatchObject(contentPayload);
    // The agent-view signer (which honors the override) must NOT accept the content token.
    expect(await defined(resolveAgentViewTokenSigner(env)).verify(token)).toBeNull();
  });
});

describe("resolveAgentViewTokenSigner", () => {
  it("shares the content ring by default", async () => {
    const signer = defined(resolveAgentViewTokenSigner({ CONTENT_SIGNING_SECRET: "c1" }));
    const token = await signer.sign(contentPayload);
    expect(await signer.verify(token)).toMatchObject(contentPayload);
  });

  it("prefers the agent-view override over the content ring for both mint and verify", async () => {
    const signer = defined(
      resolveAgentViewTokenSigner({
        AGENT_VIEW_SIGNING_SECRET: "av",
        CONTENT_SIGNING_SECRET: "c1",
      }),
    );
    const token = await signer.sign(contentPayload);
    expect(await signer.verify(token)).toMatchObject(contentPayload);
    // A token minted with the content secret must NOT verify under the override.
    const underContent = await mintAgentViewToken(contentPayload, "c1");
    expect(await signer.verify(underContent)).toBeNull();
  });

  it("returns undefined when neither override nor content secret is set", () => {
    expect(resolveAgentViewTokenSigner({})).toBeUndefined();
  });
});

describe("resolveUploadTokenSigner", () => {
  it("round-trips an upload token", async () => {
    const signer = defined(resolveUploadTokenSigner({ UPLOAD_SIGNING_SECRET: "u1" }));
    const token = await signer.sign(uploadPayload);
    expect(await signer.verify(token)).toMatchObject(uploadPayload);
  });

  it("returns undefined when the upload secret is absent", () => {
    expect(resolveUploadTokenSigner({})).toBeUndefined();
  });

  it("fails loudly when active upload signing kid is V2 but the V2 secret is absent", () => {
    expectRedactedSignerError(
      () =>
        resolveUploadTokenSigner({
          UPLOAD_SIGNING_SECRET: "upload-v1",
          UPLOAD_SIGNING_KID: "v2",
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["upload-v1"],
    );
  });
});

describe("resolveAccessLinkSigner", () => {
  it("round-trips a blob using the ring's signing kid", async () => {
    const signer = defined(resolveAccessLinkSigner({ ACCESS_LINK_SIGNING_KEY_V1: "al1" }));
    const kid = signer.signingKid;
    const exp = Date.now() + 60_000;
    const blob = await signer.sign({ publicId: PUBLIC_ID, kid, exp, scopes: 1 });
    expect(await signer.verify({ publicId: PUBLIC_ID, blob })).toMatchObject({ kid, scopes: 1 });
  });

  it("verifies a blob minted under kid 1 after promoting to kid 2", async () => {
    const minted = defined(resolveAccessLinkSigner({ ACCESS_LINK_SIGNING_KEY_V1: "al1" }));
    const blob = await minted.sign({ publicId: PUBLIC_ID, kid: 1, exp: Date.now() + 60_000, scopes: 1 });
    const rotated = defined(
      resolveAccessLinkSigner({
        ACCESS_LINK_SIGNING_KEY_V1: "al1",
        ACCESS_LINK_SIGNING_KEY_V2: "al2",
        ACCESS_LINK_SIGNING_KID: "v2",
      }),
    );
    expect(rotated.signingKid).toBe(2);
    expect(await rotated.verify({ publicId: PUBLIC_ID, blob })).toMatchObject({ kid: 1 });
  });

  it("returns undefined when no access-link signing key is set", () => {
    expect(resolveAccessLinkSigner({})).toBeUndefined();
  });

  it("fails loudly when active access-link signing kid is V2 but the V2 secret is absent", () => {
    expectRedactedSignerError(
      () =>
        resolveAccessLinkSigner({
          ACCESS_LINK_SIGNING_KEY_V1: "access-link-v1",
          ACCESS_LINK_SIGNING_KID: "v2",
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["access-link-v1"],
    );
  });
});
