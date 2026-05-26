import type { CloudflareOptions } from "@sentry/cloudflare";

export type SentryEnv = {
  SENTRY_DSN?: string;
  AGENT_PASTE_ENV?: string;
};

export function sentryOptions(env: SentryEnv): CloudflareOptions {
  const normalizedDsn = env.SENTRY_DSN?.trim() ?? "";

  return {
    dsn: normalizedDsn,
    environment: env.AGENT_PASTE_ENV ?? "dev",
    sendDefaultPii: false,
    enabled: normalizedDsn.length > 0,
  };
}
