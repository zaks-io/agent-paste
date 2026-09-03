import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ApiActor, Repository } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env.js";
import { createPublishCoordinator } from "./publish-coordinator.js";

const actor = {
  type: "api_key",
  id: "key_1",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  scopes: ["publish"],
} as ApiActor;
const publishInput = {
  actor,
  idempotencyKey: "idem_publish",
  artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
};

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
  waitUntil?: (promise: Promise<unknown>) => void,
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
  const manifests = new Map<string, string>();
  const env = {
    WRITE_ALLOWANCE: writeAllowance,
    AGENT_PASTE_ENV: "production",
    CONTENT_SIGNING_SECRET: "content-secret",
    CONTENT_CAPABILITY_DOMAIN: "agent-paste.link",
    ARTIFACTS: {
      async get(key: string) {
        const body = manifests.get(key);
        return body ? { body, etag: "1" } : null;
      },
      async put(key: string, body: string) {
        manifests.set(key, body);
        return {};
      },
      async delete() {},
      async list() {
        return { objects: [], truncated: false };
      },
    },
    ...envOverrides,
  } as unknown as Env;
  return { coordinator: createPublishCoordinator({ db, env, ...(waitUntil ? { waitUntil } : {}) }), writeAllowance };
}

function publishedResult(overrides: Record<string, unknown> = {}) {
  return {
    artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    title: "Demo",
    capability_id: "00112233445566778899aabbccddeeff",
    revision_number: 1,
    artifact_updated_at: "2026-01-01T00:00:00.000Z",
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

  it("returns the one top-level Artifact URL", async () => {
    const { coordinator } = coordinatorFixture({
      async peekPublishWriteGate() {
        return { is_already_published: true, is_new_artifact: false };
      },
      async publishRevision() {
        return publishedResult();
      },
    });

    const result = await coordinator.publishRevision(publishInput);

    expect(result).toHaveProperty("url", "https://00112233445566778899aabbccddeeff.agent-paste.link");
    expect(result).toHaveProperty("artifact_id");
    expect(result).not.toHaveProperty("private_url");
    expect(result).not.toHaveProperty("unlisted_url");
    expect(result).not.toHaveProperty("access_link_url");
  });

  it("defers post-publish queue sends outside the response path", async () => {
    let finishSend!: () => void;
    const sendPending = new Promise<void>((resolve) => {
      finishSend = resolve;
    });
    const pending: Promise<unknown>[] = [];
    const send = vi.fn(() => sendPending);
    const { coordinator } = coordinatorFixture(
      {
        async peekPublishWriteGate() {
          return { is_already_published: true, is_new_artifact: false };
        },
        async publishRevision() {
          return publishedResult({ bundle: { status: "pending" } });
        },
      },
      { BUNDLE_GENERATE_QUEUE: { send } },
      (promise) => pending.push(promise),
    );

    await expect(coordinator.publishRevision(publishInput)).resolves.toHaveProperty("artifact_id");
    expect(send).toHaveBeenCalledOnce();
    expect(pending).toHaveLength(1);
    finishSend();
    await pending[0];
  });
});
