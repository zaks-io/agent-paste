import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ApiActor, Repository } from "@agent-paste/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import * as liveUpdates from "./live-updates.js";
import { createPublishCoordinator } from "./publish-coordinator.js";

const actor = { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] } as ApiActor;

const publishInput = {
  actor,
  idempotencyKey: "idem_publish",
  artifactId: "art_1",
  revisionId: "rev_1",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeWriteAllowance() {
  const calls: string[] = [];
  const namespace = {
    calls,
    idFromName: (name: string) => ({ name }) as never,
    get: () => ({
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        calls.push(path);
        if (path.endsWith("/consume")) {
          return Response.json({ allowed: true, consumed: 1, remaining: 9, retry_after_seconds: 0 });
        }
        if (path.endsWith("/release")) {
          return Response.json({ released: true });
        }
        return new Response("not_found", { status: 404 });
      },
    }),
  };
  return namespace;
}

function coordinatorFixture(overrides: Partial<Record<keyof Repository, unknown>>) {
  const writeAllowance = fakeWriteAllowance();
  const db = {
    async peekWorkspaceCommandReplay() {
      return null;
    },
    async peekPublishWriteGate() {
      return {
        is_already_published: false,
        is_new_artifact: true,
        next_revision_number: 1,
        daily_new_artifact_allowance: 10,
      };
    },
    async publishRevision() {
      throw new Error("publishRevision_not_stubbed");
    },
    async listMemberAccessLinks() {
      return { artifact_id: "art_1", items: [] };
    },
    ...overrides,
  } as unknown as Repository;
  const env = { WRITE_ALLOWANCE: writeAllowance } as unknown as Env;
  return { coordinator: createPublishCoordinator({ db, env }), writeAllowance };
}

