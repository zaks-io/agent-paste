import { EPHEMERAL_AUTO_DELETION_DAYS, SECONDS_PER_DAY } from "@agent-paste/config";
import { PepperRing } from "@agent-paste/rotation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyClaimTokenSecret } from "../../claim-tokens.js";
import { createLocalServices, type LocalRepository } from "../../local-repository.js";
import * as coreHelpers from "../core-helpers.js";
import { localClaimTokens } from "../local-entities/claim-tokens.js";
import { createLocalState } from "../local-state.js";

describe("createEphemeralWorkspace", () => {
  const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an unclaimed workspace and hashed claim token through runCommand", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const result = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-1" });

    expect(result.workspace.claimed_at).toBeNull();
    expect(result.api_key.workspace_id).toBe(result.workspace.id);
    expect(result.claim_token.workspace_id).toBe(result.workspace.id);
    expect(result.claim_token.redeemed_at).toBeNull();
    expect(result.claim_token.public_id).toHaveLength(16);
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

  it("embeds claim code attribution in the claim token secret", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const result = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-claim-code",
      claimCode,
    });
    expect(result.claim_token_secret).toMatch(
      /^ap_ct_preview_[0-9A-HJKMNP-TV-Z]{16}\.clm_[0-9A-HJKMNP-TV-Z]{26}_[A-Za-z0-9_-]{32,}$/,
    );
    expect(result.claim_token_secret).toContain(`.${claimCode}_`);
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

  it("scopes local claim token lookups to workspace", async () => {
    const state = createLocalState();
    const claimTokens = localClaimTokens(state);
    await claimTokens.insert({
      id: "ct_00000000000000000000000001",
      workspace_id: "workspace-a",
      public_id: "ABCDEFGHJKLMNP12",
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

  it("sets a one-day publish expiry for ephemeral artifacts", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({ idempotencyKey: "ephemeral-publish-ttl" });
    const actor = {
      type: "api_key" as const,
      id: provisioned.api_key.id,
      workspace_id: provisioned.workspace.id,
      scopes: ["publish", "read"] as const,
    };
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "ephemeral-upload",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2099-06-01T00:00:00.000Z",
    });
    const uploadedFile = session.files[0];
    if (!uploadedFile) {
      throw new Error("expected_upload_file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "ephemeral-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: uploadedFile.object_key, sizeBytes: 12 }],
      now: "2099-06-01T00:00:01.000Z",
    });
    const publishedAt = "2099-06-01T12:00:00.000Z";
    const published = await repo.publishRevision({
      actor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      idempotencyKey: "ephemeral-publish",
      now: publishedAt,
    });
    expect(published).toMatchObject({ ephemeral_tier: true });
    vi.useFakeTimers({ now: new Date(Date.parse(publishedAt) + 30 * 1000) });
    const agentView = await repo.getAgentView({
      actor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      contentBaseUrl: "https://content.test",
    });
    expect(agentView).toMatchObject({ ephemeral_tier: true });
    const localRepo = repo as LocalRepository;
    const artifact = localRepo.artifacts.get(session.artifact_id);
    expect(artifact?.expires_at).toBe(
      new Date(Date.parse(publishedAt) + EPHEMERAL_AUTO_DELETION_DAYS * SECONDS_PER_DAY * 1000).toISOString(),
    );
    expect(provisioned.workspace.auto_deletion_days).toBe(EPHEMERAL_AUTO_DELETION_DAYS);
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
