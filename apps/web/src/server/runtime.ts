import "@tanstack/react-start/server-only";

import { env as cloudflareEnv } from "cloudflare:workers";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { WebEnv } from "./env";

const REQUIRED_ENV_KEYS = [
  "AGENT_PASTE_ENV",
  "API_BASE_URL",
  "WEB_BASE_URL",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
] as const satisfies ReadonlyArray<keyof WebEnv>;

export function getWebEnv(): WebEnv {
  const env = cloudflareEnv as unknown as Record<string, unknown>;
  const missing = REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`web env missing required keys: ${missing.join(", ")}`);
  }
  return env as unknown as WebEnv;
}

export function getRequestId(): string {
  const existing = getRequestHeader("x-request-id");
  if (existing && existing.length > 0) return existing;
  return crypto.randomUUID();
}
