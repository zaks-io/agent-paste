import { describe, expect, it } from "vitest";
import { LocalRepository } from "./local-repository.js";

async function memberWithPublishedArtifact(repo: LocalRepository, suffix: string) {
  const workosUserId = `user_01J5K7Y8G9H0ABCDEFGHJK${suffix}`;
  const session = await repo.resolveWebMember({
    workosUserId,
    email: `web-${suffix}@example.com`,
    idempotencyKey: `workos-jti:web-${suffix}`,
    now: "2026-01-01T00:00:00.000Z",
  });
  const keySecret = session.default_api_key?.secret;
  const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
  const member = await repo.getWebMemberByWorkOsUserId({ workosUserId });
  if (!apiActor || !member) {
    throw new Error("expected actors");
  }
  const upload = await repo.createUploadSession({
    actor: apiActor,
    idempotencyKey: `idem-upload-${suffix}`,
    request: {
      title: "Web artifact",
      entrypoint: "index.md",
      files: [{ path: "index.md", size_bytes: 5 }],
    },
    now: "2026-01-01T00:00:01.000Z",
  });
  const file = upload.files[0];
  if (!file) {
    throw new Error("expected upload file");
  }
  const finalized = await repo.finalizeUploadSession({
    actor: apiActor,
    idempotencyKey: `idem-finalize-${suffix}`,
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.md", objectKey: file.object_key, sizeBytes: 5 }],
    now: "2026-01-01T00:00:02.000Z",
  });
  await repo.publishRevision({
    actor: apiActor,
    idempotencyKey: `idem-publish-${suffix}`,
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now: "2026-01-01T00:00:03.000Z",
  });
  return { member, artifactId: finalized.artifact_id };
}

describe("web Access Link member operations", () => {
  it("lists access links workspace-wide and per artifact with a revoked flag", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo, "MA");

    const empty = await repo.listWorkspaceAccessLinks(member);
    expect(empty.items).toEqual([]);
    expect(empty.page_info).toEqual({ next_cursor: null, has_more: false });

    const share = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "idem-share",
      artifactId,
      type: "share",
    });

    const workspaceList = await repo.listWorkspaceAccessLinks(member);
    expect(workspaceList.items).toHaveLength(1);
    expect(workspaceList.items[0]).toMatchObject({ id: share.id, type: "share", revoked: false });

    const artifactList = await repo.listWebArtifactAccessLinks(member, artifactId);
    expect(artifactList?.items).toHaveLength(1);
    expect(artifactList?.items[0]).toMatchObject({ id: share.id, artifact_id: artifactId });

    await repo.revokeMemberAccessLink({ actor: member, accessLinkId: share.id });
    const afterRevoke = await repo.listWorkspaceAccessLinks(member);
    expect(afterRevoke.items[0]).toMatchObject({ id: share.id, revoked: true });
  });

  it("returns null when listing access links for an unknown artifact", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member } = await memberWithPublishedArtifact(repo, "MB");
    await expect(repo.listWebArtifactAccessLinks(member, "art_missing")).resolves.toBeNull();
  });

  it("does not surface another workspace's access links", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const owner = await memberWithPublishedArtifact(repo, "MC");
    const other = await memberWithPublishedArtifact(repo, "MD");
    await repo.createMemberAccessLink({
      actor: owner.member,
      idempotencyKey: "idem-owner-share",
      artifactId: owner.artifactId,
      type: "share",
    });
    const otherList = await repo.listWorkspaceAccessLinks(other.member);
    expect(otherList.items).toEqual([]);
  });

  it("engages and lifts Access Link Lockdown, gating mint while locked", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo, "ME");
    const share = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "idem-lockdown-share",
      artifactId,
      type: "share",
    });

    const locked = await repo.setMemberAccessLinkLockdown({
      actor: member,
      idempotencyKey: "idem-lockdown-set",
      artifactId,
      locked: true,
    });
    expect(locked).toMatchObject({ id: artifactId, lockdown: true });

    await expect(
      repo.mintMemberAccessLink({
        actor: member,
        accessLinkId: share.id,
        appBaseUrl: "https://app.agent-paste.sh",
        signingSecret: "secret",
        signingKid: 1,
      }),
    ).rejects.toThrow();

    const lifted = await repo.setMemberAccessLinkLockdown({
      actor: member,
      idempotencyKey: "idem-lockdown-lift",
      artifactId,
      locked: false,
    });
    expect(lifted).toMatchObject({ id: artifactId, lockdown: false });

    const minted = await repo.mintMemberAccessLink({
      actor: member,
      accessLinkId: share.id,
      appBaseUrl: "https://app.agent-paste.sh",
      signingSecret: "secret",
      signingKid: 1,
    });
    expect(minted.url).toContain("https://app.agent-paste.sh/al/");
  });

  it("rejects lockdown changes for a missing artifact", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member } = await memberWithPublishedArtifact(repo, "MF");
    await expect(
      repo.setMemberAccessLinkLockdown({
        actor: member,
        idempotencyKey: "idem-lockdown-missing",
        artifactId: "art_missing",
        locked: true,
      }),
    ).rejects.toThrow();
  });

  it("treats a redundant lockdown request as an idempotent no-op", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo, "MG");

    await repo.setMemberAccessLinkLockdown({
      actor: member,
      idempotencyKey: "idem-lockdown-set-1",
      artifactId,
      locked: true,
    });
    // Already locked: this must not throw and must report lockdown still engaged.
    const again = await repo.setMemberAccessLinkLockdown({
      actor: member,
      idempotencyKey: "idem-lockdown-set-2",
      artifactId,
      locked: true,
    });
    expect(again).toMatchObject({ id: artifactId, lockdown: true });

    // Already unlocked artifact: lifting a never-locked one is also a no-op.
    const second = await memberWithPublishedArtifact(repo, "MH");
    const liftedNoop = await repo.setMemberAccessLinkLockdown({
      actor: second.member,
      idempotencyKey: "idem-lockdown-lift-noop",
      artifactId: second.artifactId,
      locked: false,
    });
    expect(liftedNoop).toMatchObject({ id: second.artifactId, lockdown: false });
  });

  it("rejects lockdown changes from a non-member actor", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { artifactId } = await memberWithPublishedArtifact(repo, "MI");
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMI",
      email: "web-MI@example.com",
      idempotencyKey: "workos-jti:web-MI",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    if (!apiActor) {
      throw new Error("expected api key actor");
    }
    await expect(
      repo.setMemberAccessLinkLockdown({
        actor: apiActor,
        idempotencyKey: "idem-lockdown-nonmember",
        artifactId,
        locked: true,
      }),
    ).rejects.toThrow();
  });

  it("reports revision-link rows with their pinned revision and expiration", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo, "MJ");
    const detail = await repo.listWebArtifactAccessLinks(member, artifactId);
    expect(detail).toMatchObject({ items: [] });

    const share = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "idem-share-MJ",
      artifactId,
      type: "share",
    });
    await repo.revokeMemberAccessLink({ actor: member, accessLinkId: share.id });

    const after = await repo.listWebArtifactAccessLinks(member, artifactId);
    expect(after?.items[0]).toMatchObject({ id: share.id, revoked: true, revoked_at: expect.any(String) });
  });
});
