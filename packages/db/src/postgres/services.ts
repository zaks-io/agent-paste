import type { HyperdriveBinding, RepositoryOptions, SqlExecutor } from "../types.js";
import { createHyperdriveConnection, type DrizzleConnection } from "./drizzle.js";
import { PostgresRepository } from "./repository.js";

type ServicesOptions = RepositoryOptions & {
  executor?: SqlExecutor;
  connection?: DrizzleConnection;
  binding?: HyperdriveBinding | string;
};

export function createPostgresServices(options: ServicesOptions) {
  const repo = new PostgresRepository(resolveConnectionOrExecutor(options), options);
  return {
    repo,
    auth: {
      verifyApiKey: (apiKey: string) => repo.verifyApiKey(apiKey),
    },
    apiDb: repo,
    uploadDb: repo,
  };
}

function resolveConnectionOrExecutor(options: ServicesOptions): SqlExecutor | DrizzleConnection {
  if (options.connection) {
    return options.connection;
  }
  if (options.binding) {
    return createHyperdriveConnection(options.binding);
  }
  if (options.executor) {
    return options.executor;
  }
  throw new Error("createPostgresServices_missing_connection_or_executor");
}
