import { peekIdempotentReplay, runCommand } from "@agent-paste/commands";
import { type DrizzleConnection, drizzleForExecutor } from "../postgres/drizzle.js";
import { type RlsScope, rlsExecutor } from "../postgres/rls.js";
import { repositoryError } from "../repository-error.js";
import type { SqlExecutor } from "../types.js";
import type { CommandRunContext, CommandSpec, RunScope, UnitOfWork } from "./ports.js";
import { type PostgresContext, postgresEntities } from "./postgres-entities.js";

function withDrizzle(tx: SqlExecutor): PostgresContext {
  const drizzle = drizzleForExecutor(tx);
  if (!drizzle) {
    repositoryError("drizzle_not_bound_to_executor");
  }
  return { sql: tx, drizzle };
}

function isDrizzleConnection(value: SqlExecutor | DrizzleConnection): value is DrizzleConnection {
  return "drizzle" in value && "sql" in value;
}

function workspaceIdForScope(scope: RunScope): string | null {
  return scope.kind === "workspace" ? scope.workspaceId : null;
}

// Translate the backend-agnostic ports into RLS-scoped Postgres transactions plus the
// durable command runner. read() opens a scoped transaction; command() wraps it in
// runCommand idempotency; nested commands reuse the outer transaction as a savepoint.
export class PostgresUnitOfWork implements UnitOfWork {
  private readonly executor: SqlExecutor;

  constructor(connection: SqlExecutor | DrizzleConnection) {
    if (isDrizzleConnection(connection)) {
      this.executor = connection.sql;
    } else {
      this.executor = connection;
      if (!drizzleForExecutor(connection)) {
        repositoryError("executor_missing_drizzle_binding");
      }
    }
  }

  read<T>(scope: RunScope, run: (entities: ReturnType<typeof postgresEntities>) => Promise<T>): Promise<T> {
    return rlsExecutor(this.executor, scope as RlsScope).transaction((tx) => run(postgresEntities(withDrizzle(tx))));
  }

  async command<T>(
    spec: CommandSpec,
    run: (entities: ReturnType<typeof postgresEntities>, ctx: CommandRunContext) => Promise<T>,
  ): Promise<T> {
    return this.runScopedCommand(this.executor, spec, run);
  }

  async peekReplay<T>(input: {
    actor: CommandSpec["actor"];
    operation: string;
    idempotencyKey: string;
    scope: RunScope;
  }): Promise<{ result: T } | null> {
    return peekIdempotentReplay<T>({
      executor: rlsExecutor(this.executor, input.scope as RlsScope),
      actor: input.actor,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      workspaceId: workspaceIdForScope(input.scope),
    });
  }

  private async runScopedCommand<T>(
    executor: SqlExecutor,
    spec: CommandSpec,
    run: (entities: ReturnType<typeof postgresEntities>, ctx: CommandRunContext) => Promise<T>,
  ): Promise<T> {
    const command = await runCommand<T>({
      executor: rlsExecutor(executor, spec.scope as RlsScope),
      actor: spec.actor,
      operation: spec.operation,
      idempotencyKey: spec.idempotencyKey,
      workspaceId: workspaceIdForScope(spec.scope),
      now: spec.now,
      handler: async (tx) => {
        const ctx: CommandRunContext = {
          command: (nestedSpec, nestedRun) =>
            this.runScopedCommand(tx, { ...nestedSpec, scope: spec.scope }, (entities) => nestedRun(entities)),
        };
        return { result: await run(postgresEntities(withDrizzle(tx)), ctx) };
      },
    });
    return command.result;
  }
}
