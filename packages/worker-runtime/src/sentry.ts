import { type CloudflareOptions, httpServerIntegration } from "@sentry/cloudflare";
import { sanitizeSentryLog } from "./logging.js";
import { sanitizeSentryEvent, sanitizeSentrySpan } from "./sentry-sanitize.js";

export type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  SENTRY_RELEASE?: string;
  AGENT_PASTE_ENV?: string;
};

export type WorkerService = "api" | "upload" | "content" | "jobs" | "mcp" | "apex" | "web" | "stream";

// Downstream SDKs inherit the originating sampling decision. A shared default
// also keeps independently initiated Worker and browser requests consistent.
const DEFAULT_TRACES_SAMPLE_RATE = 1;

export function tracesSampleRate(configured: string | undefined): number {
  const trimmed = configured?.trim();
  if (!trimmed) return DEFAULT_TRACES_SAMPLE_RATE;
  const sampleRate = Number(trimmed);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1");
  }
  return sampleRate;
}

export function sentryOptions(env: SentryEnv, service: WorkerService): CloudflareOptions {
  const normalizedDsn = env.SENTRY_DSN?.trim() ?? "";
  const enabled = normalizedDsn.length > 0;
  const sampleRate = tracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE);
  const serviceName = `agent-paste-${service}`;

  return {
    dsn: normalizedDsn,
    environment: env.AGENT_PASTE_ENV ?? "dev",
    release: env.SENTRY_RELEASE,
    initialScope: { tags: { "service.name": serviceName } },
    sendDefaultPii: false,
    // The pinned HttpServer integration does not consult dataCollection.httpBodies.
    integrations: [httpServerIntegration({ maxRequestBodySize: "none" })],
    dataCollection: {
      userInfo: false,
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
    },
    enabled,
    enableLogs: enabled,
    // SDK binding proxies propagate context independently of global fetch. Named
    // MCP receivers and Web's raw bindings use explicit request instrumentation.
    enableRpcTracePropagation: true,
    propagateTraceparent: true,
    tracePropagationTargets: [
      /^https:\/\/(?:api|upload|app|mcp)\.(?:preview\.)?agent-paste\.sh\//,
      /^https:\/\/agent-paste-(?:api|upload|web|mcp)-(?:preview|pr-\d+)\.isaac-a46\.workers\.dev\//,
      /^https:\/\/(?:agent-paste|ephemeral-provision-gate|write-allowance)\.internal\//,
      /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\//,
    ],
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: (event) => {
      const safe = sanitizeSentryEvent(event);
      return {
        ...safe,
        ...(safe.spans
          ? { spans: safe.spans.map((span) => ({ ...span, data: { ...span.data, "service.name": serviceName } })) }
          : {}),
      };
    },
    beforeSendSpan: (span) => {
      const safe = sanitizeSentrySpan(span);
      return { ...safe, data: { ...safe.data, "service.name": serviceName } };
    },
    beforeSendLog: (log) => {
      const safe = sanitizeSentryLog(log);
      return safe ? { ...safe, attributes: { ...safe.attributes, "service.name": serviceName } } : null;
    },
    ...(enabled ? { tracesSampleRate: sampleRate } : {}),
  };
}
