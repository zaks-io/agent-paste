import { describe, expect, it, vi } from "vitest";

vi.mock("./policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./policy.js")>();
  return {
    ...actual,
    usagePolicyForWorkspace: (workspace: { plan: string }) => ({
      ...actual.usagePolicyForWorkspace(workspace),
      live_artifacts_cap: 1,
    }),
  };
});

import { LocalRepository } from "./local-repository.js";

function firstFile(upload: Awaited<ReturnType<LocalRepository["createUploadSession"]>>) {
  const file = upload.files[0];
  if (!file) {
    throw new Error("expected upload file");
  }
  return file;
}

async function publishLocalArtifact(
  repo: LocalRepository,
  actor: NonNullable<Awaited<ReturnType<LocalRepository["verifyApiKey"]>>>,
  title: string,
  now: string,
) {
  const upload = await repo.createUploadSession({
    actor,
    idempotencyKey: `idem-create-${title}`,
    request: {
      title,
      entrypoint: "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    },
    now,
  });
  const finalized = await repo.finalizeUploadSession({
    actor,
    idempotencyKey: `idem-finalize-${title}`,
    sessionId: upload.upload_session_id,
    observedFiles: [{ path: "index.html", objectKey: firstFile(upload).object_key, sizeBytes: 12 }],
    now,
  });
  return repo.publishRevision({
    actor,
    idempotencyKey: `idem-publish-${title}`,
    artifactId: finalized.artifact_id,
    revisionId: finalized.revision_id,
    now,
  });
}

describe("pinned artifact cap", () => {
  it("rejects pinning when the workspace is at the cap", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const session = await repo.resolveWebMember({
      workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
      email: "cap@example.com",
      idempotencyKey: "workos-jti:pin-cap",
      now: "2026-01-01T00:00:00.000Z",
    });
    const keySecret = session.default_api_key?.secret;
    const apiActor = keySecret ? await repo.verifyApiKey(keySecret) : null;
    const webActor = await repo.getWebMemberByWorkOsUserId({ workosUserId: "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ" });
    if (!apiActor || !webActor) {
      throw new Error("expected actors");
    }
    const first = await publishLocalArtifact(repo, apiActor, "first-pin", "2026-01-01T00:00:01.000Z");
    await repo.pinWebArtifact({
      actor: webActor,
      idempotencyKey: "idem-pin-first",
      artifactId: first.artifact_id,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    const second = await publishLocalArtifact(repo, apiActor, "second-pin", "2026-01-01T00:00:02.000Z");
    await expect(
      repo.pinWebArtifact({
        actor: webActor,
        idempotencyKey: "idem-pin-second",
        artifactId: second.artifact_id,
        now: new Date("2026-01-02T00:00:01.000Z"),
      }),
    ).rejects.toThrow("pinned_artifact_cap_exceeded");
  });
});
