import * as Sentry from "@sentry/browser";

export const APEX_CLIENT_CONFIG_PATH = "/__client/config.json";
const SERVICE_NAME = "agent-paste-apex-browser";

type ApexClientConfig = {
  sentry?: {
    dsn?: string | null | undefined;
    environment?: string | null | undefined;
    release?: string | undefined;
    tracesSampleRate?: number | undefined;
  };
};

type ConfigFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let initialized = false;
let initPromise: Promise<void> | undefined;

export function initApexBrowserSentry(fetcher: ConfigFetcher = globalThis.fetch.bind(globalThis)): Promise<void> {
  if (typeof window === "undefined" || initialized) return Promise.resolve();
  initPromise ??= loadAndInitSentry(fetcher);
  return initPromise;
}

async function loadAndInitSentry(fetcher: ConfigFetcher): Promise<void> {
  try {
    const response = await fetcher(APEX_CLIENT_CONFIG_PATH, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;

    const config = (await response.json()) as ApexClientConfig;
    const dsn = typeof config.sentry?.dsn === "string" ? config.sentry.dsn.trim() : "";
    if (!dsn) return;

    Sentry.init({
      dsn,
      environment: config.sentry?.environment || "dev",
      release: config.sentry?.release,
      sendDefaultPii: false,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: config.sentry?.tracesSampleRate ?? 1,
      propagateTraceparent: true,
      initialScope: { tags: { "service.name": SERVICE_NAME } },
      beforeSendSpan: (span) => ({ ...span, data: { ...span.data, "service.name": SERVICE_NAME } }),
      tracePropagationTargets: [
        /^\/(?!\/)/,
        /^https:\/\/(?:api|upload)\.(?:preview\.)?agent-paste\.sh\//,
        /^https:\/\/agent-paste-(?:api|upload)-(?:preview|pr-\d+)\.isaac-a46\.workers\.dev\//,
      ],
    });
    initialized = true;
  } catch (error) {
    initPromise = undefined;
    if (import.meta.env.DEV) console.error("[sentry] apex init failed", error);
  }
}
