import * as Sentry from "@sentry/tanstackstart-react";
import { isExternalObservabilityBlockedPath } from "./external-observability";

type RouterArg = Parameters<typeof Sentry.tanstackRouterBrowserTracingIntegration>[0];

export type BrowserSentryConfig = {
  dsn?: string | undefined;
  environment?: string | undefined;
};

let initialized = false;

export function initBrowserSentry(
  config: BrowserSentryConfig | undefined,
  router: RouterArg,
  pathname = browserPathname(),
): void {
  if (import.meta.env.SSR || initialized || isExternalObservabilityBlockedPath(pathname)) return;
  const dsn = config?.dsn?.trim();
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: config?.environment ?? "unknown",
      sendDefaultPii: false,
      integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
      tracesSampleRate: 0.1,
      beforeSend: (event) => (isExternalObservabilityBlockedPath(browserPathname()) ? null : event),
      beforeSendTransaction: (event) => (isExternalObservabilityBlockedPath(browserPathname()) ? null : event),
    });
    initialized = true;
  } catch (error) {
    // Monitoring must never break the app; leave initialized false so a later mount retries.
    if (import.meta.env.DEV) console.error("[sentry] init failed", error);
  }
}

export function captureBrowserException(error: unknown, pathname = browserPathname()): void {
  if (import.meta.env.SSR || isExternalObservabilityBlockedPath(pathname)) return;
  Sentry.captureException(error);
}

function browserPathname(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.pathname;
}
