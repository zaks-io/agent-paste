export type SqlValue = string | number | boolean | null | Record<string, unknown> | SqlValue[];

export type SqlQueryResult<Row = Record<string, unknown>> = { rows: Row[] };

export type SqlQueryConnection = {
  databaseName?: string;
  serverAddress?: string;
  serverPort?: number;
};

export type SqlQuerySource = {
  filepath: string;
  functionName?: string;
  lineno?: number;
  namespace?: string;
};

export type SqlQueryInstrumentation = <T>(
  input: { sql: string; params: readonly SqlValue[]; connection?: SqlQueryConnection; source?: SqlQuerySource },
  run: () => Promise<T>,
) => Promise<T>;

export type SqlTraceIdProvider = () => string | undefined;

export type SqlExecutor = {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<SqlQueryResult<Row>>;
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};
