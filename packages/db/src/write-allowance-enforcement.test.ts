import {
  DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL,
  DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
  DAILY_NEW_ARTIFACT_ALLOWANCE_PRO,
  LIFETIME_REVISION_CEILING,
  resolveDailyNewArtifactAllowance,
} from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { createLocalServices } from "./local-repository.js";

describe("write allowance policy resolution", () => {
  it("returns the ephemeral allowance for unclaimed workspaces regardless of plan", () => {
    expect(resolveDailyNewArtifactAllowance({ claimed: false, plan: "free", billingEnabled: true })).toBe(
      DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL,
    );
    expect(resolveDailyNewArtifactAllowance({ claimed: false, plan: "pro", billingEnabled: true })).toBe(
      DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL,
    );
  });

  it("resolves the plan tier for claimed workspaces when billing is on", () => {
    expect(resolveDailyNewArtifactAllowance({ claimed: true, plan: "free", billingEnabled: true })).toBe(
      DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
    );
    expect(resolveDailyNewArtifactAllowance({ claimed: true, plan: "pro", billingEnabled: true })).toBe(
      DAILY_NEW_ARTIFACT_ALLOWANCE_PRO,
    );
  });

  it("treats claimed workspaces as free when billing is off", () => {
    expect(resolveDailyNewArtifactAllowance({ claimed: true, plan: "free", billingEnabled: false })).toBe(
      DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
    );
  });
});

