import { describe, expect, it } from "vitest";
import { verifyClaimTokenSecret } from "../../claim-tokens.js";
import { createLocalServices, type LocalRepository } from "../../local-repository.js";

describe("createEphemeralWorkspace", () => {
  it("creates an unclaimed workspace and hashed claim token through runCommand", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const result = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-1" });

    expect(result.workspace.claimed_at).toBeNull();
    expect(result.api_key.workspace_id).toBe(result.workspace.id);
    expect(result.claim_token.workspace_id).toBe(result.workspace.id);
    expect(result.claim_token.redeemed_at).toBeNull();
    expect(result.claim_token_secret).toMatch(/^ap_ct_preview_/);

    const localRepo = repo as LocalRepository;
    expect(localRepo.workspaces.get(result.workspace.id)?.claimed_at).toBeNull();
    expect(localRepo.claimTokens.get(result.claim_token.id)?.token_hash).toEqual(result.claim_token.token_hash);

    await expect(
      verifyClaimTokenSecret(result.claim_token_secret, result.claim_token.token_hash, "test-pepper"),
    ).resolves.toBe(true);
  });

  it("honors a custom claim-token TTL", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const now = new Date("2026-06-01T12:00:00.000Z");
    const result = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-ttl",
      now,
      claimTokenExpiresInSeconds: 3600,
    });
    expect(result.claim_token.expires_at).toBe("2026-06-01T13:00:00.000Z");
    expect(result.api_key.expires_at).toBe("2026-06-01T13:00:00.000Z");
  });

  it("isolates claim token rows per workspace in local state", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const first = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-a" });
    const second = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-b" });

    const localRepo = repo as LocalRepository;
    expect(localRepo.claimTokens.get(first.claim_token.id)?.workspace_id).toBe(first.workspace.id);
    expect(localRepo.claimTokens.get(second.claim_token.id)?.workspace_id).toBe(second.workspace.id);
  });
});
