/// <reference path="../node-async-hooks.d.ts" />

import { AsyncLocalStorage } from "node:async_hooks";
import type { SqlQuerySource } from "../sql-types.js";

const querySourceStorage = new AsyncLocalStorage<readonly SqlQuerySource[]>();

export function currentSqlQuerySource(): SqlQuerySource | undefined {
  const stack = querySourceStorage.getStore();
  return stack?.[stack.length - 1];
}

export function withSqlQuerySource<T>(source: SqlQuerySource, run: () => T): T {
  const stack = querySourceStorage.getStore() ?? [];
  return querySourceStorage.run([...stack, source], run);
}

type QuerySourceMethod = (this: unknown, ...args: never[]) => unknown;

export function defineSqlQuerySourceMap<T extends Record<string, QuerySourceMethod>>(
  filepath: string,
  sourceName: string,
  queries: T,
): T {
  return Object.fromEntries(
    Object.entries(queries).map(([methodName, query]) => [
      methodName,
      function withDefinedSqlQuerySource(this: unknown, ...args: unknown[]) {
        return withSqlQuerySource(
          {
            filepath,
            functionName: `${sourceName}.${methodName}`,
            namespace: querySourceNamespace(filepath),
          },
          () => (query as (this: unknown, ...args: unknown[]) => unknown).apply(this, args),
        );
      },
    ]),
  ) as unknown as T;
}

function querySourceNamespace(filepath: string): string {
  return filepath.replace(/\.[cm]?[jt]sx?$/, "").replace(/[/.]/g, ".");
}
