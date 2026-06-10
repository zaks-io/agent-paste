import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ApiActor, Repository } from "@agent-paste/db";
import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import { createPublishCoordinator } from "./publish-coordinator.js";

const actor = { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] } as ApiActor;

const publishInput = {
  actor,
  idempotencyKey: "idem_publish",
  artifactId: "art_1",
  revisionId: "rev_1",
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
    ...overrides,
  } as unknown as Repository;
  const env = { WRITE_ALLOWANCE: writeAllowance } as unknown as Env;
  return { coordinator: createPublishCoordinator({ db, env }), writeAllowance };
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
});
