import { createPostgresRuntime, type Repository } from "@agent-paste/db";
import type { Env } from "./env.js";

export function apiDatabase(env: Env): Repository | undefined {
  if (isApiDatabase(env.DB)) {
    return env.DB;
  }
  return postgresRuntime(env)?.db;
}

export function postgresRuntime(env: Env) {
  return createPostgresRuntime(env, {
    pickDb: (services) => services.apiDb,
    resolveServiceUrls: (workerEnv) => ({
      apiBaseUrl: apiBaseUrl(workerEnv),
      contentBaseUrl: contentBaseUrl(workerEnv),
    }),
  });
}

export function apiRateLimitBindings(env: Env) {
  return {
    actor: env.ACTOR_RATE_LIMIT,
    workspace: env.WORKSPACE_BURST_CAP,
    artifact: env.ARTIFACT_RATE_LIMIT,
    ephemeralProvisionIp: env.EPHEMERAL_PROVISION_IP_RATE_LIMIT,
    ephemeralProvisionGlobal: env.EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT,
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
