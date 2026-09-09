import { IdempotencyInFlightError } from "@agent-paste/commands";
import { localEntities } from "./local-entities.js";
import { scopedLocalState } from "./local-scope.js";
import type { LocalState } from "./local-state.js";
import type { CommandRunContext, CommandSpec, PeekReplayResult, RunScope, UnitOfWork } from "./ports.js";

function scopeWorkspaceId(scope: RunScope): string | null {
  return scope.kind === "workspace" ? scope.workspaceId : null;
}

// Mirror the Postgres key derivation: durability is keyed by the run scope's workspace,
// not the actor's home workspace. Today every call site passes a scope whose workspace
// matches the actor, but keying on the scope keeps the two backends provably aligned if
// that ever stops being true.
function commandKey(input: {
  actor: CommandSpec["actor"];
  operation: string;
  idempotencyKey: string;
  scope: RunScope;
}): string {
  const { actor } = input;
  const workspaceId = scopeWorkspaceId(input.scope) ?? "";
  return `${input.operation}:${actor.type}:${actor.id}:${workspaceId}:${input.idempotencyKey}`;
}

type IdempotencyEntry = { kind: "in_flight" } | { kind: "completed"; value: unknown };

// The local backend has no rollback, but it serializes top-level commands so workflows
// that rely on Postgres row locks keep the same ordering guarantees. It also enforces the
// Run Scope through a Scoped View (ADR 0083): each read/command binds the entity adapters
// to a scope-filtered view of the in-memory state, so a foreign read returns nothing and
// a foreign write throws. Idempotency claims the command key before waiting for the
// command lock, preserving the Postgres-style concurrent same-key rejection contract.
export class LocalUnitOfWork implements UnitOfWork {
  private readonly state: LocalState;
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private commandTail: Promise<void> = Promise.resolve();

  constructor(state: LocalState) {
    this.state = state;
  }

  private scopedEntities(scope: RunScope): ReturnType<typeof localEntities> {
    return localEntities(scopedLocalState(this.state, scope));
  }

  async read<T>(scope: RunScope, run: (entities: ReturnType<typeof localEntities>) => Promise<T>): Promise<T> {
    return run(this.scopedEntities(scope));
  }

  async command<T>(
    spec: CommandSpec,
    run: (entities: ReturnType<typeof localEntities>, ctx: CommandRunContext) => Promise<T>,
  ): Promise<T> {
    return (await this.commandWithReplay(spec, run)).result;
  }

  async commandWithReplay<T>(
    spec: CommandSpec,
    run: (entities: ReturnType<typeof localEntities>, ctx: CommandRunContext) => Promise<T>,
  ): Promise<{ result: T; isReplay: boolean }> {
    const ctx: CommandRunContext = {
      command: (nestedSpec, nestedRun) =>
        this.runCached({ ...nestedSpec, scope: spec.scope }, (entities) => nestedRun(entities)),
    };
    return this.runCachedWithReplay(spec, (entities) => this.runSerializedCommand(() => run(entities, ctx)));
  }

  async peekReplay<T>(input: {
    actor: CommandSpec["actor"];
    operation: string;
    idempotencyKey: string;
    scope: RunScope;
  }): Promise<PeekReplayResult<T>> {
    const key = commandKey(input);
    const entry = this.idempotency.get(key);
    if (!entry) {
      return null;
    }
    if (entry.kind === "in_flight") {
      return { inFlight: true };
    }
    return { result: entry.value as T };
  }

  private async runCached<T>(
    input: { actor: CommandSpec["actor"]; operation: string; idempotencyKey: string; scope: RunScope },
    run: (entities: ReturnType<typeof localEntities>) => Promise<T>,
  ): Promise<T> {
    return (await this.runCachedWithReplay(input, run)).result;
  }

  private async runSerializedCommand<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.commandTail;
    let release!: () => void;
    this.commandTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  }

  private async runCachedWithReplay<T>(
    input: { actor: CommandSpec["actor"]; operation: string; idempotencyKey: string; scope: RunScope },
    run: (entities: ReturnType<typeof localEntities>) => Promise<T>,
  ): Promise<{ result: T; isReplay: boolean }> {
    const key = commandKey(input);
    const existing = this.idempotency.get(key);
    if (existing?.kind === "completed") {
      return { result: existing.value as T, isReplay: true };
    }
    if (existing?.kind === "in_flight") {
      throw new IdempotencyInFlightError();
    }

    this.idempotency.set(key, { kind: "in_flight" });
    try {
      const result = await run(this.scopedEntities(input.scope));
      this.idempotency.set(key, { kind: "completed", value: result });
      return { result, isReplay: false };
    } catch (error) {
      this.idempotency.delete(key);
      throw error;
    }
  }
}
