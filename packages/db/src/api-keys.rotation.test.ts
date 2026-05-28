import { collapseKeyRingAfterPromotion, PepperRing } from "@agent-paste/rotation";
import { describe, expect, it } from "vitest";
import { generateApiKey, verifyApiKeySecret } from "./api-keys.js";
import { LocalRepository } from "./local-repository.js";

const adminActor = { type: "admin" as const, id: "operator" };

describe("API key pepper rotation (ADR 0045)", () => {
  it("keeps legacy keys valid through overlap and fails after drop", async () => {
    const ring = PepperRing.single("pepper-v1", 1);
    const repo = new LocalRepository({ apiKeyPepper: "pepper-v1", pepperRing: ring });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-rotation",
      email: "rotation@example.com",
      name: "Rotation",
    });

    const created = await repo.createApiKey({
      actor: adminActor,
      workspaceId: workspace.id,
      name: "legacy",
      idempotencyKey: "idem-legacy",
    });
    const legacySecret = created.secret;
    const legacyRow = Array.from(repo.apiKeys.values()).find((row) => row.id === created.api_key.id);
    expect(legacyRow?.pepper_kid).toBe(1);

    ring.stageVerifyPepper(2, "pepper-v2");
    expect(await repo.verifyApiKey(legacySecret)).not.toBeNull();

    ring.promoteSigningPepper(2);
    const rotated = await repo.createApiKey({
      actor: adminActor,
      workspaceId: workspace.id,
      name: "fresh",
      idempotencyKey: "idem-fresh",
    });
    const freshRow = Array.from(repo.apiKeys.values()).find((row) => row.id === rotated.api_key.id);
    expect(freshRow?.pepper_kid).toBe(2);
    expect(await repo.verifyApiKey(rotated.secret)).not.toBeNull();
    expect(await repo.verifyApiKey(legacySecret)).not.toBeNull();

    ring.dropPepper(1);
    expect(await repo.verifyApiKey(legacySecret)).toBeNull();
    expect(await repo.verifyApiKey(rotated.secret)).not.toBeNull();
  });

  it("fails overlap-era keys after wrangler-style promotion collapse to a single pepper", async () => {
    const ring = PepperRing.fromEnv({
      API_KEY_PEPPER_V1: "pepper-v1",
      API_KEY_PEPPER_CURRENT_KID: "v1",
    });
    const repo = new LocalRepository({ apiKeyPepper: "pepper-v1", pepperRing: ring });
    const workspace = await repo.createWorkspace({
      actor: adminActor,
      idempotencyKey: "idem-ws-promote",
      email: "promote@example.com",
      name: "Promote",
    });
    const legacy = await repo.createApiKey({
      actor: adminActor,
      workspaceId: workspace.id,
      name: "legacy",
      idempotencyKey: "idem-legacy-promote",
    });
    ring.stageVerifyPepper(2, "pepper-v2");
    ring.promoteSigningPepper(2);
    const overlapFresh = await repo.createApiKey({
      actor: adminActor,
      workspaceId: workspace.id,
      name: "overlap-fresh",
      idempotencyKey: "idem-fresh-promote",
    });
    const overlap = ring;

    const legacyRow = Array.from(repo.apiKeys.values()).find((row) => row.id === legacy.api_key.id);
    const overlapFreshRow = Array.from(repo.apiKeys.values()).find((row) => row.id === overlapFresh.api_key.id);
    expect(legacyRow?.secret_hmac).toBeDefined();
    expect(overlapFreshRow?.secret_hmac).toBeDefined();

    const collapsedRing = PepperRing.fromKeyRing(collapseKeyRingAfterPromotion(overlap.asKeyRing()));
    const promotedPepper = collapsedRing.currentPepper();

    expect(await repo.verifyApiKey(legacy.secret)).not.toBeNull();
    expect(await repo.verifyApiKey(overlapFresh.secret)).not.toBeNull();
    expect(
      await verifyApiKeySecret(legacy.secret, legacy.api_key.public_id, legacyRow?.secret_hmac ?? "", promotedPepper),
    ).toBe(false);
    expect(
      await verifyApiKeySecret(
        overlapFresh.secret,
        overlapFresh.api_key.public_id,
        overlapFreshRow?.secret_hmac ?? "",
        "pepper-v2",
      ),
    ).toBe(true);
    expect(overlapFreshRow?.pepper_kid).toBe(2);
    expect(collapsedRing.verifyKids).toEqual([1]);
  });

  it("verifyApiKeySecret fails when the wrong pepper is supplied for a row", async () => {
    const legacy = await generateApiKey("preview", "pepper-v1");
    expect(await verifyApiKeySecret(legacy.secret, legacy.publicId, legacy.secretHmac, "pepper-v1")).toBe(true);
    expect(await verifyApiKeySecret(legacy.secret, legacy.publicId, legacy.secretHmac, "pepper-v2")).toBe(false);
  });
});
