import { localEntities } from "./local-entities.js";
import type { LocalState } from "./local-state.js";
import type { CommandRunContext, CommandSpec, RunScope, UnitOfWork } from "./ports.js";

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

// The local backend has no transactions or RLS, so scopes are advisory. Idempotency is
// a naive key->result cache: the first call runs the handler and stores the resolved
// value; replays return it. Concurrency-faithful in-flight handling is a tracked follow-up.
export class LocalUnitOfWork implements UnitOfWork {
  private readonly entities: ReturnType<typeof localEntities>;
  private readonly idempotency = new Map<string, unknown>();

  constructor(state: LocalState) {
    this.entities = localEntities(state);
  }

  async read<T>(_scope: RunScope, run: (entities: ReturnType<typeof localEntities>) => Promise<T>): Promise<T> {
    return run(this.entities);
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
  }): Promise<{ result: T } | null> {
    const key = commandKey(input);
    if (!this.idempotency.has(key)) {
      return null;
    }
    return { result: this.idempotency.get(key) as T };
  }

  private async runCached<T>(
    input: { actor: CommandSpec["actor"]; operation: string; idempotencyKey: string; scope: RunScope },
    run: (entities: ReturnType<typeof localEntities>) => Promise<T>,
  ): Promise<T> {
    const key = commandKey(input);
    if (this.idempotency.has(key)) {
      return this.idempotency.get(key) as T;
    }
    const result = await run(this.entities);
    this.idempotency.set(key, result);
    return result;
  }
}
