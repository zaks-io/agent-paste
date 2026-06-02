import { PepperRing } from "@agent-paste/rotation";
import { describe, expect, it, vi } from "vitest";
import { verifyClaimTokenSecret } from "../../claim-tokens.js";
import { createLocalServices, type LocalRepository } from "../../local-repository.js";
import * as coreHelpers from "../core-helpers.js";
import { localClaimTokens } from "../local-entities/claim-tokens.js";
import { createLocalState } from "../local-state.js";

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

  it("uses command now when ttl conversion returns null", async () => {
    const spy = vi.spyOn(coreHelpers, "expiresAtFromSeconds").mockReturnValue(null);
    const now = new Date("2026-06-01T12:00:00.000Z");
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const result = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-null-ttl", now });
    expect(result.claim_token.expires_at).toBe(now.toISOString());
    expect(result.api_key.expires_at).toBe(now.toISOString());
    spy.mockRestore();
  });

  it("uses configured pepper ring and api key env when provided", async () => {
    const pepperRing = PepperRing.single("ring-pepper", 1);
    const { repo } = createLocalServices({
      apiKeyPepper: "ignored",
      apiKeyEnv: "production",
      pepperRing,
    });
    const result = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-ring" });
    expect(result.claim_token_secret).toMatch(/^ap_ct_production_/);
    expect(result.claim_token.pepper_kid).toBe(1);
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

  it("scopes local claim token lookups to workspace", async () => {
    const state = createLocalState();
    const claimTokens = localClaimTokens(state);
    await claimTokens.insert({
      id: "ct_00000000000000000000000001",
      workspace_id: "workspace-a",
      token_hash: new Uint8Array([1]),
      pepper_kid: 1,
      expires_at: "2026-01-01T00:00:00.000Z",
      redeemed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await expect(claimTokens.findById("ct_00000000000000000000000001")).resolves.toMatchObject({
      workspace_id: "workspace-a",
    });
    await expect(claimTokens.findById("ct_00000000000000000000000001", "workspace-a")).resolves.toMatchObject({
      workspace_id: "workspace-a",
    });
    await expect(claimTokens.findById("ct_00000000000000000000000001", "workspace-b")).resolves.toBeNull();
    await expect(claimTokens.findById("ct_missing")).resolves.toBeNull();
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
