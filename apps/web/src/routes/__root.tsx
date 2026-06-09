import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { NavigationProgress } from "../components/chrome/NavigationProgress";
import { ThemeProvider } from "../components/theme-provider";
import { analyticsScripts } from "../lib/analytics-scripts";
import { buildPageMeta, SITE_NAME } from "../lib/page-meta";
import { captureBrowserException, initBrowserSentry } from "../lib/sentry-browser";
import { loadRootEnvFn, type RootLoaderData } from "../rpc/web-loaders";
import "../styles/globals.css";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The head context carries loaderData at runtime (the public type omits it).
  head: ({ loaderData }: { loaderData?: RootLoaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      ...buildPageMeta({ title: SITE_NAME }).meta,
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
    ],
    // Cloudflare Web Analytics beacon. Declared here (not as a JSX <script>) so
    // TanStack renders it through <HeadContent> and stamps the per-request CSP
    // nonce on it; an element-form <script src> is hoisted by React 19 and loses
    // the nonce, which the dashboard's script-src 'strict-dynamic' then blocks.
    scripts: analyticsScripts(loaderData?.analyticsToken),
  }),
  loader: async (): Promise<RootLoaderData> => {
    const env = await loadRootEnvFn();
    return { webBaseUrl: env.webBaseUrl, sentry: env.sentry, analyticsToken: env.analyticsToken };
  },
  errorComponent: ({ error }) => <RootError error={error} />,
  notFoundComponent: NotFound,
  component: RootComponent,
});

function RootComponent() {
  const { sentry } = Route.useLoaderData();
  const router = useRouter();
  useEffect(() => {
    initBrowserSentry(sentry, router);
  }, [sentry, router]);
  return (
    <RootDocument>
      <ThemeProvider>
        <NavigationProgress />
        <Outlet />
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootError({ error }: { error: Error }) {
  useEffect(() => {
    captureBrowserException(error);
  }, [error]);
  if (import.meta.env.DEV) console.error("[root error]", error);
  return (
    <RootDocument>
      <div className="grid place-items-center min-h-screen p-8">
        <div className="max-w-prose text-center grid gap-4">
          <h1 className="text-h1 font-semibold tracking-tighter">Something went wrong.</h1>
          <p className="text-base text-muted">An unexpected error occurred. Try refreshing the page.</p>
          {import.meta.env.DEV ? (
            <pre className="font-mono text-sm text-left bg-surface-sunken p-4 rounded-sm overflow-x-auto">
              {error.message}
            </pre>
          ) : null}
        </div>
      </div>
    </RootDocument>
  );
}

function NotFound() {
  return (
    <div className="grid place-items-center min-h-screen p-8">
      <div className="text-center grid gap-2">
        <p className="text-mono-sm uppercase tracking-wide text-muted">404</p>
        <h1 className="text-h1 font-semibold tracking-tighter">Not found.</h1>
        <a href="/" className="text-accent underline-offset-4 hover:underline">
          Back to home
        </a>
      </div>
    </div>
  );
}
