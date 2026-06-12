import { hasApiKeyPepperBinding, pepperRingFromWorkerEnv, resolveApiKeyPepperMaterial } from "@agent-paste/rotation";
import { isBillingEnabled } from "../policy.js";
import type { Repository } from "../repository/interface.js";
import type { ApiKeyActor, HyperdriveBinding, RepositoryOptions } from "../types.js";
import { createHyperdriveExecutor } from "./executor.js";
import { reparentBlobMigratorFromEnv } from "./reparent-blob-migrator.js";
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
  const services = createPostgresServices({
    executor: createHyperdriveExecutor(env.DB),
    apiKeyPepper,
    ...(pepperRing ? { pepperRing } : {}),
    apiKeyEnv: env.API_KEY_ENV ?? "preview",
    billingEnabled: isBillingEnabled(env.BILLING_ENABLED),
    ...(reparentBlobMigrator ? { reparentBlobMigrator } : {}),
    ...serviceUrls,
  });
  return { auth: services.auth, db: options.pickDb(services) };
}

export function isHyperdriveBinding(value: unknown): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}
