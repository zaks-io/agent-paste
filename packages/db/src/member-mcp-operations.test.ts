import { IdempotencyKey, mcpPublishAccessLinkIdempotencyKey } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { LocalRepository } from "./local-repository.js";

async function memberWithPublishedArtifact(repo: LocalRepository) {
  const session = await repo.resolveWebMember({
    workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
    email: "mcp-member@example.com",
    idempotencyKey: "workos-jti:mcp-member",
    now: "2026-01-01T00:00:00.000Z",
  });
  const keySecret = session.default_api_key?.secret;
  const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
  const member = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
  if (!apiActor || !member) {
    throw new Error("expected actors");
  }
  const upload = await repo.createUploadSession({
    actor: apiActor,
    idempotencyKey: "idem-upload",
    request: {
      title: "MCP artifact",
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
    idempotencyKey: "idem-finalize",
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.md", objectKey: file.object_key, sizeBytes: 5 }],
    now: "2026-01-01T00:00:02.000Z",
  });
  await repo.publishRevision({
    actor: apiActor,
    idempotencyKey: "idem-publish",
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now: "2026-01-01T00:00:03.000Z",
  });
  return { member, artifactId: finalized.artifact_id };
}

describe("member MCP repository operations", () => {
  it("peekIdempotentReplay resolves upload session commands for member actors", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "mcp-member@example.com",
      idempotencyKey: "workos-jti:peek-member",
      now: "2026-01-01T00:00:00.000Z",
    });
    const member = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!member) {
      throw new Error("expected member actor");
    }
    const upload = await repo.createUploadSession({
      actor: member,
      idempotencyKey: "idem-member-peek-create",
      request: {
        title: "MCP upload",
        entrypoint: "index.md",
        files: [{ path: "index.md", size_bytes: 5 }],
      },
      now: "2026-01-01T00:00:01.000Z",
    });
    const file = upload.files[0];
    if (!file) {
      throw new Error("expected upload file");
    }
    await repo.finalizeUploadSession({
      actor: member,
      idempotencyKey: "idem-member-peek-finalize",
      sessionId: upload.upload_session_id,
      observedFiles: [{ path: "index.md", objectKey: file.object_key, sizeBytes: 5 }],
      now: "2026-01-01T00:00:02.000Z",
    });
    const createReplay = await repo.peekIdempotentReplay({
      actor: member,
      operation: "upload.session.create",
      idempotencyKey: "idem-member-peek-create",
    });
    expect(createReplay).toMatchObject({
      result: expect.objectContaining({ upload_session_id: upload.upload_session_id }),
    });
    const finalizeReplay = await repo.peekIdempotentReplay({
      actor: member,
      operation: "upload.session.finalize",
      idempotencyKey: "idem-member-peek-finalize",
    });
    expect(finalizeReplay).toMatchObject({
      result: expect.objectContaining({ artifact_id: upload.artifact_id }),
    });
  });

  it("replays share link creation when reusing the publish-chain share idempotency key", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo);
    // Opaque string matching MCP publish_artifact key shape; dedup is scoped by operation
    // plus key, not by deriveMcpIdempotencyKey formatting.
    const toolKey = IdempotencyKey.parse("mcp:user_01:7:publish_artifact");
    const publishChainShareKey = mcpPublishAccessLinkIdempotencyKey(toolKey);

    const share = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: publishChainShareKey,
      artifactId,
      type: "share",
    });
    const replayedShare = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: publishChainShareKey,
      artifactId,
      type: "share",
    });

    expect(replayedShare.id).toBe(share.id);
    const links = await repo.listMemberAccessLinks(member, artifactId);
    expect(links?.items.filter((link) => link.type === "share")).toHaveLength(1);
  });

  it("reuses the one active share link across distinct make-public calls, then mints fresh after revoke", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo);

    // Distinct idempotency keys: real make_public calls derive a fresh key each
    // time, so reuse must come from the active-share-link lookup, not key replay.
    const first = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "make-public-1",
      artifactId,
      type: "share",
    });
    const second = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "make-public-2",
      artifactId,
      type: "share",
    });
    expect(second.id).toBe(first.id);
    const afterReuse = await repo.listMemberAccessLinks(member, artifactId);
    expect(afterReuse?.items.filter((link) => link.type === "share")).toHaveLength(1);

    await repo.revokeMemberAccessLink({ actor: member, accessLinkId: first.id });
    const third = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "make-public-3",
      artifactId,
      type: "share",
    });
    expect(third.id).not.toBe(first.id);
    const afterRevoke = await repo.listMemberAccessLinks(member, artifactId);
    expect(afterRevoke?.items.filter((link) => link.type === "share" && link.revoked_at === null)).toHaveLength(1);
  });

  it("lists, updates title, deletes artifacts, and manages access links for a member", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const { member, artifactId } = await memberWithPublishedArtifact(repo);

    const listed = await repo.listMemberArtifacts(member, { limit: 10 });
    expect(listed.data.some((row) => row.id === artifactId)).toBe(true);

    const updated = await repo.updateArtifactDisplayMetadata({
      actor: member,
      artifactId,
      title: "Renamed",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(updated).toEqual({ title: "Renamed", description: null });

    const share = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "idem-access-link",
      artifactId,
      type: "share",
    });
    const replayedShare = await repo.createMemberAccessLink({
      actor: member,
      idempotencyKey: "idem-access-link",
      artifactId,
      type: "share",
    });
    expect(replayedShare.id).toBe(share.id);
    const links = await repo.listMemberAccessLinks(member, artifactId);
    expect(links?.items.filter((link) => link.id === share.id)).toHaveLength(1);

    const minted = await repo.mintMemberAccessLink({
      actor: member,
      accessLinkId: share.id,
      appBaseUrl: "https://app.agent-paste.sh",
      signingSecret: "secret",
      signingKid: 1,
    });
    expect(minted.url).toContain("https://");

    await repo.revokeMemberAccessLink({ actor: member, accessLinkId: share.id });
    await expect(
      repo.mintMemberAccessLink({
        actor: member,
        accessLinkId: share.id,
        appBaseUrl: "https://app.agent-paste.sh",
        signingSecret: "secret",
        signingKid: 1,
      }),
    ).rejects.toThrow();

    const deleted = await repo.deleteMemberArtifact({
      actor: member,
      idempotencyKey: "idem-delete",
      artifactId,
    });
    expect(deleted).toMatchObject({
      artifact_id: artifactId,
      workspace_id: member.workspace_id,
      revision_id: expect.any(String),
    });
    const replayed = await repo.deleteMemberArtifact({
      actor: member,
      idempotencyKey: "idem-delete",
      artifactId,
    });
    expect(replayed).toEqual(deleted);
    await expect(repo.listMemberArtifacts(member, { limit: 10 })).resolves.toMatchObject({
      data: [],
    });
  });
});
