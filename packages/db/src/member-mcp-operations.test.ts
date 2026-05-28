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
      artifactId,
      type: "share",
    });
    const links = await repo.listMemberAccessLinks(member, artifactId);
    expect(links?.items.some((link) => link.id === share.id)).toBe(true);

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

    const deleted = await repo.deleteMemberArtifact({ actor: member, artifactId });
    expect(deleted.artifact_id).toBe(artifactId);
    await expect(repo.listMemberArtifacts(member, { limit: 10 })).resolves.toMatchObject({
      data: [],
    });
  });
});