function publishedResult(overrides: Record<string, unknown> = {}) {
  return {
    artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    title: "Demo",
    entrypoint: "index.html",
    render_mode: "markdown",
    revision_content_url:
      "https://usercontent.test/v/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9.rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/index.html",
    expires_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("publish coordinator write-allowance reservation", () => {
  it("does not release the reservation when the publish loses an in-flight race", async () => {
    const { coordinator, writeAllowance } = coordinatorFixture({
      async publishRevision() {
        throw new IdempotencyInFlightError();
      },
    });

    await expect(coordinator.publishRevision(publishInput)).rejects.toBeInstanceOf(IdempotencyInFlightError);
    expect(writeAllowance.calls.filter((path) => path.endsWith("/consume"))).toHaveLength(1);
    expect(writeAllowance.calls.some((path) => path.endsWith("/release"))).toBe(false);
  });

  it("releases the reservation when the publish genuinely fails", async () => {
    const { coordinator, writeAllowance } = coordinatorFixture({
      async publishRevision() {
        throw new Error("draft_revision_conflict");
      },
    });

    await expect(coordinator.publishRevision(publishInput)).rejects.toThrow("draft_revision_conflict");
    expect(writeAllowance.calls.filter((path) => path.endsWith("/consume"))).toHaveLength(1);
    expect(writeAllowance.calls.filter((path) => path.endsWith("/release"))).toHaveLength(1);
  });

  it("rejects an in-flight duplicate before reserving any allowance", async () => {
    const publishCalls: unknown[] = [];
    const { coordinator, writeAllowance } = coordinatorFixture({
      async peekWorkspaceCommandReplay() {
        return { inFlight: true as const };
      },
      async publishRevision(input: unknown) {
        publishCalls.push(input);
        throw new Error("unreachable");
      },
    });

    await expect(coordinator.publishRevision(publishInput)).rejects.toBeInstanceOf(IdempotencyInFlightError);
    expect(writeAllowance.calls).toEqual([]);
    expect(publishCalls).toEqual([]);
  });

  it("does not create a Share Link by default", async () => {
    const createMemberAccessLink = vi.fn();
    const { coordinator } = coordinatorFixture({
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult();
      },
      createMemberAccessLink,
    });

    const result = await coordinator.publishRevision(publishInput);

    expect(createMemberAccessLink).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("access_link_url");
  });

  it("rejects explicit Share Link publish before committing when signing is not configured", async () => {
    const publishRevision = vi.fn();
    const createMemberAccessLink = vi.fn();
    const { coordinator, writeAllowance } = coordinatorFixture({
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      publishRevision,
      createMemberAccessLink,
    });

    await expect(coordinator.publishRevision({ ...publishInput, share: true })).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(writeAllowance.calls).toEqual([]);
    expect(publishRevision).not.toHaveBeenCalled();
    expect(createMemberAccessLink).not.toHaveBeenCalled();
  });

  it("creates and mints a Share Link when publish explicitly asks to share", async () => {
    const createMemberAccessLink = vi.fn(async () => ({ id: "al_1" }));
    const mintMemberAccessLink = vi.fn(async () => ({ url: "https://app.test/al/PUBLICLINK123456#secret" }));
    const env = {
      WRITE_ALLOWANCE: fakeWriteAllowance(),
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      WEB_BASE_URL: "https://app.test",
    } as unknown as Env;
    const db = {
      async peekWorkspaceCommandReplay() {
        return null;
      },
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult();
      },
      async listMemberAccessLinks() {
        return { artifact_id: "art_1", items: [] };
      },
      createMemberAccessLink,
      mintMemberAccessLink,
    } as unknown as Repository;
    const coordinator = createPublishCoordinator({ db, env });

    const result = await coordinator.publishRevision({ ...publishInput, share: true });

    expect(createMemberAccessLink).toHaveBeenCalledWith({
      actor,
      idempotencyKey: "idem_publish:share-link",
      artifactId: "art_1",
      type: "share",
    });
    expect(mintMemberAccessLink).toHaveBeenCalledWith({
      actor,
      accessLinkId: "al_1",
      appBaseUrl: "https://app.test",
      signingSecret: "access-link-secret",
      signingKid: 1,
    });
    expect(result).toMatchObject({ access_link_url: "https://app.test/al/PUBLICLINK123456#secret" });
  });

  it("reuses an active Share Link instead of minting a second one", async () => {
    const createMemberAccessLink = vi.fn(async () => ({ id: "al_new" }));
    const mintMemberAccessLink = vi.fn(async () => ({ url: "https://app.test/al/EXISTINGLINK123#secret" }));
    const env = {
      WRITE_ALLOWANCE: fakeWriteAllowance(),
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      WEB_BASE_URL: "https://app.test",
    } as unknown as Env;
    const db = {
      async peekWorkspaceCommandReplay() {
        return null;
      },
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult();
      },
      async listMemberAccessLinks() {
        return {
          artifact_id: "art_1",
          items: [
            {
              id: "al_active",
              type: "share",
              artifact_id: "art_1",
              revision_id: null,
              created_at: "x",
              expires_at: null,
              revoked_at: null,
            },
            {
              id: "al_revoked",
              type: "share",
              artifact_id: "art_1",
              revision_id: null,
              created_at: "x",
              expires_at: null,
              revoked_at: "2020-01-01T00:00:00.000Z",
            },
          ],
        };
      },
      createMemberAccessLink,
      mintMemberAccessLink,
    } as unknown as Repository;
    const coordinator = createPublishCoordinator({ db, env });

    const result = await coordinator.publishRevision({ ...publishInput, share: true });

    expect(createMemberAccessLink).not.toHaveBeenCalled();
    expect(mintMemberAccessLink).toHaveBeenCalledWith(expect.objectContaining({ accessLinkId: "al_active" }));
    expect(result).toMatchObject({ access_link_url: "https://app.test/al/EXISTINGLINK123#secret" });
  });

  it("notifies live updates with persisted render_mode after add_revision publish", async () => {
    const notifyLiveUpdatePublish = vi.spyOn(liveUpdates, "notifyLiveUpdatePublish").mockResolvedValue();
    const { coordinator } = coordinatorFixture({
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult();
      },
    });

    await coordinator.publishRevision(publishInput);

    expect(notifyLiveUpdatePublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revision: expect.objectContaining({
          revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          entrypoint: "index.html",
          render_mode: "markdown",
          title: "Demo",
        }),
      }),
    );
  });
});
