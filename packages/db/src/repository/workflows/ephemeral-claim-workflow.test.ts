import { EPHEMERAL_AUTO_DELETION_DAYS, SECONDS_PER_DAY } from "@agent-paste/config";
import { encryptArtifactBytes, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { describe, expect, it } from "vitest";
import { createLocalServices, type LocalRepository } from "../../local-repository.js";
import { reparentBlobMigratorFromEnv } from "../../postgres/reparent-blob-migrator.js";

const ROOT_SECRET = "test-artifact-bytes-root-secret-32chars";
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const STALE_SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXPIRED_SHA256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function memoryArtifactsBucket() {
  const objects = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string> }>();
  return {
    objects,
    async head(key: string) {
      return objects.has(key) ? { customMetadata: objects.get(key)?.customMetadata } : null;
    },
    async get(key: string) {
      const object = objects.get(key);
      return object ? { body: object.bytes, customMetadata: object.customMetadata } : null;
    },
    async put(key: string, value: Uint8Array, options?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { bytes: value, customMetadata: options?.customMetadata });
    },
  };
}

async function publishBlobArtifact(input: {
  repo: LocalRepository;
  actor: {
    type: "api_key";
    id: string;
    workspace_id: string;
    scopes: readonly ("write" | "read")[];
  };
  artifacts: ReturnType<typeof memoryArtifactsBucket>;
  sha256: string;
  body: string;
  idempotencyPrefix: string;
  now: string;
  path?: string;
}) {
  const path = input.path ?? "index.html";
  const bodyBytes = new TextEncoder().encode(input.body);
  const session = await input.repo.createUploadSession({
    actor: input.actor,
    idempotencyKey: `${input.idempotencyPrefix}-upload`,
    request: {
      entrypoint: path,
      files: [{ path, size_bytes: bodyBytes.byteLength, sha256: input.sha256 }],
    },
    now: input.now,
  });
  const uploadedFile = session.files[0];
  if (!uploadedFile) {
    throw new Error("expected_upload_file");
  }
  const encrypted = await encryptArtifactBytes({
    plaintext: bodyBytes,
    rootSecret: ROOT_SECRET,
    kid: 1,
    context: { kind: "blob", workspaceId: input.actor.workspace_id, sha256: input.sha256 },
  });
  await input.artifacts.put(uploadedFile.object_key, encrypted.ciphertext, {
    customMetadata: encrypted.customMetadata,
  });
  await input.repo.finalizeUploadSession({
    actor: input.actor,
    idempotencyKey: `${input.idempotencyPrefix}-finalize`,
    sessionId: session.upload_session_id,
    observedFiles: [{ path, objectKey: uploadedFile.object_key, sizeBytes: bodyBytes.byteLength }],
    now: input.now,
  });
  await input.repo.publishRevision({
    actor: input.actor,
    artifactId: session.artifact_id,
    revisionId: session.revision_id,
    idempotencyKey: `${input.idempotencyPrefix}-publish`,
    now: input.now,
  });
  return session;
}

