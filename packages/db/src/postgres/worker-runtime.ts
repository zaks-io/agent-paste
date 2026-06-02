import { hasApiKeyPepperBinding, pepperRingFromWorkerEnv, resolveApiKeyPepperMaterial } from "@agent-paste/rotation";
import { isBillingEnabled } from "../policy.js";
import type { Repository } from "../repository/interface.js";
import type { ApiKeyActor, HyperdriveBinding, RepositoryOptions } from "../types.js";
import { createHyperdriveExecutor } from "./executor.js";
import { createPostgresServices } from "./services.js";

export type WorkerPostgresEnv = {
  DB?: unknown;
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
  API_KEY_ENV?: "preview" | "production";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
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
  resolveServiceUrls?: (env: TEnv) => Pick<RepositoryOptions, "apiBaseUrl" | "contentBaseUrl">;
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
  const services = createPostgresServices({
    executor: createHyperdriveExecutor(env.DB),
    apiKeyPepper,
    ...(pepperRing ? { pepperRing } : {}),
    apiKeyEnv: env.API_KEY_ENV ?? "preview",
    billingEnabled: isBillingEnabled(env.BILLING_ENABLED),
    ...serviceUrls,
  });
  return { auth: services.auth, db: options.pickDb(services) };
}

export function isHyperdriveBinding(value: unknown): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}
