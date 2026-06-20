import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ApiActor, Repository } from "@agent-paste/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import * as liveUpdates from "./live-updates.js";
import { createPublishCoordinator } from "./publish-coordinator.js";

const actor = { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] } as ApiActor;
const claimCode = "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD";

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

function coordinatorFixture(
  overrides: Partial<Record<keyof Repository, unknown>>,
  envOverrides: Record<string, unknown> = {},
) {
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
  const env = { WRITE_ALLOWANCE: writeAllowance, ...envOverrides } as unknown as Env;
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

  it("publishes content-only: returns the private viewer link and never an access_link_url", async () => {
    const { coordinator } = coordinatorFixture({
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult();
      },
    });

    const result = await coordinator.publishRevision(publishInput);

    expect(result).toHaveProperty("private_url");
    expect(result).not.toHaveProperty("access_link_url");
  });

  it("auto-creates the unlisted Share Link and returns unlisted_url for an ephemeral publish", async () => {
    const writeDataPoint = vi.fn();
    const createMemberAccessLink = vi.fn().mockResolvedValue({
      id: "al_ephemeral",
      type: "share",
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      revision_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const mintMemberAccessLink = vi.fn().mockResolvedValue({ url: "https://app.test/al/PUBLIC#sig" });
    const { coordinator } = coordinatorFixture(
      {
        async peekPublishWriteGate() {
          return { is_already_published: true, is_new_artifact: false };
        },
        async publishRevision() {
          return publishedResult({ ephemeral_tier: true });
        },
        createMemberAccessLink,
        mintMemberAccessLink,
      },
      { ACCESS_LINK_SIGNING_KEY_V1: "al-test-secret", FUNNEL_EVENTS: { writeDataPoint } },
    );

    const result = await coordinator.publishRevision({ ...publishInput, claimCode });

    expect(result).toHaveProperty("unlisted_url", "https://app.test/al/PUBLIC#sig");
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [claimCode],
      blobs: ["ephemeral_publish_created", "api", claimCode, "w_1", "art_1", "", "", ""],
      doubles: [1, 0],
    });
    expect(createMemberAccessLink).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "art_1", type: "share" }),
    );
    // Dedup-keyed so an idempotent publish replay reuses the one active link.
    expect(createMemberAccessLink.mock.calls[0]?.[0]?.idempotencyKey).toBe("ephemeral-unlist:art_1");
    expect(mintMemberAccessLink).toHaveBeenCalledWith(expect.objectContaining({ accessLinkId: "al_ephemeral" }));
  });

  it("fails ephemeral publish output when the public Share Link cannot be minted", async () => {
    const { coordinator } = coordinatorFixture({
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult({ ephemeral_tier: true });
      },
    });

    await expect(coordinator.publishRevision(publishInput)).rejects.toThrow(
      "ephemeral_access_link_signing_unavailable",
    );
  });

  it("does not create a Share Link or return unlisted_url for a standard authenticated publish", async () => {
    const createMemberAccessLink = vi.fn();
    const { coordinator } = coordinatorFixture(
      {
        async peekPublishWriteGate() {
          return { is_already_published: true, is_new_artifact: false };
        },
        async publishRevision() {
          return publishedResult();
        },
        createMemberAccessLink,
      },
      { ACCESS_LINK_SIGNING_KEY_V1: "al-test-secret" },
    );

    const result = await coordinator.publishRevision(publishInput);

    expect(result).not.toHaveProperty("unlisted_url");
    expect(createMemberAccessLink).not.toHaveBeenCalled();
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
