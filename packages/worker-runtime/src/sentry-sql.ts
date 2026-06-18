import type { PostgresExecutorOptions, SqlQueryInstrumentation } from "@agent-paste/db";
import * as Sentry from "@sentry/cloudflare";

type SpanAttributes = Record<string, string | number | boolean>;

type StartSpan = <T>(options: { name: string; op: string; attributes?: SpanAttributes }, callback: () => T) => T;

export function createSentryPostgresQueryInstrumentation(
  startSpan: StartSpan = Sentry.startSpan,
): SqlQueryInstrumentation {
  return async (input, run) => {
    const statement = sentrySqlStatement(input.sql);
    if (!statement || isInternalPostgresStatement(statement)) {
      return run();
    }

    return startSpan(
      {
        name: statement,
        op: "db",
        attributes: {
          "db.system": "postgresql",
          "db.operation": sqlOperationName(statement),
          "db.query.text": statement,
          "db.system.name": "postgresql",
          "db.operation.name": sqlOperationName(statement),
          ...(input.connection?.databaseName
            ? {
                "db.name": input.connection.databaseName,
                "db.namespace": input.connection.databaseName,
              }
            : {}),
          ...(input.connection?.serverAddress ? { "server.address": input.connection.serverAddress } : {}),
          ...(input.connection?.serverPort ? { "server.port": input.connection.serverPort } : {}),
          ...querySourceAttributes(input.source),
        },
      },
      run,
    );
  };
}

export const sentryPostgresQueryInstrumentation = createSentryPostgresQueryInstrumentation();

export const sentryPostgresExecutorOptions = {
  instrumentQuery: sentryPostgresQueryInstrumentation,
  traceId: activeSentryTraceId,
} satisfies PostgresExecutorOptions;

export function sentrySqlStatement(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

function isInternalPostgresStatement(statement: string): boolean {
  return (
    /^select set_config\(/i.test(statement) ||
    /^(begin|commit|end|rollback|savepoint|release)(\s|;|$)/i.test(statement) ||
    /^start\s+transaction(\s|;|$)/i.test(statement)
  );
}

function sqlOperationName(statement: string): string {
  return statement.match(/^\w+/)?.[0]?.toUpperCase() ?? "UNKNOWN";
}

function querySourceAttributes(source: SqlQueryInstrumentationInput["source"]): SpanAttributes {
  if (!source) {
    return {};
  }

  return {
    "code.filepath": source.filepath,
    ...(source.functionName ? { "code.function": source.functionName } : {}),
    ...(source.lineno ? { "code.lineno": source.lineno } : {}),
    ...(source.namespace ? { "code.namespace": source.namespace } : {}),
  };
}

function activeSentryTraceId(): string | undefined {
  const activeSpan = Sentry.getActiveSpan();
  if (!activeSpan) {
    return undefined;
  }
  const traceId = Sentry.spanToJSON(activeSpan).trace_id;
  return typeof traceId === "string" && traceId.length > 0 ? traceId : undefined;
}

type SqlQueryInstrumentationInput = Parameters<SqlQueryInstrumentation>[0];
