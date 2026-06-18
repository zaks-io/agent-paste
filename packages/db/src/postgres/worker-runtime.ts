import { hasApiKeyPepperBinding, pepperRingFromWorkerEnv, resolveApiKeyPepperMaterial } from "@agent-paste/rotation";
import { isBillingEnabled } from "../policy.js";
import type { Repository } from "../repository/interface.js";
import type { ApiKeyActor, HyperdriveBinding, RepositoryOptions, SqlQueryInstrumentation } from "../types.js";
import { createHyperdriveExecutor, type PostgresExecutorOptions } from "./executor.js";
import { reparentBlobMigratorFromEnv } from "./reparent-blob-migrator.js";
import { revisionReconstructorFromEnv } from "./revision-reconstructor.js";
import { createPostgresServices } from "./services.js";

export type WorkerPostgresEnv = {
  DB?: unknown;
  ARTIFACTS?: unknown;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
  API_KEY_ENV?: "preview" | "production";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  WEB_BASE_URL?: string;
  BILLING_ENABLED?: string;
};

export type PostgresRuntimeAuth = {
  verifyApiKey: (apiKey: string) => Promise<ApiKeyActor | null>;
};

export type PostgresRuntime = {
  auth: PostgresRuntimeAuth;
  db: Repository;
};

export type CreatePostgresRuntimeOptions<TEnv extends WorkerPostgresEnv> = {
  pickDb: (services: ReturnType<typeof createPostgresServices>) => Repository;
  executorOptions?: PostgresExecutorOptions;
  instrumentQuery?: SqlQueryInstrumentation;
  resolveServiceUrls?: (env: TEnv) => Pick<RepositoryOptions, "apiBaseUrl" | "contentBaseUrl" | "webBaseUrl">;
};

export function createPostgresRuntime<TEnv extends WorkerPostgresEnv>(
  env: TEnv,
  options: CreatePostgresRuntimeOptions<TEnv>,
): PostgresRuntime | undefined {
  const apiKeyPepper = resolveApiKeyPepperMaterial(env);
  if (!isHyperdriveBinding(env.DB) || !hasApiKeyPepperBinding(env) || !apiKeyPepper) {
    return undefined;
  }
  const pepperRing = pepperRingFromWorkerEnv(env);
  const serviceUrls = options.resolveServiceUrls?.(env) ?? {};
  const migratorEnv: Parameters<typeof reparentBlobMigratorFromEnv>[0] = {};
  if (env.ARTIFACTS) {
    migratorEnv.ARTIFACTS = env.ARTIFACTS as NonNullable<
      Parameters<typeof reparentBlobMigratorFromEnv>[0]["ARTIFACTS"]
    >;
  }
  if (env.ARTIFACT_BYTES_ENCRYPTION_KEY) {
    migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY = env.ARTIFACT_BYTES_ENCRYPTION_KEY;
  }
  if (env.ARTIFACT_BYTES_ENCRYPTION_KEY_V2) {
    migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY_V2 = env.ARTIFACT_BYTES_ENCRYPTION_KEY_V2;
  }
  if (env.ARTIFACT_BYTES_ENCRYPTION_KID) {
    migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KID = env.ARTIFACT_BYTES_ENCRYPTION_KID;
  }
  const reparentBlobMigrator = reparentBlobMigratorFromEnv(migratorEnv);
  const reconstructorEnv: Parameters<typeof revisionReconstructorFromEnv>[0] = {};
  if (env.ARTIFACTS) {
    reconstructorEnv.ARTIFACTS = env.ARTIFACTS as NonNullable<
      Parameters<typeof revisionReconstructorFromEnv>[0]["ARTIFACTS"]
    >;
  }
  if (migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY) {
    reconstructorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY = migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY;
  }
  if (migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY_V2) {
    reconstructorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY_V2 = migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KEY_V2;
  }
  if (migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KID) {
    reconstructorEnv.ARTIFACT_BYTES_ENCRYPTION_KID = migratorEnv.ARTIFACT_BYTES_ENCRYPTION_KID;
  }
  const revisionReconstructor = revisionReconstructorFromEnv(reconstructorEnv);
  const executorOptions: PostgresExecutorOptions = {
    ...(options.instrumentQuery ? { instrumentQuery: options.instrumentQuery } : {}),
    ...options.executorOptions,
  };
  const services = createPostgresServices({
    executor: createHyperdriveExecutor(env.DB, executorOptions),
    apiKeyPepper,
    ...(pepperRing ? { pepperRing } : {}),
    apiKeyEnv: env.API_KEY_ENV ?? "preview",
    billingEnabled: isBillingEnabled(env.BILLING_ENABLED),
    ...(reparentBlobMigrator ? { reparentBlobMigrator } : {}),
    ...(revisionReconstructor ? { revisionReconstructor } : {}),
    ...serviceUrls,
  });
  return { auth: services.auth, db: options.pickDb(services) };
}

export function isHyperdriveBinding(value: unknown): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}
