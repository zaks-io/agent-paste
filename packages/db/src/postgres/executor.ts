import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { repositoryError } from "../repository-error.js";
import * as schema from "../schema.js";
import type {
  HyperdriveBinding,
  SqlExecutor,
  SqlQueryConnection,
  SqlQueryInstrumentation,
  SqlValue,
} from "../types.js";
import { withConnectRetry, withTransactionConnectRetry } from "./connect-retry.js";
import { bindDrizzleToExecutor, DEFAULT_POSTGRES_OPTIONS, type DrizzleDb } from "./drizzle.js";
import { currentSqlQuerySource } from "./query-source.js";
import { bindSqlTraceIdProvider } from "./trace-context.js";

type PostgresUnsafeClient = {
  unsafe<Row extends Record<string, unknown>[] = Record<string, unknown>[]>(
    query: string,
    parameters?: readonly unknown[],
    options?: unknown,
  ): PostgresPendingQuery<Row>;
};

export type PostgresExecutorOptions = {
  instrumentQuery?: SqlQueryInstrumentation;
  traceId?: () => string | undefined;
};

type PostgresPendingQuery<Row> = Promise<Row> & {
  values?: (...args: unknown[]) => unknown;
  raw?: (...args: unknown[]) => unknown;
  describe?: (...args: unknown[]) => unknown;
  simple?: (...args: unknown[]) => unknown;
};

const INSTRUMENTED_UNSAFE = Symbol("agentPasteInstrumentedUnsafe");

type InstrumentablePostgresClient = PostgresUnsafeClient & {
  [INSTRUMENTED_UNSAFE]?: SqlQueryInstrumentation;
};

export function createHyperdriveExecutor(
  binding: HyperdriveBinding | string,
  options: PostgresExecutorOptions = {},
): SqlExecutor {
  const connectionString = typeof binding === "string" ? binding : binding.connectionString;
  const sql = postgres(connectionString, DEFAULT_POSTGRES_OPTIONS);
  return createPostgresExecutor(sql, options, postgresConnectionMetadata(connectionString));
}

// drizzle(client, …) reads client.options.parsers, which postgres-js' TransactionSql
// does not expose. Build the DrizzleDb once here and let drizzle.transaction() hand us
// the tx-bound DrizzleDb + TransactionSql, instead of re-constructing inside sql.begin.
export function createPostgresExecutor(
  sql: Sql,
  options: PostgresExecutorOptions = {},
  connection?: SqlQueryConnection,
): SqlExecutor {
  const client = instrumentPostgresClient(sql, options, connection);
  // Top-level executor retries cold-start connect failures; the inner tx-bound
  // executor (retry: false) must not, because its connection is already open and
  // a retry would re-run committed statements.
  return buildExecutor(client, drizzle(client as Sql, { schema }), true, options, connection);
}

