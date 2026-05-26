import type { CloudflareOptions } from "@sentry/cloudflare";

export type SentryEnv = {
  SENTRY_DSN?: string;
  AGENT_PASTE_ENV?: string;
};

export function sentryOptions(env: SentryEnv): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.AGENT_PASTE_ENV ?? "dev",
    sendDefaultPii: false,
    enabled: (env.SENTRY_DSN?.trim().length ?? 0) > 0,
  };
}
