import * as Sentry from "@sentry/tanstackstart-react";

type RouterArg = Parameters<typeof Sentry.tanstackRouterBrowserTracingIntegration>[0];
const SERVICE_NAME = "agent-paste-web-browser";

export type BrowserSentryConfig = {
  dsn?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
  tracesSampleRate?: number | undefined;
};

let initialized = false;

export function initBrowserSentry(config: BrowserSentryConfig | undefined, router: RouterArg): void {
  if (import.meta.env.SSR || initialized) return;
  const dsn = config?.dsn?.trim();
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: config?.environment ?? "unknown",
      release: config?.release,
      sendDefaultPii: false,
      integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
      // Same rate the Worker uses. Head-based sampling means a client-initiated
      // navigation trace is decided here and inherited by the Worker, so a lower
      // browser rate would silently drop server legs of those traces.
      tracesSampleRate: config?.tracesSampleRate ?? 1,
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
    // Monitoring must never break the app; leave initialized false so a later mount retries.
    if (import.meta.env.DEV) console.error("[sentry] init failed", error);
  }
}

export function captureBrowserException(error: unknown): void {
  if (import.meta.env.SSR) return;
  Sentry.captureException(error);
}
