import { LIFETIME_REVISION_CEILING } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { createLocalServices, type LocalRepository } from "../../local-repository.js";
import { RepositoryError } from "../../repository-error.js";
import type { ApiActor } from "../../types.js";

const adminActor = { type: "admin" as const, id: "publish-characterization" };

async function localRepoWithActor() {
  const { repo } = createLocalServices({ apiKeyPepper: "pepper", billingEnabled: true });
  const workspace = await repo.createWorkspace({
    actor: adminActor,
    idempotencyKey: "idem-ws",
    email: "publish@example.com",
  });
  const key = await repo.createApiKey({
    actor: adminActor,
    idempotencyKey: "idem-key",
    workspaceId: workspace.id,
    name: "default",
  });
  const actor = await repo.verifyApiKey(key.secret);
  if (!actor) {
    throw new Error("expected actor");
  }
  return { repo: repo as LocalRepository, actor };
}

async function finalizedDraft(
  repo: LocalRepository,
  actor: ApiActor,
  input: {
    prefix: string;
    title?: string;
    entrypoint?: string;
    artifactId?: string;
    now: string;
  },
) {
  const session = await repo.createUploadSession({
    actor,
    idempotencyKey: `${input.prefix}-upload`,
    request: {
      ...(input.artifactId ? { artifact_id: input.artifactId } : {}),
      ...(input.title !== undefined ? { title: input.title } : input.artifactId ? {} : { title: "demo" }),
      entrypoint: input.entrypoint ?? "index.html",
      files: [{ path: "index.html", size_bytes: 12 }],
    },
    now: input.now,
  });
  const file = session.files[0];
  if (!file) {
    throw new Error("expected upload file");
  }
  const finalized = await repo.finalizeUploadSession({
    actor,
    idempotencyKey: `${input.prefix}-finalize`,
    sessionId: session.upload_session_id,
    observedFiles: [{ path: "index.html", objectKey: file.object_key, sizeBytes: 12 }],
    now: input.now,
  });
  return { session, finalized };
}