function buildExecutor(
  client: PostgresUnsafeClient,
  drizzleDb: DrizzleDb,
  retry: boolean,
  options: PostgresExecutorOptions,
  connection: SqlQueryConnection | undefined,
): SqlExecutor {
  // A single query is safe to retry on any connect-class failure; a transaction
  // only on an establishment failure (see connect-retry.ts). The inner tx-bound
  // executor (retry: false) never retries: its connection is already open.
  const identity = <T>(run: () => Promise<T>) => run();
  const queryGuard = retry ? withConnectRetry : identity;
  const txGuard = retry ? withTransactionConnectRetry : identity;
  const executor: SqlExecutor = {
    async query<Row = Record<string, unknown>>(query: string, params: readonly SqlValue[] = []) {
      const run = () => queryGuard(() => client.unsafe(query, params as readonly unknown[]));
      const rows = await run();
      return { rows: rows as unknown as Row[] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return txGuard(() =>
        drizzleDb.transaction(async (txDb) => {
          const txClient = (txDb as unknown as { session: { client: PostgresUnsafeClient } }).session.client;
          const instrumentedTxClient = instrumentPostgresClient(txClient, options, connection);
          return run(buildExecutor(instrumentedTxClient, txDb as unknown as DrizzleDb, false, options, connection));
        }),
      ) as Promise<T>;
    },
  };
  if (options.traceId) {
    bindSqlTraceIdProvider(executor, options.traceId);
  }
  bindDrizzleToExecutor(executor, drizzleDb);
  return executor;
}

function instrumentPostgresClient(
  client: PostgresUnsafeClient,
  options: PostgresExecutorOptions,
  connection: SqlQueryConnection | undefined,
): PostgresUnsafeClient {
  const instrumentQuery = options.instrumentQuery;
  if (!instrumentQuery) {
    return client;
  }

  const instrumentable = client as InstrumentablePostgresClient;
  if (INSTRUMENTED_UNSAFE in instrumentable) {
    return client;
  }

  const unsafe = client.unsafe.bind(client);
  instrumentable.unsafe = ((query: string, params: unknown = [], queryOptions?: unknown) => {
    const sqlParams = Array.isArray(params) ? (params as readonly SqlValue[]) : [];
    const source = currentSqlQuerySource();
    const input = {
      sql: query,
      params: sqlParams,
      ...(connection ? { connection } : {}),
      ...(source ? { source } : {}),
    };
    const pending =
      queryOptions === undefined
        ? unsafe(query, params as readonly unknown[])
        : unsafe(query, params as readonly unknown[], queryOptions);
    return wrapPostgresPendingQuery(pending, input, instrumentQuery);
  }) as PostgresUnsafeClient["unsafe"];
  instrumentable[INSTRUMENTED_UNSAFE] = instrumentQuery;
  return client;
}

function wrapPostgresPendingQuery<Row>(
  query: PostgresPendingQuery<Row>,
  input: Parameters<SqlQueryInstrumentation>[0],
  instrumentQuery: SqlQueryInstrumentation,
): PostgresPendingQuery<Row> {
  if (!isObjectLike(query)) {
    return query;
  }

  let instrumented: Promise<unknown> | undefined;
  const runInstrumented = (): Promise<Row> => {
    instrumented ??= instrumentQuery(input, () => Promise.resolve(query));
    return instrumented as Promise<Row>;
  };

  return new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (...args: Parameters<Promise<Row>["then"]>) => runInstrumented().then(...args);
      }
      if (prop === "catch") {
        return (...args: Parameters<Promise<Row>["catch"]>) => runInstrumented().catch(...args);
      }
      if (prop === "finally") {
        return (...args: Parameters<Promise<Row>["finally"]>) => runInstrumented().finally(...args);
      }
      if (prop === "values" || prop === "raw" || prop === "describe" || prop === "simple") {
        const method = Reflect.get(target, prop, receiver);
        if (typeof method === "function") {
          return (...args: unknown[]) => wrapMaybePendingQuery(method.apply(target, args), input, instrumentQuery);
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PostgresPendingQuery<Row>;
}

function wrapMaybePendingQuery(
  value: unknown,
  input: Parameters<SqlQueryInstrumentation>[0],
  instrumentQuery: SqlQueryInstrumentation,
) {
  return isObjectLike(value)
    ? wrapPostgresPendingQuery(value as PostgresPendingQuery<unknown>, input, instrumentQuery)
    : value;
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function postgresConnectionMetadata(connectionString: string): SqlQueryConnection | undefined {
  try {
    const url = new URL(connectionString);
    const databaseName = url.pathname.replace(/^\/+/, "") || undefined;
    const serverAddress = url.hostname || undefined;
    const serverPort = Number(url.port || "5432");
    return {
      ...(databaseName ? { databaseName } : {}),
      ...(serverAddress ? { serverAddress } : {}),
      ...(Number.isFinite(serverPort) ? { serverPort } : {}),
    };
  } catch {
    return undefined;
  }
}

export function createPostgresHttpExecutor(options: {
  endpoint: string;
  token?: string;
  fetch?: typeof fetch;
}): SqlExecutor {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async query<Row = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []) {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({ sql, params }),
      });
      if (!response.ok) {
        repositoryError("postgres_http_error");
      }
      const body = (await response.json()) as { rows?: Row[] };
      return { rows: body.rows ?? [] };
    },
    async transaction<T>(_run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      repositoryError("postgres_http_executor_no_transactions");
    },
  };
}
