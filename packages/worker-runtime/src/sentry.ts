import type { CloudflareOptions } from "@sentry/cloudflare";
import { sanitizeSentryLog } from "./logging.js";
import { sanitizeSentryEvent } from "./sentry-sanitize.js";

export type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  AGENT_PASTE_ENV?: string;
};

export function sentryOptions(env: SentryEnv): CloudflareOptions {
  const normalizedDsn = env.SENTRY_DSN?.trim() ?? "";
  const enabled = normalizedDsn.length > 0;
  const tracesSampleRate = normalizedTraceSampleRate(env.SENTRY_TRACES_SAMPLE_RATE);

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
    ...(enabled && tracesSampleRate !== undefined ? { tracesSampleRate } : {}),
  };
}

function normalizedTraceSampleRate(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const sampleRate = Number(trimmed);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    return undefined;
  }
  return sampleRate;
}