describe("claimEphemeralWorkspace", () => {
  it("reparents ephemeral artifacts into the member workspace and marks the token redeemed", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-claim",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const actor = {
      type: "api_key" as const,
      id: provisioned.api_key.id,
      workspace_id: provisioned.workspace.id,
      scopes: ["write", "read"] as const,
    };
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "claim-upload",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2099-06-01T00:00:00.000Z",
    });
    const uploadedFile = session.files[0];
    if (!uploadedFile) {
      throw new Error("expected_upload_file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "claim-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: uploadedFile.object_key, sizeBytes: 12 }],
      now: "2099-06-01T00:00:01.000Z",
    });
    await repo.publishRevision({
      actor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      idempotencyKey: "claim-publish",
      now: "2099-06-01T12:00:00.000Z",
    });

    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_test",
      email: "user_claim_test@example.test",
      idempotencyKey: "claim-member",
      now: "2099-06-01T13:00:00.000Z",
    });
    const memberActor = {
      type: "member" as const,
      id: member.workspace_member.id,
      workspace_id: member.workspace.id,
      email: member.workspace_member.email,
      scopes: member.scopes,
    };

    const claimed = await repo.claimEphemeralWorkspace({
      actor: memberActor,
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-once",
      now: new Date("2099-06-01T14:00:00.000Z"),
    });

    expect(claimed.source_workspace_id).toBe(provisioned.workspace.id);
    expect(claimed.destination_workspace_id).toBe(member.workspace.id);
    expect(claimed.artifact_ids).toEqual([session.artifact_id]);

    const localRepo = repo as LocalRepository;
    expect(localRepo.workspaces.get(provisioned.workspace.id)?.claimed_at).toBe("2099-06-01T14:00:00.000Z");
    expect(localRepo.claimTokens.get(provisioned.claim_token.id)?.redeemed_at).toBe("2099-06-01T14:00:00.000Z");
    expect(localRepo.artifacts.get(session.artifact_id)?.workspace_id).toBe(member.workspace.id);
    expect(localRepo.apiKeys.get(provisioned.api_key.id)?.revoked_at).toBe("2099-06-01T14:00:00.000Z");

    const artifacts = await repo.listWebArtifacts(memberActor);
    expect(artifacts.items).toHaveLength(1);
    expect(artifacts.items[0]?.id).toBe(session.artifact_id);

    const audit = await repo.listWebAuditEvents(memberActor);
    expect(audit.items.some((event) => event.action === "ephemeral.workspace.claimed")).toBe(true);

    const otherMember = await repo.resolveWebMember({
      workosUserId: "user_claim_other",
      email: "user_claim_other@example.test",
      idempotencyKey: "claim-other-member",
      now: "2099-06-01T13:00:00.000Z",
    });
    const otherActor = {
      type: "member" as const,
      id: otherMember.workspace_member.id,
      workspace_id: otherMember.workspace.id,
      email: otherMember.workspace_member.email,
      scopes: otherMember.scopes,
    };
    await expect(repo.getWebArtifact(otherActor, session.artifact_id)).resolves.toBeNull();

    const agentView = await repo.getAgentView({
      actor: memberActor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      contentBaseUrl: "https://content.test",
    });
    expect(agentView).not.toMatchObject({ ephemeral_tier: true });

    await expect(
      repo.claimEphemeralWorkspace({
        actor: memberActor,
        claimTokenSecret: provisioned.claim_token_secret,
        idempotencyKey: "claim-twice",
        now: new Date("2099-06-01T15:00:00.000Z"),
      }),
    ).rejects.toThrow("not_found");
  });

  it("remaps blob object keys and copies bytes into the destination workspace prefix", async () => {
    const artifacts = memoryArtifactsBucket();
    const reparentBlobMigrator = reparentBlobMigratorFromEnv({
      ARTIFACTS: artifacts,
      ARTIFACT_BYTES_ENCRYPTION_KEY: ROOT_SECRET,
    });
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper", reparentBlobMigrator });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-claim-blobs",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const actor = {
      type: "api_key" as const,
      id: provisioned.api_key.id,
      workspace_id: provisioned.workspace.id,
      scopes: ["write", "read"] as const,
    };
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "claim-blob-upload",
      request: {
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 5, sha256: HELLO_SHA256 }],
      },
      now: "2099-06-01T00:00:00.000Z",
    });
    const uploadedFile = session.files[0];
    if (!uploadedFile) {
      throw new Error("expected_upload_file");
    }
    const sourceKey = uploadedFile.object_key;
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("hello"),
      rootSecret: ROOT_SECRET,
      kid: 1,
      context: { kind: "blob", workspaceId: provisioned.workspace.id, sha256: HELLO_SHA256 },
    });
    await artifacts.put(sourceKey, encrypted.ciphertext, { customMetadata: encrypted.customMetadata });
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "claim-blob-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: sourceKey, sizeBytes: 5 }],
      now: "2099-06-01T00:00:01.000Z",
    });
    await repo.publishRevision({
      actor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      idempotencyKey: "claim-blob-publish",
      now: "2099-06-01T12:00:00.000Z",
    });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_blob",
      email: "user_claim_blob@example.test",
      idempotencyKey: "claim-blob-member",
      now: "2099-06-01T13:00:00.000Z",
    });
    await repo.claimEphemeralWorkspace({
      actor: {
        type: "member",
        id: member.workspace_member.id,
        workspace_id: member.workspace.id,
        email: member.workspace_member.email,
        scopes: member.scopes,
      },
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-blob-once",
      now: new Date("2099-06-01T14:00:00.000Z"),
    });

    const localRepo = repo as LocalRepository;
    const claimedFile = [...localRepo.artifactFiles.values()].find((file) => file.path === "index.html");
    const destKey = workspaceBlobObjectKeyFor({ workspaceId: member.workspace.id, sha256: HELLO_SHA256 });
    expect(claimedFile?.r2_key).toBe(destKey);
    expect(artifacts.objects.has(destKey)).toBe(true);
    expect(localRepo.contentBlobs.get(`${member.workspace.id}:${HELLO_SHA256}:5`)?.r2_key).toBe(destKey);
  });

  it("claims successfully when an abandoned upload session left a never-uploaded blob row", async () => {
    const artifacts = memoryArtifactsBucket();
    const reparentBlobMigrator = reparentBlobMigratorFromEnv({
      ARTIFACTS: artifacts,
      ARTIFACT_BYTES_ENCRYPTION_KEY: ROOT_SECRET,
    });
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper", reparentBlobMigrator });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-claim-abandoned-session",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const actor = {
      type: "api_key" as const,
      id: provisioned.api_key.id,
      workspace_id: provisioned.workspace.id,
      scopes: ["write", "read"] as const,
    };
    await repo.createUploadSession({
      actor,
      idempotencyKey: "abandoned-session",
      request: {
        entrypoint: "stale.html",
        files: [{ path: "stale.html", size_bytes: 4, sha256: STALE_SHA256 }],
      },
      now: "2099-06-01T00:00:00.000Z",
    });
    const published = await publishBlobArtifact({
      repo: repo as LocalRepository,
      actor,
      artifacts,
      sha256: HELLO_SHA256,
      body: "live",
      idempotencyPrefix: "claim-abandoned-active",
      now: "2099-06-01T12:00:00.000Z",
    });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_abandoned",
      email: "user_claim_abandoned@example.test",
      idempotencyKey: "claim-abandoned-member",
      now: "2099-06-01T13:00:00.000Z",
    });

    await expect(
      repo.claimEphemeralWorkspace({
        actor: {
          type: "member",
          id: member.workspace_member.id,
          workspace_id: member.workspace.id,
          email: member.workspace_member.email,
          scopes: member.scopes,
        },
        claimTokenSecret: provisioned.claim_token_secret,
        idempotencyKey: "claim-abandoned",
        now: new Date("2099-06-01T14:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      artifact_ids: [published.artifact_id],
    });
  });

  it("claims successfully after an expired artifact's blobs were garbage-collected", async () => {
    const artifacts = memoryArtifactsBucket();
    const reparentBlobMigrator = reparentBlobMigratorFromEnv({
      ARTIFACTS: artifacts,
      ARTIFACT_BYTES_ENCRYPTION_KEY: ROOT_SECRET,
    });
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper", reparentBlobMigrator });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-claim-gc-blob",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const actor = {
      type: "api_key" as const,
      id: provisioned.api_key.id,
      workspace_id: provisioned.workspace.id,
      scopes: ["write", "read"] as const,
    };
    const expired = await publishBlobArtifact({
      repo: repo as LocalRepository,
      actor,
      artifacts,
      sha256: EXPIRED_SHA256,
      body: "dead",
      idempotencyPrefix: "claim-gc-expired",
      now: "2099-06-01T01:00:00.000Z",
      path: "expired.html",
    });
    await repo.forceExpireArtifact({
      artifactId: expired.artifact_id,
      expiresAt: "2099-06-01T02:00:00.000Z",
    });
    const localRepo = repo as LocalRepository;
    const expiredArtifact = localRepo.artifacts.get(expired.artifact_id);
    if (expiredArtifact) {
      expiredArtifact.status = "expired";
      expiredArtifact.deleted_at = "2099-06-01T03:00:00.000Z";
      expiredArtifact.delete_reason = "expired";
    }
    const expiredKey = workspaceBlobObjectKeyFor({
      workspaceId: provisioned.workspace.id,
      sha256: EXPIRED_SHA256,
    });
    artifacts.objects.delete(expiredKey);
    const active = await publishBlobArtifact({
      repo: repo as LocalRepository,
      actor,
      artifacts,
      sha256: HELLO_SHA256,
      body: "live",
      idempotencyPrefix: "claim-gc-active",
      now: "2099-06-01T12:00:00.000Z",
    });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_gc",
      email: "user_claim_gc@example.test",
      idempotencyKey: "claim-gc-member",
      now: "2099-06-01T13:00:00.000Z",
    });

    const claimed = await repo.claimEphemeralWorkspace({
      actor: {
        type: "member",
        id: member.workspace_member.id,
        workspace_id: member.workspace.id,
        email: member.workspace_member.email,
        scopes: member.scopes,
      },
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-gc",
      now: new Date("2099-06-01T14:00:00.000Z"),
    });

    expect(claimed.artifact_ids).toEqual(expect.arrayContaining([expired.artifact_id, active.artifact_id]));
    const destKey = workspaceBlobObjectKeyFor({ workspaceId: member.workspace.id, sha256: HELLO_SHA256 });
    expect(artifacts.objects.has(destKey)).toBe(true);
  });

  it("replays a successful claim command by idempotency key", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-replay",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_replay",
      email: "user_claim_replay@example.test",
      idempotencyKey: "claim-replay-member",
      now: "2099-06-01T00:00:00.000Z",
    });
    const memberActor = {
      type: "member" as const,
      id: member.workspace_member.id,
      workspace_id: member.workspace.id,
      email: member.workspace_member.email,
      scopes: member.scopes,
    };
    const first = await repo.claimEphemeralWorkspace({
      actor: memberActor,
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-replay-key",
      now: new Date("2099-06-01T14:00:00.000Z"),
    });
    const replay = await repo.claimEphemeralWorkspace({
      actor: memberActor,
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-replay-key",
      now: new Date("2099-06-01T15:00:00.000Z"),
    });
    expect(replay).toEqual(first);
  });

  it("rejects invalid claim tokens as not_found", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_invalid",
      email: "user_claim_invalid@example.test",
      idempotencyKey: "claim-invalid-member",
    });
    const memberActor = {
      type: "member" as const,
      id: member.workspace_member.id,
      workspace_id: member.workspace.id,
      email: member.workspace_member.email,
      scopes: member.scopes,
    };

    await expect(
      repo.claimEphemeralWorkspace({
        actor: memberActor,
        claimTokenSecret: "ap_ct_preview_notavalidtoken0000_abc",
        idempotencyKey: "claim-invalid",
      }),
    ).rejects.toThrow("not_found");
  });

  it("rejects expired claim tokens as not_found", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const now = new Date("2099-06-01T00:00:00.000Z");
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-expired-claim",
      now,
      claimTokenExpiresInSeconds: 60,
    });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_expired",
      email: "user_claim_expired@example.test",
      idempotencyKey: "claim-expired-member",
      now: now.toISOString(),
    });
    const memberActor = {
      type: "member" as const,
      id: member.workspace_member.id,
      workspace_id: member.workspace.id,
      email: member.workspace_member.email,
      scopes: member.scopes,
    };

    await expect(
      repo.claimEphemeralWorkspace({
        actor: memberActor,
        claimTokenSecret: provisioned.claim_token_secret,
        idempotencyKey: "claim-expired",
        now: new Date(now.getTime() + 2 * 60 * 1000),
      }),
    ).rejects.toThrow("not_found");
  });

  it("extends artifact expiry to the destination free tier minimum", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-expiry-claim",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const actor = {
      type: "api_key" as const,
      id: provisioned.api_key.id,
      workspace_id: provisioned.workspace.id,
      scopes: ["write", "read"] as const,
    };
    const publishNow = "2099-06-01T12:00:00.000Z";
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "claim-expiry-upload",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: publishNow,
    });
    const uploadedFile = session.files[0];
    if (!uploadedFile) {
      throw new Error("expected_upload_file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "claim-expiry-finalize",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: uploadedFile.object_key, sizeBytes: 12 }],
      now: "2099-06-01T12:00:01.000Z",
    });
    await repo.publishRevision({
      actor,
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      idempotencyKey: "claim-expiry-publish",
      now: publishNow,
    });

    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_expiry",
      email: "user_claim_expiry@example.test",
      idempotencyKey: "claim-expiry-member",
      now: publishNow,
    });
    const claimNow = "2099-06-01T14:00:00.000Z";
    await repo.claimEphemeralWorkspace({
      actor: {
        type: "member",
        id: member.workspace_member.id,
        workspace_id: member.workspace.id,
        email: member.workspace_member.email,
        scopes: member.scopes,
      },
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-expiry",
      now: new Date(claimNow),
    });

    const localRepo = repo as LocalRepository;
    const ephemeralExpiry = new Date(
      Date.parse(publishNow) + EPHEMERAL_AUTO_DELETION_DAYS * SECONDS_PER_DAY * 1000,
    ).toISOString();
    expect(localRepo.artifacts.get(session.artifact_id)?.expires_at).not.toBe(ephemeralExpiry);
    expect(Date.parse(localRepo.artifacts.get(session.artifact_id)?.expires_at ?? "")).toBeGreaterThan(
      Date.parse(ephemeralExpiry),
    );
  });

  it("rejects non-member actors", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-forbidden",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });

    await expect(
      repo.claimEphemeralWorkspace({
        actor: {
          type: "api_key",
          id: provisioned.api_key.id,
          workspace_id: provisioned.workspace.id,
          scopes: ["write", "read"],
        },
        claimTokenSecret: provisioned.claim_token_secret,
        idempotencyKey: "claim-forbidden",
      }),
    ).rejects.toThrow("forbidden");
  });

  it("rejects claim tokens with the wrong secret as not_found", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-wrong-secret",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_wrong_secret",
      email: "user_claim_wrong_secret@example.test",
      idempotencyKey: "claim-wrong-secret-member",
      now: "2099-06-01T00:00:00.000Z",
    });

    await expect(
      repo.claimEphemeralWorkspace({
        actor: {
          type: "member",
          id: member.workspace_member.id,
          workspace_id: member.workspace.id,
          email: member.workspace_member.email,
          scopes: member.scopes,
        },
        claimTokenSecret: `${provisioned.claim_token_secret}x`,
        idempotencyKey: "claim-wrong-secret",
      }),
    ).rejects.toThrow("not_found");
  });

  it("rejects legacy claim tokens without a stored public_id", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-legacy-token",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const localRepo = repo as LocalRepository;
    const stored = localRepo.claimTokens.get(provisioned.claim_token.id);
    if (stored) {
      stored.public_id = "";
    }
    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_legacy",
      email: "user_claim_legacy@example.test",
      idempotencyKey: "claim-legacy-member",
      now: "2099-06-01T00:00:00.000Z",
    });

    await expect(
      repo.claimEphemeralWorkspace({
        actor: {
          type: "member",
          id: member.workspace_member.id,
          workspace_id: member.workspace.id,
          email: member.workspace_member.email,
          scopes: member.scopes,
        },
        claimTokenSecret: provisioned.claim_token_secret,
        idempotencyKey: "claim-legacy",
      }),
    ).rejects.toThrow("not_found");
  });

  it("preserves an earlier revoked_at when revoking ephemeral workspace keys", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "test-pepper" });
    const provisioned = await repo.createEphemeralWorkspace({
      idempotencyKey: "ephemeral-prior-revoke",
      now: new Date("2099-06-01T00:00:00.000Z"),
    });
    const localRepo = repo as LocalRepository;
    const priorRevokedAt = "2099-06-01T10:00:00.000Z";
    const apiKey = localRepo.apiKeys.get(provisioned.api_key.id);
    if (!apiKey) {
      throw new Error("expected_ephemeral_api_key");
    }
    apiKey.revoked_at = priorRevokedAt;

    const member = await repo.resolveWebMember({
      workosUserId: "user_claim_prior_revoke",
      email: "user_claim_prior_revoke@example.test",
      idempotencyKey: "claim-prior-revoke-member",
      now: "2099-06-01T12:00:00.000Z",
    });
    await repo.claimEphemeralWorkspace({
      actor: {
        type: "member",
        id: member.workspace_member.id,
        workspace_id: member.workspace.id,
        email: member.workspace_member.email,
        scopes: member.scopes,
      },
      claimTokenSecret: provisioned.claim_token_secret,
      idempotencyKey: "claim-prior-revoke",
      now: new Date("2099-06-01T14:00:00.000Z"),
    });

    expect(localRepo.apiKeys.get(provisioned.api_key.id)?.revoked_at).toBe(priorRevokedAt);
  });
});
