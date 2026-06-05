import type { Env } from "./env.js";

// The trusted web app origins permitted to frame served artifact content. The
// viewer sandboxes the iframe (`allow-scripts`, no `allow-same-origin`); these
// origins only say which page may host that sandbox. Keyed off AGENT_PASTE_ENV
// so prod and the stable preview each allow their own dashboard and nothing else.
const APP_ORIGINS_BY_ENV: Record<string, readonly string[]> = {
  production: ["https://app.agent-paste.sh"],
  preview: ["https://app.preview.agent-paste.sh"],
};

export function frameAncestorsForEnv(env: Env): readonly string[] {
  return APP_ORIGINS_BY_ENV[env.AGENT_PASTE_ENV ?? ""] ?? [];
}
