import { IdempotencyInFlightError } from "@agent-paste/commands";
import { describe, expect, it, vi } from "vitest";
import { createLocalState } from "./local-state.js";
import { LocalUnitOfWork } from "./local-unit-of-work.js";
import type { CommandSpec } from "./ports.js";

const baseSpec: CommandSpec = {
  actor: { type: "api_key", id: "actor_1", workspaceId: "workspace_1" },
  operation: "test.operation",
  idempotencyKey: "idem_1",
  scope: { kind: "workspace", workspaceId: "workspace_1" },
  now: "2026-01-01T00:00:00.000Z",
};

function peekInput(spec: CommandSpec = baseSpec) {
  return {
    actor: spec.actor,
    operation: spec.operation,
    idempotencyKey: spec.idempotencyKey,
    scope: spec.scope,
  };
}

describe("LocalUnitOfWork", () => {
  it("replays completed commands without rerunning the handler", async () => {
    const uow = new LocalUnitOfWork(createLocalState());
    const handler = vi.fn(async () => "done");

    await expect(uow.command(baseSpec, async () => handler())).resolves.toBe("done");
    await expect(uow.command(baseSpec, async () => handler())).resolves.toBe("done");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("throws IdempotencyInFlightError when the same key is already running", async () => {
    const uow = new LocalUnitOfWork(createLocalState());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = uow.command(baseSpec, async () => {
      await gate;
      return "first";
    });
    const second = uow.command(baseSpec, async () => "second");

    await expect(second).rejects.toThrow(IdempotencyInFlightError);
    release();
    await expect(first).resolves.toBe("first");
  });

  it("evicts in-flight keys when the handler rejects so retries can run", async () => {
    const uow = new LocalUnitOfWork(createLocalState());
    const handler = vi.fn().mockRejectedValueOnce(new Error("handler_failed")).mockResolvedValueOnce("recovered");

    await expect(uow.command(baseSpec, async () => handler())).rejects.toThrow("handler_failed");
    await expect(uow.command(baseSpec, async () => handler())).resolves.toBe("recovered");

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("peekReplay distinguishes missing, in-flight, and completed records", async () => {
    const uow = new LocalUnitOfWork(createLocalState());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await expect(uow.peekReplay<string>(peekInput())).resolves.toBeNull();

    const running = uow.command(baseSpec, async () => {
      await gate;
      return "done";
    });
    await expect(uow.peekReplay<string>(peekInput())).resolves.toEqual({ inFlight: true });

    release();
    await expect(running).resolves.toBe("done");
    await expect(uow.peekReplay<string>(peekInput())).resolves.toEqual({ result: "done" });
  });

  it("keys idempotency by scope workspace, not only the actor workspace", async () => {
    const uow = new LocalUnitOfWork(createLocalState());
    const platformSpec: CommandSpec = {
      ...baseSpec,
      scope: { kind: "platform" },
    };
    const handler = vi.fn(async () => "platform");

    await expect(uow.command(platformSpec, async () => handler())).resolves.toBe("platform");
    await expect(uow.command(baseSpec, async () => "workspace")).resolves.toBe("workspace");

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