describe("publishRevision characterization", () => {
  it("publishes a draft revision and updates artifact state", async () => {
    const { repo, actor } = await localRepoWithActor();
    const { finalized } = await finalizedDraft(repo, actor, {
      prefix: "happy",
      title: "published-title",
      now: "2026-06-01T00:00:00.000Z",
    });
    const publishedAt = "2026-06-01T00:00:02.000Z";

    const result = await repo.publishRevision({
      actor,
      idempotencyKey: "happy-publish",
      artifactId: finalized.artifact_id,
      revisionId: finalized.revision_id,
      now: publishedAt,
    });

    expect(result).toMatchObject({
      artifact_id: finalized.artifact_id,
      revision_id: finalized.revision_id,
      title: "published-title",
    });
    const revision = repo.revisions.get(finalized.revision_id);
    expect(revision).toMatchObject({
      status: "published",
      revision_number: 1,
      published_at: publishedAt,
      bundle_status: "pending",
    });
    const artifact = repo.artifacts.get(finalized.artifact_id);
    expect(artifact).toMatchObject({
      revision_id: finalized.revision_id,
      title: "published-title",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: 12,
      updated_at: publishedAt,
    });
    const publishEvents = [...repo.operationEvents.values()].filter((event) => event.action === "artifact.published");
    expect(publishEvents).toHaveLength(1);
    expect(publishEvents[0]).toMatchObject({
      target_id: finalized.artifact_id,
      workspace_id: actor.workspace_id,
      details: { revision_id: finalized.revision_id, revision_number: 1, file_count: 1 },
    });
  });

  it("preserves the artifact title when publishing a revision without a session title", async () => {
    const { repo, actor } = await localRepoWithActor();
    const first = await finalizedDraft(repo, actor, {
      prefix: "title-preserve",
      title: "Original Title",
      now: "2026-06-01T00:00:00.000Z",
    });
    await repo.publishRevision({
      actor,
      idempotencyKey: "title-preserve-first",
      artifactId: first.finalized.artifact_id,
      revisionId: first.finalized.revision_id,
      now: "2026-06-01T00:00:02.000Z",
    });

    const revisionDraft = await finalizedDraft(repo, actor, {
      prefix: "title-preserve-rev",
      artifactId: first.finalized.artifact_id,
      now: "2026-06-01T00:00:03.000Z",
    });
    const publishedAt = "2026-06-01T00:00:05.000Z";
    const result = await repo.publishRevision({
      actor,
      idempotencyKey: "title-preserve-second",
      artifactId: first.finalized.artifact_id,
      revisionId: revisionDraft.finalized.revision_id,
      now: publishedAt,
    });

    expect(result.title).toBe("Original Title");
    expect(repo.artifacts.get(first.finalized.artifact_id)).toMatchObject({
      title: "Original Title",
      revision_id: revisionDraft.finalized.revision_id,
      updated_at: publishedAt,
    });
  });

  it("replays publish for an already published revision without duplicating writes", async () => {
    const { repo, actor } = await localRepoWithActor();
    const { finalized } = await finalizedDraft(repo, actor, {
      prefix: "replay",
      now: "2026-06-01T00:00:00.000Z",
    });
    const first = await repo.publishRevision({
      actor,
      idempotencyKey: "replay-publish-1",
      artifactId: finalized.artifact_id,
      revisionId: finalized.revision_id,
      now: "2026-06-01T00:00:02.000Z",
    });
    const replay = await repo.publishRevision({
      actor,
      idempotencyKey: "replay-publish-2",
      artifactId: finalized.artifact_id,
      revisionId: finalized.revision_id,
      now: "2026-06-01T00:00:03.000Z",
    });

    expect(replay).toMatchObject({
      artifact_id: first.artifact_id,
      revision_id: first.revision_id,
      title: first.title,
    });
    const publishEvents = [...repo.operationEvents.values()].filter((event) => event.action === "artifact.published");
    expect(publishEvents).toHaveLength(1);
    expect(repo.revisions.get(finalized.revision_id)?.revision_number).toBe(1);
  });

  it("rejects missing or inactive artifacts", async () => {
    const { repo, actor } = await localRepoWithActor();
    const { finalized } = await finalizedDraft(repo, actor, {
      prefix: "artifact-guards",
      now: "2026-06-01T00:00:00.000Z",
    });

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "missing-artifact",
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revisionId: finalized.revision_id,
        now: "2026-06-01T00:00:02.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("artifact_not_found"));

    const artifact = repo.artifacts.get(finalized.artifact_id);
    if (artifact) {
      artifact.status = "deleted";
    }
    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "inactive-artifact",
        artifactId: finalized.artifact_id,
        revisionId: finalized.revision_id,
        now: "2026-06-01T00:00:03.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("artifact_not_found"));
  });

  it("rejects missing revisions and revisions from another artifact", async () => {
    const { repo, actor } = await localRepoWithActor();
    const first = await finalizedDraft(repo, actor, {
      prefix: "revision-guards-a",
      now: "2026-06-01T00:00:00.000Z",
    });
    const second = await finalizedDraft(repo, actor, {
      prefix: "revision-guards-b",
      now: "2026-06-01T00:00:01.000Z",
    });

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "missing-revision",
        artifactId: first.finalized.artifact_id,
        revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        now: "2026-06-01T00:00:02.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("revision_unpublished"));

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "cross-artifact-revision",
        artifactId: first.finalized.artifact_id,
        revisionId: second.finalized.revision_id,
        now: "2026-06-01T00:00:03.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("revision_unpublished"));
  });

  it("rejects retained revisions", async () => {
    const { repo, actor } = await localRepoWithActor();
    const { finalized } = await finalizedDraft(repo, actor, {
      prefix: "retained",
      now: "2026-06-01T00:00:00.000Z",
    });
    const revision = repo.revisions.get(finalized.revision_id);
    if (revision) {
      revision.status = "retained";
    }

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "retained-revision",
        artifactId: finalized.artifact_id,
        revisionId: finalized.revision_id,
        now: "2026-06-01T00:00:02.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("revision_retained"));
  });

  it("rejects drafts whose entrypoint is not present in revision files", async () => {
    const { repo, actor } = await localRepoWithActor();
    const { finalized } = await finalizedDraft(repo, actor, {
      prefix: "entrypoint",
      now: "2026-06-01T00:00:00.000Z",
    });
    const revision = repo.revisions.get(finalized.revision_id);
    if (revision) {
      revision.entrypoint = "missing.html";
    }

    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "entrypoint-missing",
        artifactId: finalized.artifact_id,
        revisionId: finalized.revision_id,
        now: "2026-06-01T00:00:02.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("entrypoint_not_in_revision"));
  });

  it("rejects publish when the lifetime revision ceiling is exceeded", async () => {
    const { repo, actor } = await localRepoWithActor();
    const first = await finalizedDraft(repo, actor, {
      prefix: "ceiling",
      now: "2026-06-01T00:00:00.000Z",
    });
    await repo.publishRevision({
      actor,
      idempotencyKey: "ceiling-first",
      artifactId: first.finalized.artifact_id,
      revisionId: first.finalized.revision_id,
      now: "2026-06-01T00:00:02.000Z",
    });

    for (let index = 2; index <= LIFETIME_REVISION_CEILING; index += 1) {
      const now = new Date(Date.parse("2026-06-01T00:00:02.000Z") + index * 1000).toISOString();
      const draft = await finalizedDraft(repo, actor, {
        prefix: `ceiling-${index}`,
        artifactId: first.finalized.artifact_id,
        now,
      });
      await repo.publishRevision({
        actor,
        idempotencyKey: `ceiling-publish-${index}`,
        artifactId: first.finalized.artifact_id,
        revisionId: draft.finalized.revision_id,
        now,
      });
    }

    const blocked = await finalizedDraft(repo, actor, {
      prefix: "ceiling-blocked",
      artifactId: first.finalized.artifact_id,
      now: "2026-06-01T01:00:00.000Z",
    });
    await expect(
      repo.publishRevision({
        actor,
        idempotencyKey: "ceiling-blocked",
        artifactId: first.finalized.artifact_id,
        revisionId: blocked.finalized.revision_id,
        now: "2026-06-01T01:00:02.000Z",
      }),
    ).rejects.toThrow(new RepositoryError("revision_ceiling_exceeded"));
  });
});
