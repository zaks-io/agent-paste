import { createRootRoute, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { ThemeProvider } from "../components/theme-provider";
import { buildPageMeta, SITE_NAME } from "../lib/page-meta";
import { captureBrowserException, initBrowserSentry } from "../lib/sentry-browser";
import { loadRootEnvFn } from "../rpc/web-loaders";
import "../styles/globals.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      ...buildPageMeta({ title: SITE_NAME }).meta,
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
  loader: async () => {
    const env = await loadRootEnvFn();
    return { webBaseUrl: env.webBaseUrl, sentry: env.sentry };
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
          <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Something went wrong.</h1>
          <p className="text-[14px] text-[hsl(var(--muted))]">An unexpected error occurred. Try refreshing the page.</p>
          {import.meta.env.DEV ? (
            <pre className="font-mono text-[13px] text-left bg-[hsl(var(--surface-sunken))] p-4 rounded-[var(--radius-sm)] overflow-x-auto">
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
        <p className="text-[11px] uppercase tracking-[0.04em] text-[hsl(var(--muted))]">404</p>
        <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Not found.</h1>
        <a href="/" className="text-[hsl(var(--accent))] underline-offset-4 hover:underline">
          Back to home
        </a>
      </div>
    </div>
  );
}
