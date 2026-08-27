import type { CloudflareOptions } from "@sentry/cloudflare";
import { sanitizeSentryLog } from "./logging.js";
import { sanitizeSentryEvent, sanitizeSentrySpan } from "./sentry-sanitize.js";

export type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  AGENT_PASTE_ENV?: string;
};

// Head-based sampling decides a trace once, at its root, and every downstream
// service inherits it. A pageload's root is the Worker; a client navigation's root
// is the browser. Sampling either side lower silently drops whole legs of the other
// side's traces, so both read this same rate.
const DEFAULT_TRACES_SAMPLE_RATE = 1;

export function tracesSampleRate(configured: string | undefined): number {
  return normalizedTraceSampleRate(configured) ?? DEFAULT_TRACES_SAMPLE_RATE;
}

export function sentryOptions(env: SentryEnv): CloudflareOptions {
  const normalizedDsn = env.SENTRY_DSN?.trim() ?? "";
  const enabled = normalizedDsn.length > 0;
  const tracesSampleRate = normalizedTraceSampleRate(env.SENTRY_TRACES_SAMPLE_RATE) ?? DEFAULT_TRACES_SAMPLE_RATE;

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
    // Service bindings (env.API.fetch) are not global fetch, so the SDK's fetch
    // instrumentation never sees them. This opts the binding proxy in so a call
    // from web/mcp/stream into api carries sentry-trace/baggage and stays one trace.
    enableRpcTracePropagation: true,
    beforeSend: sanitizeSentryEvent,
    beforeSendSpan: sanitizeSentrySpan,
    beforeSendLog: (log) =>
      log.attributes?.["sentry.trace.parent_span_id"] === undefined ? sanitizeSentryLog(log) : null,
    ...(enabled ? { tracesSampleRate } : {}),
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
