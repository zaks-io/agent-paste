import type { CloudflareOptions } from "@sentry/cloudflare";
import { sanitizeSentryLog } from "./logging.js";
import { sanitizeSentryEvent } from "./sentry-sanitize.js";

export type SentryEnv = {
  SENTRY_DSN?: string;
  AGENT_PASTE_ENV?: string;
};

export function sentryOptions(env: SentryEnv): CloudflareOptions {
  const normalizedDsn = env.SENTRY_DSN?.trim() ?? "";
  const enabled = normalizedDsn.length > 0;

  return {
    dsn: normalizedDsn,
    environment: env.AGENT_PASTE_ENV ?? "dev",
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
    },
    enabled,
    enableLogs: enabled,
    beforeSend: sanitizeSentryEvent,
    beforeSendLog: sanitizeSentryLog,
  };
}
