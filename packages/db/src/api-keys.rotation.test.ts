import { PepperRing } from "@agent-paste/rotation";
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

  it("verifyApiKeySecret fails when the wrong pepper is supplied for a row", async () => {
    const legacy = await generateApiKey("preview", "pepper-v1");
    expect(await verifyApiKeySecret(legacy.secret, legacy.publicId, legacy.secretHmac, "pepper-v1")).toBe(true);
    expect(await verifyApiKeySecret(legacy.secret, legacy.publicId, legacy.secretHmac, "pepper-v2")).toBe(false);
  });
});
