import type { SentryTanstackStartOptions } from "@sentry/tanstackstart-react/vite";

type BuildEnvironment = { SENTRY_AUTH_TOKEN?: string | undefined; SENTRY_RELEASE?: string | undefined };

export function sentryBuildOptions(env: BuildEnvironment): SentryTanstackStartOptions | undefined {
  if (!env.SENTRY_AUTH_TOKEN) return undefined;
  const release = env.SENTRY_RELEASE?.trim();
  if (!release || /\p{Cc}/u.test(release)) {
    throw new Error("SENTRY_RELEASE is required for Sentry source map uploads.");
  }
  return {
    org: "zaksio",
    project: "agent-paste",
    authToken: env.SENTRY_AUTH_TOKEN,
    release: { name: release },
  };
}
