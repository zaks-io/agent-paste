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

// The local backend has no real transactions, but it enforces the Run Scope through a
// Scoped View (ADR 0083): each read/command binds the entity adapters to a scope-filtered
// view of the in-memory state, so a foreign read returns nothing and a foreign write
// throws. Idempotency claims the command key before the handler runs, rejects concurrent
// same-key calls with IdempotencyInFlightError (matching Postgres 409 semantics), and
// caches only terminal values. Rejected handlers evict the key so a later retry can run.
export class LocalUnitOfWork implements UnitOfWork {
  private readonly state: LocalState;
  private readonly idempotency = new Map<string, IdempotencyEntry>();

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
    const ctx: CommandRunContext = {
      command: (nestedSpec, nestedRun) =>
        this.runCached({ ...nestedSpec, scope: spec.scope }, (entities) => nestedRun(entities)),
    };
    return this.runCached(spec, (entities) => run(entities, ctx));
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
    const key = commandKey(input);
    const existing = this.idempotency.get(key);
    if (existing?.kind === "completed") {
      return existing.value as T;
    }
    if (existing?.kind === "in_flight") {
      throw new IdempotencyInFlightError();
    }

    this.idempotency.set(key, { kind: "in_flight" });
    try {
      const result = await run(this.scopedEntities(input.scope));
      this.idempotency.set(key, { kind: "completed", value: result });
      return result;
    } catch (error) {
      this.idempotency.delete(key);
      throw error;
    }
  }
}