describe("publish write gate", () => {
  it("blocks publishing beyond the lifetime revision ceiling", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "pepper", billingEnabled: true });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-fixture-workspace-ceiling",
      email: "ceiling@example.com",
    });
    const { secret } = await repo.createApiKey({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-fixture-credential-ceiling",
      workspaceId: workspace.id,
      name: "CI",
    });
    const actor = await repo.verifyApiKey(secret);
    if (!actor) {
      throw new Error("expected actor");
    }
    const firstSession = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-fixture-upload-ceiling-one",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-06-01T00:00:00.000Z",
    });
    const firstFile = firstSession.files[0];
    if (!firstFile) {
      throw new Error("expected upload file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-fixture-finalize-ceiling-one",
      sessionId: firstSession.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: firstFile.object_key, sizeBytes: 12 }],
      now: "2026-06-01T00:00:01.000Z",
    });
    await repo.publishRevision({
      actor,
      idempotencyKey: "idem-fixture-publish-ceiling-one",
      artifactId: firstSession.artifact_id,
      revisionId: firstSession.revision_id,
      now: "2026-06-01T00:00:02.000Z",
    });

    for (let index = 2; index <= LIFETIME_REVISION_CEILING; index += 1) {
      const now = new Date(Date.parse("2026-06-01T00:00:02.000Z") + index * 1000).toISOString();
      const session = await repo.createUploadSession({
        actor,
        idempotencyKey: `idem-fixture-upload-ceiling-${index}`,
        request: {
          artifact_id: firstSession.artifact_id,
          entrypoint: "index.html",
          files: [{ path: "index.html", size_bytes: 12 }],
        },
        now,
      });
      const uploadedFile = session.files[0];
      if (!uploadedFile) {
        throw new Error("expected upload file");
      }
      await repo.finalizeUploadSession({
        actor,
        idempotencyKey: `idem-fixture-finalize-ceiling-${index}`,
        sessionId: session.upload_session_id,
        observedFiles: [{ path: "index.html", objectKey: uploadedFile.object_key, sizeBytes: 12 }],
        now,
      });
      await repo.publishRevision({
        actor,
        idempotencyKey: `idem-fixture-publish-ceiling-${index}`,
        artifactId: firstSession.artifact_id,
        revisionId: session.revision_id,
        now,
      });
    }

    const blockedSession = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-fixture-upload-ceiling-blocked",
      request: {
        artifact_id: firstSession.artifact_id,
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-06-01T01:00:00.000Z",
    });
    const blockedFile = blockedSession.files[0];
    if (!blockedFile) {
      throw new Error("expected upload file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-fixture-finalize-ceiling-blocked",
      sessionId: blockedSession.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: blockedFile.object_key, sizeBytes: 12 }],
      now: "2026-06-01T01:00:01.000Z",
    });
    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "idem-fixture-publish-ceiling-blocked",
        artifactId: firstSession.artifact_id,
        revisionId: blockedSession.revision_id,
        now: "2026-06-01T01:00:02.000Z",
      }),
    ).rejects.toThrow("revision_ceiling_exceeded");
  });

  it("classifies the first publish as a new artifact and later publishes as revisions", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "pepper", billingEnabled: true });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-fixture-workspace-gate",
      email: "gate@example.com",
    });
    const { secret } = await repo.createApiKey({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-fixture-credential-gate",
      workspaceId: workspace.id,
      name: "CI",
    });
    const actor = await repo.verifyApiKey(secret);
    if (!actor) {
      throw new Error("expected actor");
    }
    const session = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-fixture-upload-gate",
      request: { entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
      now: "2026-06-01T00:00:00.000Z",
    });
    const uploadedFile = session.files[0];
    if (!uploadedFile) {
      throw new Error("expected upload file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-fixture-finalize-gate",
      sessionId: session.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: uploadedFile.object_key, sizeBytes: 12 }],
      now: "2026-06-01T00:00:01.000Z",
    });
    await expect(
      repo.peekPublishWriteGate({
        actor,
        artifactId: session.artifact_id,
        revisionId: session.revision_id,
      }),
    ).resolves.toMatchObject({
      is_new_artifact: true,
      next_revision_number: 1,
      daily_new_artifact_allowance: DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
      lifetime_revision_ceiling: LIFETIME_REVISION_CEILING,
    });

    await repo.publishRevision({
      actor,
      idempotencyKey: "idem-fixture-publish-gate-one",
      artifactId: session.artifact_id,
      revisionId: session.revision_id,
      now: "2026-06-01T00:00:02.000Z",
    });

    const revisionSession = await repo.createUploadSession({
      actor,
      idempotencyKey: "idem-fixture-upload-gate-two",
      request: {
        artifact_id: session.artifact_id,
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      },
      now: "2026-06-01T00:00:03.000Z",
    });
    const revisionFile = revisionSession.files[0];
    if (!revisionFile) {
      throw new Error("expected upload file");
    }
    await repo.finalizeUploadSession({
      actor,
      idempotencyKey: "idem-fixture-finalize-gate-two",
      sessionId: revisionSession.upload_session_id,
      observedFiles: [{ path: "index.html", objectKey: revisionFile.object_key, sizeBytes: 12 }],
      now: "2026-06-01T00:00:04.000Z",
    });
    await expect(
      repo.peekPublishWriteGate({
        actor,
        artifactId: session.artifact_id,
        revisionId: revisionSession.revision_id,
      }),
    ).resolves.toMatchObject({
      is_new_artifact: false,
      next_revision_number: 2,
    });
  });
});

describe("usage policy read surface", () => {
  it("includes write allowance caps for claimed and ephemeral workspaces", async () => {
    const { repo } = createLocalServices({ apiKeyPepper: "pepper", billingEnabled: true });
    const workspace = await repo.createWorkspace({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-fixture-workspace-policy",
      email: "policy@example.com",
    });
    const { secret } = await repo.createApiKey({
      actor: { type: "admin", id: "admin@example.com" },
      idempotencyKey: "idem-fixture-credential-policy",
      workspaceId: workspace.id,
      name: "CI",
    });
    const actor = await repo.verifyApiKey(secret);
    if (!actor) {
      throw new Error("expected actor");
    }
    await expect(repo.getUsagePolicy(actor)).resolves.toMatchObject({
      daily_new_artifact_allowance: DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
      lifetime_revision_ceiling: LIFETIME_REVISION_CEILING,
    });

    const ephemeral = await repo.createEphemeralWorkspace({ idempotencyKey: "idem-fixture-ephemeral-policy" });
    const ephemeralActor = {
      type: "api_key" as const,
      id: ephemeral.api_key.id,
      workspace_id: ephemeral.workspace.id,
      scopes: ["publish", "read"] as const,
    };
    await expect(repo.getUsagePolicy(ephemeralActor)).resolves.toMatchObject({
      daily_new_artifact_allowance: DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL,
    });
  });
});
