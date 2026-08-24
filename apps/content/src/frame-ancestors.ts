import type { Env } from "./env.js";

const APP_ORIGINS_BY_ENV: Record<string, readonly string[]> = {
  production: ["https://app.agent-paste.sh"],
  preview: ["https://app.preview.agent-paste.sh"],
  dev: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:18991", "http://127.0.0.1:18991"],
};

export function frameAncestorsForEnv(env: Env): readonly string[] {
  return APP_ORIGINS_BY_ENV[env.AGENT_PASTE_ENV ?? ""] ?? [];
}
