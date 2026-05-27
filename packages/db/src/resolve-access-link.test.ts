import { KeyRing } from "@agent-paste/rotation";
import { describe, expect, it } from "vitest";
import {
  createAccessLinkRow,
  mintAccessLinkSignedUrl,
  verifyAccessLinkSignedBlobWithRing,
} from "./access-links.js";
import { LocalRepository } from "./local-repository.js";

const APP_BASE = "https://app.agent-paste.test";
const CONTENT_BASE = "https://content.agent-paste.test";
const RING = KeyRing.single("access-link-resolve-secret", 1);

async function repoWithPublishedArtifact() {
  const repo = new LocalRepository({ apiKeyPepper: "pepper" });
  const workspace = await repo.createWorkspace({
    actor: { type: "platform", id: "admin" },
    idempotencyKey: "idem-ws",
    email: "user@example.com",
  });
  const key = await repo.createApiKey({
    actor: { type: "platform", id: "admin" },
    idempotencyKey: "idem-key",
    workspaceId: workspace.id,
    name: "default",
  });
  const actor = await repo.verifyApiKey(key.secret);
  if (!actor) {
    throw new Error("expected actor");
  }
  const upload = await repo.createUploadSession({
    actor,
    idempotencyKey: "idem-upload",
    request: { title: "shared", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] },
    now: "2026-01-01T00:00:00.000Z",
  });
  const file = upload.files[0];
  if (!file) {
    throw new Error("missing file");
  }
  const finalized = await repo.finalizeUploadSession({
    actor,
    idempotencyKey: "idem-finalize",
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.html", objectKey: file.object_key, sizeBytes: 12 }],
    now: "2026-01-01T00:00:01.000Z",
  });
  const published = await repo.publishRevision({
    actor,
    idempotencyKey: "idem-publish",
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now: "2026-01-01T00:00:02.000Z",
  });
  const artifact = repo.artifacts.get(published.artifact_id);
  if (!artifact) {
    throw new Error("missing artifact");
  }
  return { repo, actor, artifact };
}

describe("resolveAccessLink", () => {
  it("resolves active share links and rejects revoked or lockdown states", async () => {
    const { repo, actor, artifact } = await repoWithPublishedArtifact();
    const link = createAccessLinkRow({
      workspaceId: artifact.workspace_id,
      artifactId: artifact.id,
      type: "share",
      createdByType: "api_key",
      createdById: actor.id,
      now: "2026-01-01T00:00:00.000Z",
    });
    repo.accessLinks.set(link.id, link);
    const minted = await mintAccessLinkSignedUrl({
      link,
      artifact,
      appBaseUrl: APP_BASE,
      signingSecret: "access-link-resolve-secret",
      signingKid: 1,
    });
    const verified = await verifyAccessLinkSignedBlobWithRing({
      publicId: link.public_id,
      blob: minted.blob,
      ring: RING,
    });
    expect(verified).not.toBeNull();

    const resolved = await repo.resolveAccessLink({
      publicId: link.public_id,
      blobScopes: verified?.scopes ?? 0,
      contentBaseUrl: CONTENT_BASE,
      now: "2026-01-15T00:00:00.000Z",
    });
    expect(resolved).toMatchObject({
      render_mode: "html",
      title: "shared",
      iframe_src: `${CONTENT_BASE}/v/${artifact.id}.${artifact.revision_id}/index.html`,
    });
    expect(resolved?.agent_view.artifact_id).toBe(artifact.id);

    const revoked = createAccessLinkRow({
      workspaceId: artifact.workspace_id,
      artifactId: artifact.id,
      type: "share",
      createdByType: "api_key",
      createdById: actor.id,
      now: "2026-01-02T00:00:00.000Z",
    });
    revoked.revoked_at = "2026-01-02T00:00:00.000Z";
    repo.accessLinks.set(revoked.id, revoked);
    await expect(
      repo.resolveAccessLink({
        publicId: revoked.public_id,
        blobScopes: verified?.scopes ?? 0,
        contentBaseUrl: CONTENT_BASE,
        now: "2026-01-15T00:00:00.000Z",
      }),
    ).resolves.toBeNull();

    const locked = repo.artifacts.get(artifact.id);
    if (locked) {
      locked.access_link_lockdown_at = "2026-01-02T00:00:00.000Z";
    }
    await expect(
      repo.resolveAccessLink({
        publicId: link.public_id,
        blobScopes: verified?.scopes ?? 0,
        contentBaseUrl: CONTENT_BASE,
        now: "2026-01-15T00:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });
});
