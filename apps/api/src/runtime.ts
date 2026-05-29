import { isBillingEnabled } from "@agent-paste/config";
import {
  createHyperdriveExecutor,
  createPostgresServices,
  type HyperdriveBinding,
  type Repository,
} from "@agent-paste/db";
import { hasApiKeyPepperBinding, pepperRingFromWorkerEnv, resolveApiKeyPepperMaterial } from "@agent-paste/rotation";
import type { AuthService, Env } from "./env.js";

export function apiDatabase(env: Env): Repository | undefined {
  if (isApiDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

export function postgresRuntime(env: Env): { auth: AuthService; db: Repository } | undefined {
  const apiKeyPepper = resolveApiKeyPepperMaterial(env);
  if (!isHyperdriveBinding(env.DB) || !hasApiKeyPepperBinding(env) || !apiKeyPepper) {
    return undefined;
  }
  const pepperRing = pepperRingFromWorkerEnv(env);
  const services = createPostgresServices({
    executor: createHyperdriveExecutor(env.DB),
    apiKeyPepper,
    ...(pepperRing ? { pepperRing } : {}),
    apiKeyEnv: env.API_KEY_ENV ?? "preview",
    apiBaseUrl: apiBaseUrl(env),
    contentBaseUrl: contentBaseUrl(env),
    billingEnabled: isBillingEnabled(env.BILLING_ENABLED),
  });
  return { auth: services.auth, db: services.apiDb };
}

export function apiRateLimitBindings(env: Env) {
  return {
    actor: env.ACTOR_RATE_LIMIT,
    workspace: env.WORKSPACE_BURST_CAP,
    artifact: env.ARTIFACT_RATE_LIMIT,
  };
}

export function contentBaseUrl(env: Env): string {
  return env.CONTENT_BASE_URL ?? "https://usercontent.agent-paste.sh";
}

export function apiBaseUrl(env: Env): string {
  return env.API_BASE_URL ?? "https://api.agent-paste.sh";
}

export function webBaseUrl(env: Env): string {
  return env.WEB_BASE_URL ?? "https://app.agent-paste.sh";
}

function isApiDatabase(value: Env["DB"]): value is Repository {
  return typeof value === "object" && value !== null && "getWhoami" in value;
}

function isHyperdriveBinding(value: Env["DB"]): value is HyperdriveBinding {
  return (
    typeof value === "object" && value !== null && typeof (value as HyperdriveBinding).connectionString === "string"
  );
}
